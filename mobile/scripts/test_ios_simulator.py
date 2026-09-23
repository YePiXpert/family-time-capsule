"""Guard retry scope: transport timeout is recoverable, a real launch failure is not."""
from contextlib import closing
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import ios_simulator
from ios_simulator import DEVICE_TYPE, create_simulator, describe_simulator, launch_simulator_app, warm_up, xctest_launch_timed_out
from local_fixture import wait_for_library

BUNDLE = 'app.familytimecapsule.mobile'
SOURCE = '/Users/runner/work/family-time-capsule/family-time-capsule/mobile/scripts/ios-regression/NativeRegressionTests.swift'
TEST = '-[NativeRegression.NativeRegressionTests testLocalRecordAlbumAndBackup]'
# 真实失败的原文：run 35736146539（1.0.3）第 108 行、run 35827094155 第 75 行，都是模拟器没按时把应用拉起来。
TIMEOUT_108 = f'{SOURCE}:108: error: {TEST} : Failed to launch {BUNDLE}: Timed out attempting to launch app.'
TIMEOUT_75 = f'{SOURCE}:75: error: {TEST} : Failed to launch {BUNDLE}: Timed out attempting to launch app.'
# run 35827094155 重跑那次：启动转圈转了 45 秒，首个断言栽了。这是断言失败，不能拿来重跑。
ASSERTION_61 = f'{SOURCE}:61: error: {TEST} : XCTAssertTrue failed'


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


class XCTestLaunchTimeoutTests(unittest.TestCase):
    """Only the simulator failing to launch the app may rerun the regression."""

    def test_launch_timeouts_from_real_runs_are_retryable(self):
        for line in (TIMEOUT_108, TIMEOUT_75):
            log = f"Test Case '{TEST}' started.\n{line}\nTest Case '{TEST}' failed (83.217 seconds).\n** TEST EXECUTE FAILED **\n"
            self.assertTrue(xctest_launch_timed_out(log, BUNDLE))

    def test_assertion_failures_are_not_retried(self):
        self.assertFalse(xctest_launch_timed_out(ASSERTION_61 + '\n', BUNDLE))
        self.assertFalse(xctest_launch_timed_out(f'{TIMEOUT_75}\n{ASSERTION_61}\n', BUNDLE))

    def test_failures_without_an_xctest_error_are_not_retried(self):
        self.assertFalse(xctest_launch_timed_out('', BUNDLE))
        self.assertFalse(xctest_launch_timed_out('Testing failed:\n\tEarly unexpected exit, operation never finished bootstrapping\n** TEST EXECUTE FAILED **\n', BUNDLE))

    def test_another_app_timing_out_does_not_count(self):
        self.assertFalse(xctest_launch_timed_out(TIMEOUT_75.replace(BUNDLE, 'com.apple.Preferences'), BUNDLE))


class SimulatorPreparationTests(unittest.TestCase):
    def test_create_uses_the_newest_available_ios_runtime(self):
        runtimes = {'runtimes': [
            {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-18-6', 'version': '18.6', 'isAvailable': True},
            {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-6', 'version': '26.6', 'isAvailable': False},
            {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-0', 'version': '26.0.1', 'isAvailable': True},
            {'identifier': 'com.apple.CoreSimulator.SimRuntime.watchOS-26-1', 'version': '26.1', 'isAvailable': True},
        ]}
        with patch('ios_simulator._simctl', side_effect=[json.dumps(runtimes), 'NEW-UDID']) as simctl:
            self.assertEqual(create_simulator('Anan offline regression'), 'NEW-UDID')
            simctl.assert_called_with('create', 'Anan offline regression', DEVICE_TYPE, 'com.apple.CoreSimulator.SimRuntime.iOS-26-0')

    def test_describe_reports_the_runtime_and_device_name(self):
        types = {'devicetypes': [{'identifier': DEVICE_TYPE, 'name': 'iPhone 16e'}]}
        devices = {'devices': {'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
            {'udid': 'OTHER', 'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17'},
            {'udid': 'MINE', 'deviceTypeIdentifier': DEVICE_TYPE}]}}
        with patch('ios_simulator._simctl', side_effect=[json.dumps(types), json.dumps(devices)]):
            self.assertEqual(describe_simulator('MINE'), {'runtime': 'com.apple.CoreSimulator.SimRuntime.iOS-26-0', 'device': 'iPhone 16e'})

    def test_describe_rejects_an_unknown_simulator(self):
        with patch('ios_simulator._simctl', side_effect=[json.dumps({'devicetypes': []}), json.dumps({'devices': {}})]):
            with self.assertRaises(RuntimeError):
                describe_simulator('GONE')

    def test_warm_up_never_fails_the_job(self):
        with patch('ios_simulator._simctl', side_effect=subprocess.TimeoutExpired('simctl', 180)) as simctl, patch('builtins.print'):
            warm_up('device')
            self.assertEqual(simctl.call_count, 4)  # launch and terminate, twice

    def test_prepare_hands_the_udid_to_the_next_step(self):
        with tempfile.TemporaryDirectory() as directory, patch('ios_simulator.prepare_simulator', return_value='NEW-UDID') as prepare:
            udid_file = Path(directory) / 'udid'
            argv = ['ios_simulator.py', 'prepare', '--name', 'FTC release startup smoke', '--output', directory, '--udid-file', str(udid_file)]
            with patch.object(sys, 'argv', argv):
                ios_simulator.main()
            prepare.assert_called_once_with('FTC release startup smoke', Path(directory).resolve())
            self.assertEqual(udid_file.read_text(), 'NEW-UDID\n')


class LocalLibraryWaitTests(unittest.TestCase):
    def test_returns_once_the_app_wrote_its_root_row(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'anan-local-v1.sqlite'
            with closing(sqlite3.connect(database)) as db, db:
                db.execute('CREATE TABLE root (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)')
                db.execute("INSERT INTO root(id,json) VALUES(1,'{}')")
            self.assertLess(wait_for_library(database, timeout=5), 5)

    def test_times_out_while_the_library_is_missing_or_empty(self):
        with tempfile.TemporaryDirectory() as directory, patch('local_fixture.time.sleep'):
            missing = Path(directory) / 'missing.sqlite'
            with patch('local_fixture.time.monotonic', side_effect=[0, 0, 200]):
                with self.assertRaises(AssertionError):
                    wait_for_library(missing, timeout=120)
            empty = Path(directory) / 'empty.sqlite'
            sqlite3.connect(empty).close()
            with patch('local_fixture.time.monotonic', side_effect=[0, 0, 200]):
                with self.assertRaises(AssertionError):
                    wait_for_library(empty, timeout=120)


if __name__ == '__main__':
    unittest.main()
