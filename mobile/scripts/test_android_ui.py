"""The hierarchy cache may only save dumps; it must never hide a screen change."""
import unittest
from unittest.mock import patch
import android_ui

APP = android_ui.PACKAGE


def screen(*nodes):
    """uiautomator XML with one node per (resource-id, text, package) triple."""
    body = ''.join(f'<node resource-id="{rid}" text="{text}" content-desc="" package="{package}" bounds="[0,0][100,40]"/>'
                   for rid, text, package in nodes)
    return f'<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">{body}</hierarchy>'


def placed(*nodes):
    """uiautomator XML with explicit bounds: (resource-id, text, content-desc, '[l,t][r,b]')."""
    body = ''.join(f'<node resource-id="{rid}" text="{text}" content-desc="{desc}" package="{APP}" bounds="{box}"/>'
                   for rid, text, desc, box in nodes)
    return f'<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">{body}</hierarchy>'


STRIP = ('shelf-strip', '', '', '[0,600][390,720]')
SHELF_START = placed(STRIP, ('volume-year-2026', '', '2026 年，年度册', '[20,604][96,700]'),
                     ('volume-2026-09', '', '9 月，2 段时光', '[108,604][184,700]'))
SHELF_SLIVER = placed(STRIP, ('album-a1', '', 'Our days，1 段时光', '[380,604][390,700]'))
SHELF_SCROLLED = placed(STRIP, ('album-a1', '', 'Our days，1 段时光', '[200,604][276,700]'),
                        ('', 'Our days', '', '[200,688][262,708]'))
SPLASH = screen(('', '', APP))
SHELF = screen(('open-settings', '', APP), ('', '桉桉的成长记', APP))
SHELF_WITH_LETTER = screen(('open-settings', '', APP), ('letter-new', '写一封信', APP))


class FakeAdb:
    """Plays one screen per uiautomator dump (the last one repeats) and records every command."""

    def __init__(self, *screens):
        self.screens, self.current, self.commands = list(screens), None, []

    def __call__(self, command, timeout=None):
        args = command[1:]
        self.commands.append(args)
        if args[:2] == ['shell', 'uiautomator']:
            self.current = self.screens.pop(0) if len(self.screens) > 1 else self.screens[0]
        if args[:2] == ['shell', 'cat']:
            return self.current.encode()
        return b''

    def count(self, *prefix):
        return sum(1 for args in self.commands if args[:len(prefix)] == list(prefix))


