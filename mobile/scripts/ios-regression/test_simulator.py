import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ios_simulator", Path(__file__).resolve().parents[1] / "ios_simulator.py")
simulator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(simulator)


class SimulatorBootTests(unittest.TestCase):
    def test_cleanup_still_deletes_after_shutdown_times_out_and_keeps_original_failure(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(simulator.subprocess, "run") as run:
            run.side_effect = [subprocess.TimeoutExpired(["shutdown"], 60), subprocess.CompletedProcess([], 0, "Deleted", "")]
            with self.assertRaisesRegex(RuntimeError, "application failed"):
                try:
                    raise RuntimeError("application failed")
                finally:
                    simulator.cleanup_simulator("isolated", Path(directory))
            self.assertEqual(run.call_args_list[1].args[0], ["xcrun", "simctl", "delete", "isolated"])
            self.assertTrue(all(call.kwargs["timeout"] == 60 for call in run.call_args_list))
            self.assertIn("timed out", (Path(directory) / "simulator-cleanup.log").read_text())
            self.assertIn("Deleted", (Path(directory) / "simulator-cleanup.log").read_text())

    def test_success_preserves_boot_output(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(simulator.subprocess, "run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, "Finished booting\n", "")
            simulator.boot_simulator("isolated", Path(directory))
            self.assertEqual(run.call_count, 1)
            self.assertIn("Finished booting", (Path(directory) / "simulator-boot-1.log").read_text())

    def test_timeout_retries_only_the_owned_simulator(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(simulator.subprocess, "run") as run:
            success = subprocess.CompletedProcess([], 0, "Booted\n", "")
            run.side_effect = [subprocess.TimeoutExpired(["bootstatus"], 300, output=b"Waiting for services"), success, success]
            simulator.boot_simulator("isolated", Path(directory))
            self.assertEqual(run.call_args_list[1].args[0], ["xcrun", "simctl", "shutdown", "isolated"])
            self.assertIn("Waiting for services", (Path(directory) / "simulator-boot-1.log").read_text())
            self.assertEqual(run.call_count, 3)

    def test_second_failure_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(simulator.subprocess, "run") as run:
            failure = subprocess.CalledProcessError(1, ["bootstatus"], output="Boot failed")
            run.side_effect = [failure, subprocess.CompletedProcess([], 0), failure]
            with self.assertRaises(subprocess.CalledProcessError):
                simulator.boot_simulator("isolated", Path(directory))
            self.assertEqual(run.call_count, 3)
            self.assertIn("Boot failed", (Path(directory) / "simulator-boot-2.log").read_text())


if __name__ == "__main__":
    unittest.main()
