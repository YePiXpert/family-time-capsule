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
    override func setUpWithError() throws { continueAfterFailure = false; launchApp() }
    override func tearDownWithError() throws {
        shot("last-screen")
        let tree = XCTAttachment(string: app.debugDescription); tree.name = "accessibility"; tree.lifetime = .keepAlways; add(tree)
        app.terminate()
    }
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func labelled(_ text: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch }
    private func wait(_ description: String, timeout: TimeInterval = 20, _ check: @escaping () -> Bool) {
        // Most calls acknowledge an already-typed character or enabled button.
        // Avoid scheduling a predicate waiter when its condition is already true.
        if check() { return }
        let e = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in check() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [e], timeout: timeout), .completed, description)
    }
    /// 启动后先等本机库开完：书架页头的「我的」或开库失败页出现，才算应用起来了。
    /// 托管模拟器忙的时候，启动转圈能转四五十秒（run 35827094155 重跑那次，首个 20 秒断言就栽在转圈上）。
    /// 只给开库这一段放宽到 120 秒；进了书架之后每一步的等待照旧是 20 秒。
    private func launchApp() {
        app.launch()
        wait("App did not finish opening its local library", timeout: 120) {
            self.element("open-settings").exists || self.element("本机资料暂时无法打开").exists
        }
    }
    private func relaunchApp() { app.terminate(); launchApp() }
    /// XCTest 点在元素可见部分的中心。元素只露出屏幕底边一截时，那个点落在 Home 指示条的手势区，
    /// 系统会吞掉这次点击（1.0.1 的书架把月册收到了底边，run 35679134876 就栽在这里）。
    /// 所以除了可点，还要求可见中心离底边至少 60，否则先滚动让它整个进入可点区域。
    /// 首页一屏放下、不能上下滑：年份、月册、相册与信都在书架这条横着翻的小封面上。
    /// 目标在屏幕左右之外（或只露出一截）时，在它那一行横着拖进来，而不是上下滑。
    private func tap(_ id: String) { tap(element(id), id) }
    private func tap(_ e: XCUIElement, _ name: String) {
        XCTAssertTrue(e.waitUntilExists(timeout: 20), "Missing \(name)")
        for _ in 0..<12 {
            let visible = e.frame.intersection(app.frame)
            let offSide = e.frame.minX < app.frame.minX - 1 || e.frame.maxX > app.frame.maxX + 1
            if e.isHittable && !visible.isNull && !offSide && visible.midY < app.frame.maxY - 60 { break }
            if offSide {
                // 拖到头停一下再松手：条不带惯性滑行，下一次点不会只是把还在滑的条按停。
                let row = e.frame.midY / app.frame.height
                let right = app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: row))
                let left = app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: row))
                let (from, to) = e.frame.midX > app.frame.midX ? (right, left) : (left, right)
                from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .default, thenHoldForDuration: 0.3)
            } else if e.frame.midY < app.frame.midY { app.swipeDown() } else { app.swipeUp() }
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
    /// 一屏放下的页面不能上下滑：从 `handle` 往上快拖 300 再松手，`probe` 的位置与大小都不能变。
    /// 页面能滑时，快拖会一直滑到底、停在那里（1.0.5 安卓编辑页多出约 24，整页还能滑）。
    /// 起点不落在正文上：多行输入框自己就是一个滚动视图，会把这一拖吞掉，外面的页面就算能滑也测不出来。
    private func assertFixed(_ probe: String, draggingFrom handle: String) {
        let e = element(probe), from = element(handle)
        XCTAssertTrue(e.waitUntilExists(timeout: 20), "Missing \(probe)"); XCTAssertTrue(from.waitUntilExists(timeout: 20), "Missing \(handle)")
        XCTAssertEqual(app.keyboards.count, 0, "Keyboard is up; the fixed-page check needs it down")
        // 转场淡入与布局还在动时读到的框不算：等连续两次读到同一个框。
        var settled = e.frame
        for _ in 0..<10 { usleep(300_000); let now = e.frame; if now == settled { break }; settled = now }
        let start = from.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -300)), withVelocity: .fast, thenHoldForDuration: 0)
        sleep(1)
        XCTAssertEqual(e.frame.minY, settled.minY, accuracy: 1, "\(probe) moved after a drag: the page scrolls although it fits one screen")
        XCTAssertEqual(e.frame.height, settled.height, accuracy: 1, "\(probe) changed size after a drag")
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
        // fixture 这段有标题：标题、地点、人物那张纸卡打开就是展开的；往下滑一屏留一张图给界面审阅。
        XCTAssertTrue(element("editor-details").waitUntilExists(timeout: 20)); app.swipeUp(); shot("editor-details")
        tap("ai-open")
        XCTAssertTrue(element("ai-polish").waitUntilExists(timeout: 20)); shot("ai-panel")
        // 没加入家庭时点润色：不弹同意框，直接带去「家庭与设备」。
        tap("ai-polish")
        XCTAssertTrue(element("family-out").waitUntilExists(timeout: 20)); shot("ai-enrollment-from-polish")
        // Opening the editor persists a draft. Discard this enrollment-only draft
        // so the later backup check can still require no unfinished edits.
        // 原生页头已下线：返回是 Page 自绘的「‹」图标钮（page-back）。
        tap("page-back"); tap("editor-discard"); tap("放弃")
        XCTAssertTrue(element("record-edit").waitUntilExists(timeout: 20))
        relaunchApp()
        tap("capture-new"); type("A little story.", "capture-text"); shot("editor-keyboard")
        // 文字落盘有 400ms 防抖；留出窗口再终止进程，验证草稿恢复。
        sleep(2)
        relaunchApp()
        tap("继续编辑"); wait("Draft did not survive relaunch") { self.element("capture-text").value as? String == "A little story." }
        // 键盘收着、标题地点人物收着：编辑页一屏放下，往上拖也不动（安卓冒烟的 editorFits 同一条）。
        assertFixed("capture-text", draggingFrom: "editor-details"); shot("editor-fixed")
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
        relaunchApp()
        tap("album-new")
        let own = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "A little story.")).firstMatch
        tap(own, "own record in the material picker")
        tap("record-fixture"); shot("material-selection")
        tap("2026年8月"); tap("record-earlier"); tap("全部月份"); tap("material-done")
        type("Our days", "album-name"); tap("返回调整内容"); tap("material-done")
        XCTAssertEqual(element("album-name").value as? String, "Our days"); tap("album-save")
        XCTAssertTrue(element("album-reading").waitUntilExists(timeout: 20)); shot("album-reading")
        relaunchApp()
        let albumCard = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Our days")).firstMatch
        tap(albumCard, "album volume")
        XCTAssertTrue(element("album-reading").waitUntilExists(timeout: 20)); shot("album-after-relaunch")
        // 时间胶囊：fixture 里已有一封封存的信；再写一封并封存（刚封好是「封好了」），重启后仍在书架，
        // 打开是「还没到日子」的信封（落印只在封存那一次播），提前拆封能读到正文。
        relaunchApp()
        tap("letter-new"); type("Letter for later", "letter-title"); type("Words kept for the future.", "letter-text")
        tap("letter-seal"); tap("封存")
        XCTAssertTrue(element("letter-open-early").waitUntilExists(timeout: 20))
        XCTAssertTrue(labelled("封好了").waitUntilExists(timeout: 20)); shot("letter-sealed")
        relaunchApp()
        let letterVolume = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Letter for later")).firstMatch
        tap(letterVolume, "letter volume")
        XCTAssertTrue(element("letter-open-early").waitUntilExists(timeout: 20))
        XCTAssertTrue(labelled("还没到日子").exists); XCTAssertFalse(labelled("封好了").exists); shot("letter-after-relaunch")
        tap("letter-open-early"); tap("拆开")
        wait("Letter body did not appear") { self.app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Words kept for the future.")).firstMatch.exists }
        shot("letter-opened")
        // 家庭与设备：没加入时三个入口，不联网也能打开；没有任何账号密码输入。
        relaunchApp(); tap("open-settings"); tap("settings-family")
        XCTAssertTrue(element("family-out").waitUntilExists(timeout: 20), "Family page should open offline")
        XCTAssertTrue(element("family-join").exists); XCTAssertTrue(element("family-start").exists); XCTAssertTrue(element("family-recover").exists)
        // 同步卡只在已加入时出现：没加入时没有任何同步、上传入口。
        XCTAssertFalse(element("remote-card").exists, "Signed-out family page must not offer sync")
        XCTAssertFalse(element("remote-backup").exists); XCTAssertFalse(element("remote-first-sync").exists)
        shot("family-out")
        relaunchApp()
        tap("volume-year-2026")
        tap("year-note-edit")
        type("Grow slowly, little one.", "year-note-input")
        tap("year-note-save")
        wait("Year note did not save") {
          self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Grow slowly, little one.")).firstMatch.exists
        }
        relaunchApp()
        tap("volume-year-2026")
        wait("Year note did not survive relaunch") {
          self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Grow slowly, little one.")).firstMatch.exists
        }
        shot("year-note-after-relaunch")
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
        relaunchApp(); tap("open-settings"); tap("备份与恢复")
        // 备份页不再挂家人卡：同步只在「家庭与同步」。
        XCTAssertTrue(element("backup-export").waitUntilExists(timeout: 20), "Backup page missing")
        XCTAssertFalse(element("remote-card").exists, "Backup page must not carry the sync card")
        tap("恢复这份备份"); tap("恢复并替换")
        wait("Restore did not finish") { self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "恢复完成")).firstMatch.exists }
        shot("backup-restored")
        tap("backup-export")
        // Export is complete before the OS share sheet opens; Python verifies the bytes.
        sleep(3); shot("backup-export-share-sheet")
        // 开放归档：等系统分享面板里出现 zip 文件名；Python 再用 zipfile 校验缓存里那份。
        relaunchApp(); tap("open-settings"); tap("备份与恢复")
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
        relaunchApp()
        tap("volume-2026-09")
        XCTAssertTrue(element("record-fixture").waitUntilExists(timeout: 20)); shot("recovered-library-relaunch")
    }

}
