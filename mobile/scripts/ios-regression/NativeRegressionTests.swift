import XCTest
import Foundation

/// Runs against the same bundled JavaScript and native modules as the Release
/// simulator app. Synthetic records are seeded externally while it is stopped.
@MainActor
final class NativeRegressionTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.familytimecapsule.mobile")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    override func tearDownWithError() throws {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name + "-screen"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
        app.terminate()
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func wait(_ message: String, timeout: TimeInterval = 20, _ check: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, message)
    }

    private func tap(_ label: String) {
        let control = element(label)
        XCTAssertTrue(control.waitForExistence(timeout: 15), "Missing control: \(label)")
        for _ in 0..<8 {
            if control.isHittable { break }
            if control.frame.midY < app.frame.midY { app.swipeDown() }
            else { app.swipeUp() }
        }
        XCTAssertTrue(control.isHittable, "Control is not reachable: \(label)")
        control.tap()
    }

    private func card(_ identifier: String) -> XCUIElement {
        let card = element("timeline-card-" + identifier)
        for _ in 0..<15 {
            if card.exists && card.isHittable { return card }
            app.swipeUp()
        }
        XCTFail("Fixture card not reachable: \(identifier)")
        return card
    }

    private func assertFrame(_ actual: CGRect, _ expected: CGRect, _ message: String) {
        XCTAssertEqual(actual.minX, expected.minX, accuracy: 2, message)
        XCTAssertEqual(actual.minY, expected.minY, accuracy: 2, message)
        XCTAssertEqual(actual.width, expected.width, accuracy: 2, message)
        XCTAssertEqual(actual.height, expected.height, accuracy: 2, message)
    }

    private func seconds() -> Double {
        let text = element("media-video-time").label
        return Double(text.split(separator: "/").first?.trimmingCharacters(in: .whitespaces) ?? "") ?? -1
    }

    private func record(_ title: String, _ values: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = title
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func verifyPlayback(_ label: String) {
        let started = Date()
        let viewport = element("media-video-viewport")
        XCTAssertTrue(viewport.waitForExistence(timeout: 15))
        let initialFrame = viewport.frame
        // This value is set only by VideoView.onFirstFrameRender, never by
        // status=readyToPlay or a mocked JavaScript playback event.
        wait("\(label): no native first frame", timeout: 25) {
            self.element("media-video-first-frame").exists
        }
        let firstFrameSeconds = Date().timeIntervalSince(started)
        wait("\(label): playhead did not advance") { self.seconds() >= 2 }
        assertFrame(viewport.frame, initialFrame, "Video layout changed after first frame")
        tap("暂停视频")
        wait("Native player did not enter paused state") { self.element("播放视频").exists }
        Thread.sleep(forTimeInterval: 0.6) // Drain the last 0.5-second native timeUpdate.
        let paused = seconds()
        Thread.sleep(forTimeInterval: 1.3)
        XCTAssertEqual(seconds(), paused, accuracy: 0.3, "Playhead moved after pause")
        tap("播放视频")
        wait("\(label): play did not resume") { self.seconds() > paused }
        if label == "local.mp4" || label == "remote.mp4" {
            element("media-video-view").tap()
            let scrubber = app.sliders.firstMatch
            XCTAssertTrue(scrubber.waitForExistence(timeout: 5), "Native video progress control is unavailable")
            scrubber.adjust(toNormalizedSliderPosition: 0.5)
            wait("Native progress drag did not seek") { self.seconds() >= 8 }
        }
        record(label, ["firstFrameSeconds": firstFrameSeconds, "advancedToSeconds": seconds(),
                       "viewport": NSStringFromCGRect(viewport.frame), "nativeFirstFrame": true])
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = label + "-playing"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func backToTimeline() {
        let back = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10))
        back.tap()
        XCTAssertTrue(element("timeline-list").waitForExistence(timeout: 10))
    }

    func testLocalMP4AndMOVPlayback() {
        XCTAssertTrue(element("timeline-list").waitForExistence(timeout: 20))
        for (identifier, filename) in [("local:fixture-mp4", "local.mp4"), ("local:fixture-mov", "local.mov")] {
            let row = card(identifier)
            let frame = row.frame
            row.tap()
            tap("打开阅读器：" + filename)
            verifyPlayback(filename)
            tap("关闭阅读器")
            XCTAssertFalse(element("media-video-viewport").exists)
            backToTimeline()
            assertFrame(element("timeline-card-" + identifier).frame, frame, "Opening a local reader lost scroll position")
        }
        // A second opening catches native player leaks and stale first-frame
        // state across unmount/release, rather than only testing first launch.
        card("local:fixture-mov").tap()
        tap("打开阅读器：local.mov")
        verifyPlayback("local-mov-reopen")
        tap("关闭阅读器")
        backToTimeline()
    }

    func testKeyboardAndCoverGeometry() {
        XCTAssertTrue(element("timeline-list").waitForExistence(timeout: 20))
        let row = card("local:fixture-poster")
        let media = element("timeline-card-media-local:fixture-poster")
        let frame = row.frame
        Thread.sleep(forTimeInterval: 2)
        assertFrame(row.frame, frame, "Decoded cover changed card height")
        // VoiceOver groups card descendants into one button on some runtimes;
        // the grouped card's native frame still includes the reserved image.
        if media.exists {
            XCTAssertEqual(media.frame.width / media.frame.height, 4.0 / 3.0, accuracy: 0.02)
        }
        XCTAssertGreaterThan(frame.height, frame.width * 0.75)
        let missingRow = card("local:fixture-missing-poster")
        let failedFrame = missingRow.frame
        Thread.sleep(forTimeInterval: 2)
        assertFrame(missingRow.frame, failedFrame, "Failed cover changed card height")
        XCTAssertEqual(failedFrame.height, frame.height, accuracy: 2, "Failed cover lost its reserved area")
        tap("记录一刻")
        let input = element("capture-text")
        let save = element("capture-save-bar")
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        let before = save.frame
        for pass in 0..<2 {
            input.tap()
            input.typeText(pass == 0 ? "Synthetic keyboard fixture" : " again")
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            wait("Save controls are hidden by the keyboard") {
                save.frame.maxY <= self.app.keyboards.firstMatch.frame.minY + 2
            }
            let keyboardFrame = save.frame
            app.scrollViews.firstMatch.swipeDown()
            wait("Keyboard did not dismiss") { !self.app.keyboards.firstMatch.exists }
            wait("Save controls did not return to their original position") { abs(save.frame.minY - before.minY) <= 2 }
            assertFrame(save.frame, before, "Repeated keyboard dismissal accumulates bottom padding")
            record("keyboard-\(pass)", ["closed": NSStringFromCGRect(before), "open": NSStringFromCGRect(keyboardFrame)])
        }
    }

    func testLargeListScrollMetrics() {
        // tab-works predates the fix, so the exact same test can profile the
        // baseline application without adding test identifiers to its source.
        XCTAssertTrue(element("tab-works").waitForExistence(timeout: 20))
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStop]
        measure(metrics: [XCTClockMetric(), XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            self.app.swipeUp(velocity: .fast)
            self.app.swipeUp(velocity: .fast)
            self.app.swipeDown(velocity: .fast)
            self.app.swipeDown(velocity: .fast)
            self.stopMeasuring()
            self.app.terminate()
            self.app.launch()
            XCTAssertTrue(self.element("tab-works").waitForExistence(timeout: 20))
        }
        record("scroll-fixture", ["syntheticRecordCount": 400, "iterations": 5])
    }

    private func fixtureControl(_ body: [String: Any]) {
        var request = URLRequest(url: URL(string: "http://localhost:18765/fixture/control")!)
        request.httpMethod = "POST"
        request.httpBody = try! JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let done = expectation(description: "fixture control")
        URLSession.shared.dataTask(with: request) { _, response, error in
            XCTAssertNil(error)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 5)
    }

    func testAuthenticatedRemotePlaybackAndRecovery() {
        tap("已有账号登录")
        let address = app.textFields["家庭空间地址"]
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        address.typeText("http://localhost:18765")
        app.textFields["邮箱"].tap()
        app.textFields["邮箱"].typeText("native@example.invalid")
        app.secureTextFields["密码"].tap()
        app.secureTextFields["密码"].typeText("FixtureOnly123!")
        // Welcome's ScrollView consumes the first outside tap to dismiss the
        // keyboard. Dismiss explicitly before asserting that login submits.
        tap("登录家庭空间")
        wait("Login keyboard did not dismiss", timeout: 5) { !self.app.keyboards.firstMatch.exists }
        tap("登录")
        XCTAssertTrue(element("timeline-list").waitForExistence(timeout: 30))
        let row = card("remote-memory")
        let frame = row.frame
        row.tap()
        tap("打开阅读器：remote.mp4")
        for filename in ["remote.mp4", "remote.mov", "remote-hevc.mov", "compatibility.mp4"] {
            verifyPlayback(filename)
            if filename != "compatibility.mp4" { tap("下一份") }
        }
        // Foreground sync must neither rebuild the player nor change layout.
        tap("暂停视频")
        wait("Native player did not pause before backgrounding") { self.element("播放视频").exists }
        Thread.sleep(forTimeInterval: 0.6)
        let position = seconds()
        let viewport = element("media-video-viewport").frame
        fixtureControl(["syncDelay": 3])
        XCUIDevice.shared.press(.home)
        app.activate()
        Thread.sleep(forTimeInterval: 4)
        XCTAssertEqual(seconds(), position, accuracy: 0.3, "Foreground sync reset/resumed a paused player")
        assertFrame(element("media-video-viewport").frame, viewport, "Sync moved the video viewport")
        tap("下一份")
        wait("Permission failure never became actionable", timeout: 25) {
            self.element("media-video-status").label.contains("权限")
        }
        XCTAssertFalse(element("media-video-first-frame").exists)
        tap("下一份")
        wait("Network failure never became actionable", timeout: 25) {
            let message = self.element("media-video-status").label
            return message.contains("服务器") || message.contains("网络")
        }
        fixtureControl(["recover": true])
        tap("重试视频")
        verifyPlayback("network-retry")
        fixtureControl(["recover": false])
        tap("下一份")
        let timeoutStarted = Date()
        wait("Slow source stayed black beyond the loading timeout", timeout: 20) {
            self.element("media-video-status").label.contains("15 秒")
        }
        XCTAssertLessThan(Date().timeIntervalSince(timeoutStarted), 20)
        fixtureControl(["recover": true])
        tap("重试视频")
        verifyPlayback("timeout-retry")
        tap("关闭阅读器")
        XCTAssertFalse(element("media-video-viewport").exists)
        backToTimeline()
        assertFrame(element("timeline-card-remote-memory").frame, frame, "Foreground sync lost timeline scroll position")
    }
}
