#!/usr/bin/env python3
"""Release simulator smoke: fresh welcome, persisted local mode, and restart.

Uses a newly created simulator and synthetic SQLite records only. This complements
button/provider tests by running the actual native navigation and animation bridge.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import sqlite3
import subprocess
import time
from ios_simulator import boot_simulator, cleanup_simulator
from local_fixture import empty, record, write_state, read_state


def run(*args, timeout=180):
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
    return result.stdout.strip()


def database(container):
    matches = list(container.rglob("xiaomei-local-v1.sqlite"))
    assert len(matches) == 1, "App did not initialize its local database"
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--entitlements", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    info = plistlib.loads((args.app / "Info.plist").read_bytes())
    bundle = info["CFBundleIdentifier"]
    assert bundle == "app.familytimecapsule.mobile"
    assert "iPhoneSimulator" in info["CFBundleSupportedPlatforms"]
    # Xcode embeds Simulator access groups in __TEXT,__entitlements from its
    # *-Simulated.xcent file; `codesign --display` exposes a different, empty
    # dictionary. Verify the signature and the correct Xcode input, then require
    # the actual SecureStore-backed startup to reach the expected screen.
    run("codesign", "--verify", "--strict", str(args.app.resolve()))
    simulated_entitlements = args.entitlements.read_bytes()
    entitlements = plistlib.loads(simulated_entitlements)
    identifier = entitlements.get("application-identifier") or entitlements.get("com.apple.application-identifier")
    assert identifier and identifier.endswith(bundle), "Simulator app is missing its signed application identifier"
    (output / "simulator-entitlements.plist").write_bytes(simulated_entitlements)
    devices = json.loads(run("xcrun", "simctl", "list", "devices", "available", "--json"))["devices"]
    candidates = [(runtime, device) for runtime, entries in devices.items() if ".iOS-" in runtime
                  for device in entries if device.get("isAvailable") and device["name"].startswith("iPhone")]
    assert candidates, "No available iPhone simulator runtime"
    runtime, device = max(candidates, key=lambda pair: tuple(int(n) for n in re.findall(r"\d+", pair[0])))
    # Exercise the design's 390-point phone width with real native layout.
    types = json.loads(run("xcrun", "simctl", "list", "devicetypes", "--json"))["devicetypes"]
    compact = next((item for item in types if item["identifier"] == "com.apple.CoreSimulator.SimDeviceType.iPhone-16e"), None)
    if compact:
        device = {"name": compact["name"], "deviceTypeIdentifier": compact["identifier"]}
    udid = run("xcrun", "simctl", "create", "FTC release startup smoke", device["deviceTypeIdentifier"], runtime)
    report = {"gitSha": os.environ.get("SOURCE_SHA"), "buildNumber": info["CFBundleVersion"], "runtime": runtime, "device": device["name"], "checks": []}
    ocr = output / "recognize-text.swift"
    ocr.write_text('''import Foundation
import Vision
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
try VNImageRequestHandler(url: url).perform([request])
for result in request.results ?? [] {
  if let text = result.topCandidates(1).first?.string { print(text) }
}
''')
    try:
        boot_simulator(udid, output)
        run("xcrun", "simctl", "ui", udid, "appearance", "light")
        run("xcrun", "simctl", "install", udid, str(args.app.resolve()))

        def launch(label, expected):
            result = run("xcrun", "simctl", "launch", "--terminate-running-process", udid, bundle)
            match = re.search(r": (\d+)\s*$", result)
            assert match, "Simulator did not report an app process"
            pid = int(match[1])
            for _ in range(8):
                time.sleep(2)
                os.kill(pid, 0)  # Simulator apps are host processes; fail on a fatal native/JS exit.
            screenshot = output / (label + ".png")
            run("xcrun", "simctl", "io", udid, "screenshot", str(screenshot))
            recognized = run("swift", str(ocr), str(screenshot))
            (output / (label + ".txt")).write_text(recognized + "\n")
            compact = re.sub(r"\s+", "", recognized)
            assert expected in compact, f"Expected screen was not visible in {label}"
            report["checks"].append(label)
            print(f"Native release startup passed: {label}", flush=True)
            return Path(run("xcrun", "simctl", "get_app_container", udid, bundle, "data"))

        container = launch("fresh-welcome", "开始记录")
        db_path = database(container)
        run("xcrun", "simctl", "terminate", udid, bundle)
        state = empty()
        write_state(db_path, state)
        launch("saved-local-mode-empty", "相册")
        run("xcrun", "simctl", "terminate", udid, bundle)
        state['records']['startup'] = record('startup', '今天，第一次向我挥手')
        write_state(db_path, state)
        for label in ("saved-local-mode-with-record", "local-mode-relaunch"):
            launch(label, "相册")
            run("xcrun", "simctl", "terminate", udid, bundle)
            assert read_state(db_path) == state
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE library SET snapshot='broken' WHERE id=1")
        launch("local-read-recovery", "本机资料暂时无法打开")
        run("xcrun", "simctl", "terminate", udid, bundle)
        with sqlite3.connect(db_path) as db:
            assert db.execute('SELECT snapshot FROM library').fetchone()[0] == 'broken'
        write_state(db_path, state)
        launch("repaired-local-mode-relaunch", "相册")
        run("xcrun", "simctl", "terminate", udid, bundle)
        state['settings']['theme'] = 'dark'
        write_state(db_path, state)
        launch("local-mode-dark", "相册")
        run("xcrun", "simctl", "terminate", udid, bundle)
        state['settings'] = dict(theme='light', largeText=True)
        write_state(db_path, state)
        run("xcrun", "simctl", "ui", udid, "content_size", "extra-extra-extra-large")
        launch("local-mode-large-text", "相册")
        run("xcrun", "simctl", "terminate", udid, bundle)
        assert read_state(db_path) == state
        report["localRecordsPreserved"] = True
        report["success"] = True
    finally:
        (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        try:
            logs = run("xcrun", "simctl", "spawn", udid, "log", "show", "--last", "3m", "--style", "compact",
                       "--predicate", 'process == "' + info["CFBundleExecutable"] + '"', timeout=60)
            (output / "native.log").write_text(logs + "\n")
        except (subprocess.SubprocessError, OSError):
            pass  # Keep the original startup failure if simulator diagnostics are unavailable.
        cleanup_simulator(udid, output)


if __name__ == "__main__":
    main()
