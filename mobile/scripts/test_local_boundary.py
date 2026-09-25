"""local_boundary.check 的正反例：每条宪法各造一个违规树，干净树必须通过。"""
import json
import tempfile
import unittest
from pathlib import Path

from local_boundary import SERVICE_URL, check


def write(root: Path, relative: str, text: str):
    file = root / relative
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text, encoding='utf-8')


def clean_tree(root: Path):
    write(root, 'package.json', json.dumps({'dependencies': {'expo': '1'}}))
    write(root, 'src/local/brand.ts', f'export const SERVICE_URL = "{SERVICE_URL}";\n')
    write(root, 'src/ai/client.ts', 'import { SERVICE_URL } from "../local/brand";\nexport const api = () => fetch(SERVICE_URL);\n')
    write(root, 'src/sync/transport.ts', 'export const client = () => new XMLHttpRequest();\n')
    write(root, 'src/family/api.ts', 'import { SERVICE_URL } from "../local/brand";\nexport const call = () => fetch(SERVICE_URL);\n')
    write(root, 'src/local/App.tsx', 'import { RemoteBackupCard } from "../sync/RemoteBackupCard";\n')
    write(root, 'src/local/Settings.tsx', 'import { RemoteBackupCard } from "../sync/RemoteBackupCard";\n')
    write(root, 'src/local/Shelf.tsx', 'export const shelf = 1;\n')


class LocalBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        clean_tree(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_clean_tree_passes(self):
        self.assertEqual(check(self.root), [])

    def test_networking_outside_transport_files_is_flagged(self):
        write(self.root, 'src/local/backup.ts', 'export const up = () => fetch("x");\n')
        write(self.root, 'src/sync/engine.ts', 'const ws = new WebSocket("x");\n')
        problems = check(self.root)
        self.assertTrue(any('src/local/backup.ts' in p for p in problems))
        self.assertTrue(any('src/sync/engine.ts' in p for p in problems))

    def test_account_words_are_flagged_everywhere(self):
        write(self.root, 'src/sync/transport.ts', 'export const c = { credentials: "include" };\n')
        write(self.root, 'src/local/model.ts', 'export const serverUrl = "";\n')
        problems = check(self.root)
        self.assertTrue(any('credentials' in p and 'transport.ts' in p for p in problems))
        self.assertTrue(any('serverUrl' in p and 'model.ts' in p for p in problems))

    def test_only_app_and_settings_may_import_sync(self):
        write(self.root, 'src/local/Shelf.tsx', 'import { pushManifest } from "../sync/engine";\n')
        problems = check(self.root)
        self.assertEqual(problems, ['src/local may not import src/sync or src/family: src/local/Shelf.tsx'])

    def test_local_may_not_read_the_keychain(self):
        write(self.root, 'src/local/backup.ts', 'import * as SecureStore from "expo-secure-store";\n')
        self.assertEqual(check(self.root), ['src/local may not read the keychain (expo-secure-store): src/local/backup.ts'])
        write(self.root, 'src/family/session.ts', 'import * as SecureStore from "expo-secure-store";\n')
        write(self.root, 'src/local/backup.ts', 'export const b = 1;\n')
        self.assertEqual(check(self.root), [])

    def test_feature_imports_of_local_pages_are_flagged(self):
        for feature in ('sync', 'ai'):
            with self.subTest(feature=feature):
                relative = f'src/{feature}/feature.ts'
                write(self.root, relative, 'import { shelf } from "../local/Shelf";\n')
                self.assertEqual(check(self.root), [
                    f'Feature module imports a local page component: {relative} -> src/local/Shelf.tsx'
                ])
                (self.root / relative).unlink()

    def test_feature_imports_of_shared_ui_and_data_are_allowed(self):
        write(self.root, 'src/local/ui.tsx', 'export const Button = 1;\n')
        write(self.root, 'src/local/context.tsx', 'export const useLibrary = 1;\n')
        write(self.root, 'src/local/model.ts', 'export const emptyLibrary = 1;\n')
        for feature in ('sync', 'ai'):
            write(self.root, f'src/{feature}/feature.ts',
                  'import { Button } from "../local/ui";\n'
                  'import { useLibrary } from "../local/context";\n'
                  'import { emptyLibrary } from "../local/model";\n')
        self.assertEqual(check(self.root), [])

    def test_service_address_lives_only_in_brand(self):
        write(self.root, 'src/ai/client.ts', f'const BASE = "{SERVICE_URL}";\nexport const api = () => fetch(BASE);\n')
        self.assertTrue(any('Service address literal' in p and 'client.ts' in p for p in check(self.root)))
        write(self.root, 'src/ai/client.ts', 'export const api = () => fetch("");\n')
        write(self.root, 'src/local/brand.ts', 'export const APP_NAME = "x";\n')
        self.assertTrue(any('must define SERVICE_URL' in p for p in check(self.root)))

    def test_forbidden_dependencies_are_flagged(self):
        write(self.root, 'package.json', json.dumps({'dependencies': {'expo': '1', 'expo-network': '1'}}))
        self.assertEqual(check(self.root), ['Forbidden dependencies: expo-network'])


class BoundaryBypassTest(unittest.TestCase):
    """绕过旧版检查的写法：换名、传引用、文件系统下载、src 之外的入口、动态 import、require、.js 文件。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        clean_tree(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def assertFlagged(self, relative, text):
        write(self.root, relative, text)
        self.assertNotEqual(check(self.root), [], f'not flagged: {relative}: {text!r}')

    def assertClean(self, relative, text):
        write(self.root, relative, text)
        self.assertEqual(check(self.root), [])

    def test_aliased_fetch_import_in_local(self):
        self.assertFlagged('src/local/backup.ts', 'import { fetch as get } from "expo/fetch";\nexport const up = () => get("https://x");\n')

    def test_fetch_passed_by_reference_in_local(self):
        self.assertFlagged('src/local/backup.ts', 'const send = globalThis.fetch;\nexport const up = () => send("https://x");\n')

    def test_expo_file_system_download_in_local(self):
        self.assertFlagged('src/local/backup.ts', 'import { File, Paths } from "expo-file-system";\nexport const pull = () => File.downloadFileAsync("https://x", Paths.cache);\n')

    def test_network_call_in_app_entry_outside_src(self):
        self.assertFlagged('App.tsx', 'fetch("https://x");\nexport { default } from "./src/local/App";\n')

    def test_network_call_in_native_module_source(self):
        self.assertFlagged('modules/share-intake/src/index.ts', 'export const leak = () => fetch("https://x");\n')

    def test_dynamic_import_of_sync_from_local(self):
        self.assertFlagged('src/local/backup.ts', 'export const go = async () => (await import("../sync/transport")).createTransport();\n')

    def test_require_of_secure_store_from_local(self):
        self.assertFlagged('src/local/backup.ts', 'const SecureStore = require("expo-secure-store");\n')

    def test_js_file_in_src_local(self):
        self.assertFlagged('src/local/helper.js', 'export const up = () => fetch("https://x");\n')

    def test_comment_mentioning_fetch_is_not_a_call(self):
        self.assertClean('src/local/archive-viewer.ts', '/** file:// 下 fetch 不可用，所以用 <script src>。 */\n// fetch 也不行\nexport const viewer = "https://example.invalid/x";\n')

    def test_dynamic_import_inside_local_is_fine(self):
        self.assertClean('src/local/backup.ts', 'export const go = async () => (await import("./activation")).run();\n')


if __name__ == '__main__':
    unittest.main()


class FamilyBoundaryTest(unittest.TestCase):
    """家庭与设备（1.1.0）：第三个联网文件；src/local 只有两个界面文件能碰它；它也不能引本机页面。"""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        clean_tree(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_family_api_may_network_but_other_family_files_may_not(self):
        self.assertEqual(check(self.root), [])
        write(self.root, 'src/family/pairing.ts', 'export const poll = () => fetch("x");\n')
        self.assertTrue(any('src/family/pairing.ts' in p for p in check(self.root)))

    def test_local_journal_may_not_import_family(self):
        write(self.root, 'src/local/Shelf.tsx', 'import { getToken } from "../family/session";\n')
        self.assertTrue(any('src/local/Shelf.tsx' in p for p in check(self.root)))
        write(self.root, 'src/local/Shelf.tsx', 'export const shelf = 1;\n')
        write(self.root, 'src/local/Settings.tsx', 'import { FamilyScreen } from "../family/FamilyScreen";\n')
        self.assertEqual(check(self.root), [])

    def test_family_may_not_import_local_pages(self):
        write(self.root, 'src/family/FamilyScreen.tsx', 'import { Shelf } from "../local/Shelf";\n')
        self.assertTrue(any('src/family/FamilyScreen.tsx' in p for p in check(self.root)))