class HierarchyCacheTests(unittest.TestCase):
    def setUp(self):
        android_ui._tree = None
        android_ui.stats.update(dumps=0, dumpSeconds=0.0)
        self.sleep = patch('android_ui.time.sleep').start()
        self.addCleanup(patch.stopall)

    def device(self, *screens):
        fake = FakeAdb(*screens)
        patch('android_ui.subprocess.check_output', side_effect=fake).start()
        return fake

    def test_queries_on_an_untouched_screen_share_one_dump(self):
        adb = self.device(SHELF)
        android_ui.find('open-settings')
        android_ui.find('桉桉的成长记')
        android_ui.hierarchy()
        self.assertEqual(adb.count('shell', 'uiautomator'), 1)
        self.assertEqual(android_ui.stats['dumps'], 1)

    def test_any_input_forces_a_fresh_dump(self):
        adb = self.device(SHELF)
        android_ui.tap('open-settings')
        android_ui.find('open-settings')
        android_ui.adb('shell', 'input', 'keyevent', '4')
        android_ui.find('open-settings')
        self.assertEqual(adb.count('shell', 'uiautomator'), 3)

    def test_screen_reads_keep_the_cache(self):
        adb = self.device(SHELF)
        android_ui.find('open-settings')
        android_ui.adb('logcat', '-d')
        android_ui.find('open-settings')
        self.assertEqual(adb.count('shell', 'uiautomator'), 1)

    def test_a_miss_in_the_cache_redumps_at_once(self):
        adb = self.device(SPLASH, SHELF)
        android_ui.hierarchy()
        self.sleep.reset_mock()
        android_ui.find('open-settings')
        self.assertEqual(adb.count('shell', 'uiautomator'), 2)
        self.sleep.assert_not_called()

    def test_polling_waits_between_fresh_dumps(self):
        adb = self.device(SPLASH, SPLASH, SHELF)
        android_ui.find('open-settings')
        self.assertEqual(adb.count('shell', 'uiautomator'), 3)
        self.assertEqual([c.args for c in self.sleep.call_args_list], [(1,), (1,)])

    def test_missing_labels_still_fail(self):
        self.device(SHELF)
        with self.assertRaises(AssertionError):
            android_ui.find('volume-2026-09', tries=3)

    def test_seek_redumps_before_it_swipes(self):
        # 缓存是应用还没画完的一屏：先重新 dump，找到了就不滑，免得把目标滑出屏幕。
        adb = self.device(SPLASH, SHELF_WITH_LETTER)
        android_ui.hierarchy()
        android_ui.tap_seek('letter-new')
        self.assertEqual(adb.count('shell', 'input', 'swipe'), 0)
        self.assertEqual(adb.count('shell', 'input', 'tap'), 1)

    def test_seek_swipes_when_a_fresh_dump_misses(self):
        adb = self.device(SHELF, SHELF_WITH_LETTER)
        android_ui.seek('letter-new')
        self.assertEqual(adb.count('shell', 'input', 'swipe'), 1)
        self.assertEqual(adb.count('shell', 'uiautomator'), 2)

    def test_seek_shelf_drags_the_strip_sideways_until_the_book_shows(self):
        # 首页不能上下滑：书架上的书在屏幕右边之外时，在书架那一行横着拖，而不是上下滑。
        adb = self.device(SHELF_START, SHELF_START, SHELF_SCROLLED)
        android_ui.hierarchy()
        node = android_ui.tap_shelf('Our days')
        self.assertEqual(node.get('resource-id'), 'album-a1')
        swipes = [args for args in adb.commands if args[:3] == ['shell', 'input', 'swipe']]
        self.assertEqual(len(swipes), 1)
        x1, y1, x2, y2 = map(int, swipes[0][3:7])
        self.assertEqual((y1, y2), (660, 660))
        self.assertGreater(x1, x2)
        self.assertEqual(adb.count('shell', 'input', 'tap'), 1)

    def test_seek_shelf_does_not_tap_a_sliver_at_the_edge(self):
        adb = self.device(SHELF_SLIVER, SHELF_SCROLLED)
        node = android_ui.seek_shelf('Our days')
        self.assertEqual(android_ui.bounds(node), [200, 604, 276, 700])
        self.assertEqual(adb.count('shell', 'input', 'swipe'), 1)

    def test_seek_shelf_needs_the_strip(self):
        self.device(SHELF)
        with self.assertRaises(AssertionError):
            android_ui.seek_shelf('Our days', tries=2)

    def test_tap_last_picks_the_dialog_button(self):
        dialog = screen(('record-delete', '删除记录', APP), ('android:id/button1', '删除记录', APP))
        adb = self.device(dialog)
        node = android_ui.tap_last('删除记录')
        self.assertEqual(node.get('resource-id'), 'android:id/button1')
        self.assertEqual(adb.count('shell', 'input', 'tap'), 1)

    def test_wait_until_drawn_skips_the_textless_splash_and_primes_the_cache(self):
        adb = self.device(SPLASH, SHELF)
        android_ui.adb('shell', 'am', 'start', '-W', '-n', f'{APP}/.MainActivity')
        android_ui.wait_until_drawn()
        android_ui.tap('open-settings')
        self.assertEqual(adb.count('shell', 'uiautomator'), 2)

    def test_wait_until_drawn_gives_up(self):
        self.device(SPLASH)
        with patch('android_ui.time.monotonic', side_effect=[0, 0, 0, 100, 100, 100]):
            with self.assertRaises(AssertionError):
                android_ui.wait_until_drawn(timeout=60)

    def test_another_apps_anr_dialog_is_dismissed_and_not_cached(self):
        anr = screen(('android:id/alertTitle', 'Pixel Launcher isn\'t responding', 'android'),
                     ('android:id/aerr_wait', 'Wait', 'android'))
        adb = self.device(anr, SHELF)
        with patch('builtins.print'):
            android_ui.find('open-settings')
        self.assertEqual(adb.count('shell', 'input', 'tap'), 1)
        self.assertIsNotNone(android_ui.first_match(android_ui.hierarchy(), 'open-settings'))

    def test_our_own_anr_is_left_for_the_smoke_to_fail(self):
        anr = screen(('android:id/alertTitle', '桉桉成长记 isn\'t responding', 'android'),
                     ('android:id/aerr_wait', 'Wait', 'android'))
        adb = self.device(anr)
        with self.assertRaises(AssertionError):
            android_ui.find('open-settings', tries=2)
        self.assertEqual(adb.count('shell', 'input', 'tap'), 0)


if __name__ == '__main__':
    unittest.main()
