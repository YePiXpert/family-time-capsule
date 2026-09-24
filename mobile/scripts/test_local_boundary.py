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
