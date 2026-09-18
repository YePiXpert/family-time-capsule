import XCTest
import Foundation

/// Drives the bundled Release app. The only fixtures are in the device's local files.
@MainActor
final class NativeRegressionTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.familytimecapsule.mobile")
    override func setUpWithError() throws { continueAfterFailure = false; app.launch() }
    override func tearDownWithError() throws {
        shot("last-screen")
        let tree = XCTAttachment(string: app.debugDescription); tree.name = "accessibility"; tree.lifetime = .keepAlways; add(tree)
        app.terminate()
    }
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func wait(_ description: String, _ check: @escaping () -> Bool) {
        let e = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [e], timeout: 20), .completed, description)
    }
    private func tap(_ id: String) {
        let e = element(id); XCTAssertTrue(e.waitForExistence(timeout: 20), "Missing \(id)")
        for _ in 0..<12 { if e.isHittable { break }; if e.frame.midY < app.frame.midY { app.swipeDown() } else { app.swipeUp() } }
        XCTAssertTrue(e.isHittable, "Unreachable \(id)"); wait("Disabled \(id)") { e.isEnabled }; e.tap()
    }
    private func shot(_ name: String) { let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a) }
    /// 导出走的是离屏渲染，失败只会在页面上留一行红字、不弹任何东西——截图看不出来，显式断言。
    private func assertNoFailure(_ context: String) {
        for word in ["失败", "超时", "尚未就绪"] {
            let hit = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", word)).firstMatch
            XCTAssertFalse(hit.exists, "\(context) reported \(word): \(hit.label)")
        }
    }
    private func type(_ text: String, _ id: String, initial: String = "") {
        let field = element(id); tap(id); var expected = initial
        if !initial.isEmpty { field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.9)).tap() }
        for c in text { field.typeText(String(c)); expected.append(c); let value = expected; wait("Input lost: \(value)") { field.value as? String == value } }
    }
    func testLocalRecordAlbumAndBackup() throws {
        XCTAssertTrue(element("volume-2026-09").waitForExistence(timeout: 20)); shot("home")
        tap("volume-2026-09"); XCTAssertTrue(element("record-fixture").waitForExistence(timeout: 20))
        tap("record-fixture"); tap("record-edit")
        XCTAssertTrue(element("ai-open").waitForExistence(timeout: 20)); shot("ai-entry")
        tap("ai-open")
        XCTAssertTrue(element("ai-generate").waitForExistence(timeout: 20)); shot("ai-panel")
        tap("ai-generate")
        XCTAssertTrue(element("加入 AI 服务").waitForExistence(timeout: 20)); shot("ai-enrollment-from-photo")
        // Opening the editor persists a draft. Discard this enrollment-only draft
        // so the later backup check can still require no unfinished edits.
        tap("BackButton"); tap("放弃这份草稿"); tap("放弃")
        XCTAssertTrue(element("record-edit").waitForExistence(timeout: 20))
        app.terminate(); app.launch()
        tap("capture-new"); type("A little story.", "capture-text"); shot("editor-keyboard")
        // 文字落盘有 400ms 防抖；留出窗口再终止进程，验证草稿恢复。
        sleep(2)
        app.terminate(); app.launch()
        tap("继续编辑"); wait("Draft did not survive relaunch") { self.element("capture-text").value as? String == "A little story." }
        tap("录音"); XCTAssertTrue(element("完成录音").waitForExistence(timeout: 20)); sleep(2); tap("完成录音")
        tap("capture-save"); XCTAssertTrue(element("record-edit").waitForExistence(timeout: 20)); shot("record-reading")
        tap("record-edit"); type(" More memories.", "capture-text", initial: "A little story."); tap("capture-save")
        XCTAssertTrue(element("record-edit").waitForExistence(timeout: 20))
        tap("keepsake-make")
        // 生成成功后系统分享面板弹出；截图留证，重启后自然收起。
        sleep(5); shot("keepsake-share-sheet"); assertNoFailure("Keepsake export")
        app.terminate(); app.launch()
        tap("album-new")
        let own = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "A little story.")).firstMatch
        XCTAssertTrue(own.waitForExistence(timeout: 20)); own.tap()
        tap("record-fixture"); shot("material-selection")
        tap("2026-08"); tap("record-earlier"); tap("全部月份"); tap("material-done")
        type("Our days", "album-name"); tap("返回调整内容"); tap("material-done")
        XCTAssertEqual(element("album-name").value as? String, "Our days"); tap("album-save")
        XCTAssertTrue(element("album-reading").waitForExistence(timeout: 20)); shot("album-reading")
        app.terminate(); app.launch()
        let albumCard = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Our days")).firstMatch
        XCTAssertTrue(albumCard.waitForExistence(timeout: 20), "Missing album volume")
        for _ in 0..<12 { if albumCard.isHittable { break }; app.swipeUp() }
        albumCard.tap()
        XCTAssertTrue(element("album-reading").waitForExistence(timeout: 20)); shot("album-after-relaunch")
        app.terminate(); app.launch(); tap("open-settings"); tap("AI 设置")
        XCTAssertTrue(element("加入 AI 服务").waitForExistence(timeout: 20)); shot("ai-settings")
        app.terminate(); app.launch()
        tap("volume-year-2026")
        tap("year-note-edit")
        type("Grow slowly, little one.", "year-note-input")
        tap("year-note-save")
        wait("Year note did not save") {
          self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Grow slowly, little one.")).firstMatch.exists
        }
        app.terminate(); app.launch()
        tap("volume-year-2026")
        wait("Year note did not survive relaunch") {
          self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Grow slowly, little one.")).firstMatch.exists
        }
        shot("year-note-after-relaunch")
        tap("year-yearbook"); tap("长图")
        // 长卷渲染成功后系统分享面板弹出；截图留证，下面的重启会收起它。
        sleep(8); shot("yearbook-share-sheet"); assertNoFailure("Yearbook image export")
        // 再走一遍纪念册 PDF：真分页、逐页取图再写 PDF，比长图慢得多。
        app.terminate(); app.launch(); tap("volume-year-2026")
        tap("year-yearbook"); tap("纪念册 PDF")
        // 开工前先报总页数；这一句点得动，就说明版面真的排出来了。
        tap("开始装订")
        XCTAssertTrue(element("year-book-cancel").waitForExistence(timeout: 30), "Binding never started")
        shot("yearbook-binding")
        sleep(90); shot("yearbook-pdf-share-sheet"); assertNoFailure("Yearbook PDF export")
        app.terminate(); app.launch(); tap("open-settings"); tap("备份与恢复")
        tap("恢复这份备份"); tap("恢复并替换")
        wait("Restore did not finish") { self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "恢复完成")).firstMatch.exists }
        shot("backup-restored")
        tap("backup-export")
        // Export is complete before the OS share sheet opens; Python verifies the bytes.
        sleep(3); shot("backup-export-share-sheet")
    }
    func testUnreadableLibraryRecoversFromLocalBackup() throws {
        XCTAssertTrue(element("本机资料暂时无法打开").waitForExistence(timeout: 20)); shot("unreadable-library")
        tap("从最近的本机备份恢复"); tap("恢复备份")
        XCTAssertTrue(element("volume-2026-09").waitForExistence(timeout: 30))
        tap("volume-2026-09")
        XCTAssertTrue(element("record-fixture").waitForExistence(timeout: 30)); shot("startup-backup-recovered")
        app.terminate(); app.launch()
        tap("volume-2026-09")
        XCTAssertTrue(element("record-fixture").waitForExistence(timeout: 20)); shot("recovered-library-relaunch")
    }

}
