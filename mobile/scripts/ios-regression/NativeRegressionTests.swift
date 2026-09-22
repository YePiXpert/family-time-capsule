import XCTest
import Foundation

private extension XCUIElement {
    /// Already-visible controls need no polling; slow transitions keep the full timeout.
    func waitUntilExists(timeout: TimeInterval) -> Bool {
        exists || waitForExistence(timeout: timeout)
    }
}

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
        // Most calls acknowledge an already-typed character or enabled button.
        // Avoid scheduling a predicate waiter when its condition is already true.
        if check() { return }
        let e = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [e], timeout: 20), .completed, description)
    }
    /// XCTest 点在元素可见部分的中心。元素只露出屏幕底边一截时，那个点落在 Home 指示条的手势区，
    /// 系统会吞掉这次点击（1.0.1 的书架把月册收到了底边，run 35679134876 就栽在这里）。
    /// 所以除了可点，还要求可见中心离底边至少 60，否则先滚动让它整个进入可点区域。
    private func tap(_ id: String) { tap(element(id), id) }
    private func tap(_ e: XCUIElement, _ name: String) {
        XCTAssertTrue(e.waitUntilExists(timeout: 20), "Missing \(name)")
        for _ in 0..<12 {
            let visible = e.frame.intersection(app.frame)
            if e.isHittable && !visible.isNull && visible.midY < app.frame.maxY - 60 { break }
            if e.frame.midY < app.frame.midY { app.swipeDown() } else { app.swipeUp() }
        }
        XCTAssertTrue(e.isHittable, "Unreachable \(name)"); wait("Disabled \(name)") { e.isEnabled }; e.tap()
    }
    private func shot(_ name: String) { let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a) }
    /// 导出走的是离屏渲染，失败只会在页面上留一行红字、不弹任何东西——截图看不出来，显式断言。
    private func assertNoFailure(_ context: String) {
        for word in ["失败", "超时", "尚未就绪"] {
            let hit = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", word)).firstMatch
            XCTAssertFalse(hit.exists, "\(context) reported \(word): \(hit.label)")
        }
    }
    /// 续写时先把光标挪到已有文字末尾：点首行文字右侧的空白（首行必定露在外面）。
    /// 不能点字段右下角：键盘弹起后底栏贴着字段下沿，1.0.1 把工具栏放进了底栏，那一点正是「文件」钮，
    /// 点下去打开系统文件浏览器、字段失焦（run 35681782720 栽在这里）。这里的 initial 都是单行。
    private func type(_ text: String, _ id: String, initial: String = "") {
        let field = element(id); tap(id); var expected = initial
        if !initial.isEmpty { field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0)).withOffset(CGVector(dx: 0, dy: 20)).tap() }
        // Keep per-character acknowledgement: a whole-string burst can lose
        // characters on a hosted simulator. Only already-satisfied waits are skipped.
        for c in text { field.typeText(String(c)); expected.append(c); let value = expected; wait("Input lost: \(value)") { field.value as? String == value } }
    }
    func testLocalRecordAlbumAndBackup() throws {
        XCTAssertTrue(element("volume-2026-09").waitUntilExists(timeout: 20)); shot("home")
        tap("volume-2026-09"); XCTAssertTrue(element("record-fixture").waitUntilExists(timeout: 20))
        tap("record-fixture"); tap("record-edit")
        XCTAssertTrue(element("说一段").waitUntilExists(timeout: 20))
        XCTAssertTrue(element("ai-open").waitUntilExists(timeout: 20)); shot("ai-entry")
        tap("ai-open")
        XCTAssertTrue(element("ai-generate").waitUntilExists(timeout: 20)); shot("ai-panel")
        tap("ai-generate")
        XCTAssertTrue(element("ai-join").waitUntilExists(timeout: 20)); shot("ai-enrollment-from-photo")
        // Opening the editor persists a draft. Discard this enrollment-only draft
        // so the later backup check can still require no unfinished edits.
        // 原生页头已下线：返回是 Page 自绘的「‹」图标钮（page-back）。
        tap("page-back"); tap("放弃这份草稿"); tap("放弃")
        XCTAssertTrue(element("record-edit").waitUntilExists(timeout: 20))
        app.terminate(); app.launch()
        tap("capture-new"); type("A little story.", "capture-text"); shot("editor-keyboard")
        // 文字落盘有 400ms 防抖；留出窗口再终止进程，验证草稿恢复。
        sleep(2)
        app.terminate(); app.launch()
        tap("继续编辑"); wait("Draft did not survive relaunch") { self.element("capture-text").value as? String == "A little story." }
        tap("editor-by"); tap("editor-by-爸爸")
        // 保留原有录音入库验证；保存这一刻走不转写的路径，模拟器不依赖听写授权。
        // 全新 macOS 运行器上第一次激活音频会话可能要三五十秒：流水线拆成并行作业后（`300b12e`），
        // 回归作业不再跟在启动冒烟后面热身，run 35694486774 等 20 秒没等到「说完了」，拆解截图里录音其实已开始。放宽到 120 秒。
        tap("说一段"); XCTAssertTrue(element("说完了").waitUntilExists(timeout: 120)); sleep(2)
        tap("capture-save"); XCTAssertTrue(element("record-edit").waitUntilExists(timeout: 20)); XCTAssertEqual(element("record-by").label, "—— 爸爸", "Signature missing on the reading page"); shot("record-reading")
        // 阅读页动作在底栏：滚到页尾后底栏仍在，页尾只剩「删除记录」。
        app.swipeUp(); shot("record-bottom-bar")
        tap("record-edit"); type(" More memories.", "capture-text", initial: "A little story."); tap("capture-save")
        XCTAssertTrue(element("record-edit").waitUntilExists(timeout: 20))
        tap("keepsake-make")
        // 生成成功后系统分享面板弹出；截图留证，重启后自然收起。
        sleep(5); shot("keepsake-share-sheet"); assertNoFailure("Keepsake export")
        app.terminate(); app.launch()
        tap("album-new")
        let own = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "A little story.")).firstMatch
        tap(own, "own record in the material picker")
        tap("record-fixture"); shot("material-selection")
        tap("2026年8月"); tap("record-earlier"); tap("全部月份"); tap("material-done")
        type("Our days", "album-name"); tap("返回调整内容"); tap("material-done")
        XCTAssertEqual(element("album-name").value as? String, "Our days"); tap("album-save")
        XCTAssertTrue(element("album-reading").waitUntilExists(timeout: 20)); shot("album-reading")
        app.terminate(); app.launch()
        let albumCard = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Our days")).firstMatch
        tap(albumCard, "album volume")
        XCTAssertTrue(element("album-reading").waitUntilExists(timeout: 20)); shot("album-after-relaunch")
        // 时间胶囊：fixture 里已有一封封存的信；再写一封并封存，重启后仍在书架，打开是「还没到日子」的信封，提前拆封能读到正文。
        app.terminate(); app.launch()
        tap("letter-new"); type("Letter for later", "letter-title"); type("Words kept for the future.", "letter-text")
        tap("letter-seal"); tap("封存")
        XCTAssertTrue(element("letter-open-early").waitUntilExists(timeout: 20)); shot("letter-sealed")
        app.terminate(); app.launch()
        let letterVolume = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Letter for later")).firstMatch
        tap(letterVolume, "letter volume")
        XCTAssertTrue(element("letter-open-early").waitUntilExists(timeout: 20)); shot("letter-after-relaunch")
        tap("letter-open-early"); tap("拆开")
        wait("Letter body did not appear") { self.app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Words kept for the future.")).firstMatch.exists }
        shot("letter-opened")
        app.terminate(); app.launch(); tap("open-settings"); tap("AI 设置")
        XCTAssertTrue(element("ai-join").waitUntilExists(timeout: 20)); shot("ai-settings")
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
        // 先逐页预览：预览能翻页，就说明版面真的排出来了。
        tap("book-preview-next"); shot("yearbook-preview")
        tap("book-preview-bind")
        // 等最终文件出现，快速完成也算成功，不能依赖短暂的进度按钮。
        let sharedBook = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "yearbook-2026")
        ).firstMatch
        XCTAssertTrue(sharedBook.waitUntilExists(timeout: 300), "Book PDF share sheet never appeared")
        shot("yearbook-pdf-share-sheet"); assertNoFailure("Yearbook PDF export")
        app.terminate(); app.launch(); tap("open-settings"); tap("备份与恢复")
        // 远端备份卡在最后：离线、未登录时只有「去登录」，没有上传入口。
        XCTAssertTrue(element("remote-card").waitUntilExists(timeout: 20), "Remote backup card missing")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "去登录")).firstMatch.waitUntilExists(timeout: 20), "Remote card should ask to sign in")
        XCTAssertFalse(element("remote-backup").exists, "Remote card must not offer uploads while signed out")
        tap("恢复这份备份"); tap("恢复并替换")
        wait("Restore did not finish") { self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "恢复完成")).firstMatch.exists }
        shot("backup-restored")
        tap("backup-export")
        // Export is complete before the OS share sheet opens; Python verifies the bytes.
        sleep(3); shot("backup-export-share-sheet")
        // 开放归档：等系统分享面板里出现 zip 文件名；Python 再用 zipfile 校验缓存里那份。
        app.terminate(); app.launch(); tap("open-settings"); tap("备份与恢复")
        tap("archive-export")
        let sharedArchive = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "成长记归档-")).firstMatch
        XCTAssertTrue(sharedArchive.waitUntilExists(timeout: 300), "Archive share sheet never appeared")
        shot("archive-share-sheet"); assertNoFailure("Archive export")
    }
    func testUnreadableLibraryRecoversFromLocalBackup() throws {
        XCTAssertTrue(element("本机资料暂时无法打开").waitUntilExists(timeout: 20)); shot("unreadable-library")
        tap("从最近的本机备份恢复"); tap("恢复备份")
        XCTAssertTrue(element("volume-2026-09").waitUntilExists(timeout: 30))
        tap("volume-2026-09")
        XCTAssertTrue(element("record-fixture").waitUntilExists(timeout: 30)); shot("startup-backup-recovered")
        app.terminate(); app.launch()
        tap("volume-2026-09")
        XCTAssertTrue(element("record-fixture").waitUntilExists(timeout: 20)); shot("recovered-library-relaunch")
    }

}
