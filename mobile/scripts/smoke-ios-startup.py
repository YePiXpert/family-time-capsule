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


def run(*args, timeout=180):
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
    return result.stdout.strip()


def database(container):
    matches = list(container.rglob("family-time-capsule.sqlite"))
    assert len(matches) == 1, "App did not initialize its local database"
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    info = plistlib.loads((args.app / "Info.plist").read_bytes())
    bundle = info["CFBundleIdentifier"]
    assert bundle == "app.familytimecapsule.mobile"
    assert "iPhoneSimulator" in info["CFBundleSupportedPlatforms"]
    # SecureStore needs signed access-group entitlements even in Simulator.
    # The separately built device IPA remains unsigned for the owner to sign.
    signed_entitlements = run("codesign", "--display", "--entitlements", "-", "--xml", str(args.app.resolve()))
    entitlements = plistlib.loads(signed_entitlements.encode())
    identifier = entitlements.get("application-identifier") or entitlements.get("com.apple.application-identifier")
    assert identifier and identifier.endswith(bundle), "Simulator app is missing its signed application identifier"
    (output / "simulator-entitlements.plist").write_text(signed_entitlements)
    devices = json.loads(run("xcrun", "simctl", "list", "devices", "available", "--json"))["devices"]
    candidates = [(runtime, device) for runtime, entries in devices.items() if ".iOS-" in runtime
                  for device in entries if device.get("isAvailable") and device["name"].startswith("iPhone")]
    assert candidates, "No available iPhone simulator runtime"
    runtime, device = max(candidates, key=lambda pair: tuple(int(n) for n in re.findall(r"\d+", pair[0])))
    udid = run("xcrun", "simctl", "create", "FTC release startup smoke", device["deviceTypeIdentifier"], runtime)
    report = {"gitSha": os.environ.get("SOURCE_SHA"), "buildNumber": info["CFBundleVersion"], "runtime": runtime, "checks": []}
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
        run("xcrun", "simctl", "boot", udid)
        run("xcrun", "simctl", "bootstatus", udid, "-b", timeout=300)
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

        container = launch("fresh-welcome", "暂时只在本机记录")
        db_path = database(container)
        run("xcrun", "simctl", "terminate", udid, bundle)
        with sqlite3.connect(db_path) as db:
            db.execute("INSERT INTO meta(key,value) VALUES ('welcome_done','1') ON CONFLICT(key) DO UPDATE SET value='1'")
        launch("saved-local-mode-empty", "成长册")
        run("xcrun", "simctl", "terminate", udid, bundle)
        payload = json.dumps({"text": "Synthetic offline record survives startup"})
        with sqlite3.connect(db_path) as db:
            db.execute("""INSERT INTO local_capture(id,kind,title,occurred_at,payload_json,title_source,sync_state)
                VALUES ('startup-smoke','text_capture','Offline record','2026-09-11T00:00:00.000Z',?,'rule_generated','pending')""", (payload,))
            db.execute("INSERT INTO outbox(id,kind,payload_json,created_at) VALUES ('startup-smoke','text_capture',?,'2026-09-11T00:00:00.000Z')", (payload,))
            before = db.execute("SELECT * FROM local_capture WHERE id='startup-smoke'").fetchone()
        for label in ("saved-local-mode-with-record", "local-mode-relaunch"):
            launch(label, "成长册")
            run("xcrun", "simctl", "terminate", udid, bundle)
            with sqlite3.connect(db_path) as db:
                assert db.execute("SELECT * FROM local_capture WHERE id='startup-smoke'").fetchone() == before
                assert db.execute("SELECT value FROM meta WHERE key='welcome_done'").fetchone() == ("1",)
                assert db.execute("SELECT payload_json FROM outbox WHERE id='startup-smoke'").fetchone() == (payload,)
                assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
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
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        subprocess.run(["xcrun", "simctl", "delete", udid], capture_output=True)


if __name__ == "__main__":
    main()
