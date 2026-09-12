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
        tapControl(control, label: label)
    }

    private func tapControl(_ control: XCUIElement, label: String) {
        XCTAssertTrue(control.waitForExistence(timeout: 15), "Missing control: \(label)")
        for _ in 0..<8 {
            if control.isHittable { break }
            if control.frame.midY < app.frame.midY { app.swipeDown() }
            else { app.swipeUp() }
        }
        XCTAssertTrue(control.isHittable, "Control is not reachable: \(label)")
        wait("Control never became enabled: \(label)", timeout: 15) { control.isEnabled }
        control.tap()
    }

    private func tapContaining(_ label: String) {
        tapControl(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch, label: label)
    }

    private func textContains(_ value: String) -> Bool {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch.exists
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

    private func clockSeconds(_ value: Substring) -> Double {
        let parts = value.trimmingCharacters(in: .whitespaces).split(separator: ":")
        guard parts.count == 2 || parts.count == 3 else { return -1 }
        var total: Double = 0
        for part in parts {
            guard let number = Double(part), number >= 0 else { return -1 }
            total = total * 60 + number
        }
        return total
    }

    private func seconds() -> Double {
        guard let elapsed = element("media-video-time").label.split(separator: "/").first else { return -1 }
        return clockSeconds(elapsed)
    }

    private func duration() -> Double {
        let parts = element("media-video-time").label.split(separator: "/")
        return parts.count == 2 ? clockSeconds(parts[1]) : -1
    }

    private func hasNativeFrame() -> Bool {
        element("media-video-view").value as? String == "画面已呈现"
    }

    private func ownerExitControl() -> XCUIElement {
        let exits = app.buttons.matching(identifier: "长按退出观看")
        return exits.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? exits.firstMatch
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
        // The production accessibility value follows VideoView.onFirstFrameRender
        // for the accepted source, not readyToPlay or a mocked playback event.
        wait("\(label): no native first frame", timeout: 25) {
            self.hasNativeFrame()
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
        if label == "local.mp4" || label == "remote.mp4" || label == "family-viewing" {
            tap("暂停视频")
            wait("Player did not pause before seeking") { self.element("播放视频").exists }
            Thread.sleep(forTimeInterval: 0.6)
            let beforeSeek = seconds()
            let fullDuration = duration()
            XCTAssertGreaterThan(fullDuration, 20)
            let fraction: CGFloat = beforeSeek < fullDuration * 0.5 ? 0.7 : 0.2
            let target = fullDuration * Double(fraction)
            let scrubber = element("media-video-seek")
            XCTAssertTrue(scrubber.waitForExistence(timeout: 5), "Playback progress control is unavailable")
            XCTAssertTrue(scrubber.isHittable, "Playback progress control cannot be touched")
            // Drag the actual RN responder. Its adjustable accessibility role is
            // not a UIKit UISlider, so XCUIElement.adjust would skip this path.
            scrubber.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5))
                .press(forDuration: 0.1, thenDragTo: scrubber.coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.5)))
            wait("Progress drag did not seek to the requested position") { abs(self.seconds() - target) <= 1.5 }
            XCTAssertGreaterThan(abs(seconds() - beforeSeek), 3, "Seek left the playhead unchanged")
            if label == "local.mp4" {
                let frameBeforeChrome = viewport.frame
                let pausedSeek = seconds()
                tap("收起观看工具")
                wait("Reader controls did not hide") { !self.element("media-video-time").exists }
                XCTAssertTrue(element("关闭阅读器").isHittable, "Closing the reader became inaccessible")
                XCTAssertTrue(hasNativeFrame(), "Hiding controls discarded the native frame")
                tap("显示观看工具")
                wait("Reader controls did not return") { self.element("media-video-time").exists }
                assertFrame(viewport.frame, frameBeforeChrome, "Showing controls changed the original viewport")
                XCTAssertEqual(seconds(), pausedSeek, accuracy: 0.3)
            }
            let seeked = seconds()
            tap("播放视频")
            wait("Native playback did not advance from the seeked position") { self.seconds() > seeked }
        }
        record(label, ["firstFrameSeconds": firstFrameSeconds, "advancedToSeconds": seconds(),
                       "viewport": NSCoder.string(for: viewport.frame), "nativeFirstFrame": true])
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
            record("keyboard-\(pass)", ["closed": NSCoder.string(for: before), "open": NSCoder.string(for: keyboardFrame)])
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
        XCTAssertFalse(hasNativeFrame())
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

    private func openImportReceipt() {
        XCTAssertTrue(element("tab-profile").waitForExistence(timeout: 20))
        tap("tab-profile")
        tap("存储与同步")
        tap("未完成记录")
        tapContaining("本机收到的内容")
        XCTAssertTrue(element("import-photo-picker").waitForExistence(timeout: 15))
    }

    func testImportSelectionPersistsAndCreatesOnlySelectedReferences() {
        openImportReceipt()
        wait("Import did not initially retain all originals") { self.textContains("已选 3 / 3 项") }
        tap("仅选代表图")
        wait("Representative selection did not apply") { self.textContains("已选 1 / 3 项") }
        tap("全选")
        tap("全部展开")
        tap("选中 pick-three.png")
        wait("Explicit deselection did not apply") { self.textContains("已选 2 / 3 项") }
        // Initially the first image is both cover and representative, so the
        // first remaining action belongs to the second image in fixture order.
        tap("设为代表图")
        tap("设为封面")
        tap("将已选照片合为一组")
        wait("Manual merge was not reflected") { self.textContains("已选 2 / 3 项 · 2 组") }
        tap("拆开这组照片")
        wait("Manual split was not reflected") { self.textContains("已选 2 / 3 项 · 3 组") }
        tap("将已选照片合为一组")
        wait("Selection was not saved locally") { self.textContains("挑选已暂存在本机") }
        app.terminate()
        app.launch()
        openImportReceipt()
        wait("Saved selection was lost on relaunch") { self.textContains("已选 2 / 3 项 · 2 组 · 已选封面") }
        tap("将所选加入新草稿")
        XCTAssertTrue(element("capture-text").waitForExistence(timeout: 15))
        wait("Selected draft references did not persist") { self.textContains("本机已保存") }
        record("import-selection-ui", ["selected": 2, "originals": 3, "relaunchPreserved": true])
        // The host verifies the exact IDs, cover, groups, file preservation and
        // absence of upload intent in SQLite after this actual native UI flow.
    }

    func testFamilyViewingHidesEditingAndRequiresOwnerExit() {
        XCTAssertTrue(element("tab-works").waitForExistence(timeout: 20))
        tap("tab-works")
        tap("整理素材相册")
        tapContaining("Fixture family album")
        tap("更多")
        fixtureControl(["phase": "family-viewing"])
        tap("给家人看")
        verifyPlayback("family-viewing")
        XCTAssertFalse(element("更多素材操作").exists)
        XCTAssertFalse(element("关闭阅读器").exists)
        XCTAssertFalse(element("导出原件").exists)
        XCTAssertFalse(element("记录一刻").exists && element("记录一刻").isHittable)
        XCTAssertFalse(element("tab-profile").exists && element("tab-profile").isHittable)
        tapControl(ownerExitControl(), label: "长按退出观看")
        XCTAssertTrue(hasNativeFrame(), "A short tap exited family viewing")
        XCTAssertFalse(element("确认退出观看").exists)
        ownerExitControl().press(forDuration: 1.4)
        tap("继续观看")
        XCTAssertTrue(element("media-video-view").waitForExistence(timeout: 5))
        ownerExitControl().press(forDuration: 1.4)
        tap("确认退出观看")
        wait("Owner confirmation did not restore the collection") {
            !self.element("media-video-view").exists && self.textContains("Fixture family album")
        }
        XCTAssertTrue(element("更多").isHittable)
        fixtureControl(["phase": "completed"])
        record("family-viewing-ui", ["editingHidden": true, "shortTapKeptViewing": true, "ownerExitConfirmed": true])
    }
}
