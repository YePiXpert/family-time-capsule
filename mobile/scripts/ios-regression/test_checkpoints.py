import unittest
import subprocess

from checkpoints import NativeCheckpoints


class NativeCheckpointTests(unittest.TestCase):
    def test_independent_checks_continue_but_any_failure_blocks_acceptance(self):
        report = {"success": False}
        checks = NativeCheckpoints(report)
        original = AssertionError("keyboard stayed open")
        completed = []
        with checks.check("keyboard"):
            raise original
        with checks.check("import"):
            completed.append("import")
        with checks.check("playback"):
            raise RuntimeError("missing native frame")
        self.assertEqual(completed, ["import"])
        self.assertEqual([row["name"] for row in report["failures"]], ["keyboard", "playback"])
        with self.assertRaisesRegex(RuntimeError, "keyboard, playback") as failure:
            checks.require_success()
        self.assertIs(failure.exception.__cause__, original)
        self.assertFalse(report["success"])

    def test_successful_checks_allow_acceptance(self):
        checks = NativeCheckpoints({})
        with checks.check("reading"):
            pass
        checks.require_success()
        self.assertFalse(checks.errors)

    def test_cancellation_is_not_swallowed(self):
        checks = NativeCheckpoints({})
        with self.assertRaises(KeyboardInterrupt), checks.check("cancelled"):
            raise KeyboardInterrupt()

    def test_process_timeout_stops_later_fixture_mutations(self):
        checks = NativeCheckpoints({})
        with self.assertRaises(subprocess.TimeoutExpired), checks.check("driver"):
            raise subprocess.TimeoutExpired(["xcodebuild"], 900)
        self.assertEqual(checks.report["failures"][0]["name"], "driver")


if __name__ == "__main__":
    unittest.main()
