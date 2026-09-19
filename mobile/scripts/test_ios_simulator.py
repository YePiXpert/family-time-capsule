"""Guard retry scope: transport timeout is recoverable, a real launch failure is not."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ios_simulator import launch_simulator_app


class LaunchTests(unittest.TestCase):
    def test_timeout_then_success_preserves_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory, patch('ios_simulator.subprocess.run') as run:
            run.side_effect = [subprocess.TimeoutExpired('simctl', 300, output=b'waiting'),
                               subprocess.CompletedProcess([], 0, 'app: 123\n', '')]
            self.assertEqual(launch_simulator_app('device', 'app', Path(directory), 'fresh'), 'app: 123')
            self.assertEqual(run.call_count, 2)
            self.assertIn('waiting', (Path(directory) / 'fresh-launch-1.log').read_text())

    def test_second_timeout_fails(self):
        with tempfile.TemporaryDirectory() as directory, patch('ios_simulator.subprocess.run') as run:
            run.side_effect = subprocess.TimeoutExpired('simctl', 300)
            with self.assertRaises(subprocess.TimeoutExpired):
                launch_simulator_app('device', 'app', Path(directory), 'fresh')
            self.assertEqual(run.call_count, 2)

    def test_explicit_failure_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory, patch('ios_simulator.subprocess.run') as run:
            run.side_effect = subprocess.CalledProcessError(1, 'simctl', stderr='launch failed')
            with self.assertRaises(subprocess.CalledProcessError):
                launch_simulator_app('device', 'app', Path(directory), 'fresh')
            self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
