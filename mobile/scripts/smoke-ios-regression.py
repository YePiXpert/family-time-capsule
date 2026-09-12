#!/usr/bin/env python3
"""Drive real Release playback/layout via XCUITest on an isolated iPhone simulator.

Prerequisites: Xcode, ffmpeg with libx264/libx265, CocoaPods' xcodeproj gem.
All fixture data lives in the temporary simulator or the requested output folder.
The installed app, its entitlements and bundled JavaScript are never modified.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import sqlite3
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).with_name("ios-regression")))
from fixtures import FixtureServer, generate_media  # noqa: E402


def run(*arguments, timeout=180, log=None):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    if log:
        Path(log).write_text(result.stdout + result.stderr)
    if result.returncode:
        print((result.stdout + result.stderr)[-18000:], flush=True)
        raise subprocess.CalledProcessError(result.returncode, arguments)
    return result.stdout.strip()


def seed_local(db_path, container, media):
    target = container / "Documents" / "native-regression"
    shutil.copytree(media, target, dirs_exist_ok=True)
    entries = [
        ("fixture-mp4", "local.mp4", "sample.mp4", "video", "video/mp4"),
        ("fixture-mov", "local.mov", "sample.mov", "video", "video/quicktime"),
        ("fixture-poster", "Synthetic poster", "poster.png", "image", "image/png"),
        ("fixture-missing-poster", "Missing poster", "does-not-exist.png", "image", "image/png"),
    ]
    stamp = datetime(2026, 9, 12, 11, 58, tzinfo=timezone.utc)
    with sqlite3.connect(db_path) as db:
        db.execute("INSERT INTO meta(key,value) VALUES ('welcome_done','1') ON CONFLICT(key) DO UPDATE SET value='1'")
        for index, (identifier, title, filename, kind, mime) in enumerate(entries):
            uri = (target / filename).as_uri()
            payload = json.dumps(dict(localUri=uri, fileName=title, mimeType=mime, mediaType=kind))
            db.execute("""INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,title_source,sync_state)
                VALUES (?,'media_capture',?,?,?,?,?,'rule_generated','pending')""",
                       (identifier, title, (stamp - timedelta(minutes=index)).isoformat(), uri, kind, payload))
        for index in range(396):
            text = f"Synthetic growth record {index:03d}. A fixture for scrolling, not family content."
            db.execute("""INSERT INTO local_capture(id,kind,title,occurred_at,payload_json,title_source,sync_state)
                VALUES (?,'text_capture',?,?,?,'rule_generated','pending')""",
                       (f"fixture-text-{index:03d}", text,
                        (stamp - timedelta(days=index + 1)).isoformat(), json.dumps({"text": text})))
        assert db.execute("SELECT COUNT(*) FROM local_capture").fetchone()[0] == 400
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile-only", action="store_true", help="Run the identical scrolling metric on a baseline Release app")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    info = plistlib.loads((args.app / "Info.plist").read_bytes())
    bundle = info["CFBundleIdentifier"]
    assert bundle == "app.familytimecapsule.mobile"
    assert "iPhoneSimulator" in info["CFBundleSupportedPlatforms"]
    run("codesign", "--verify", "--strict", str(args.app.resolve()))
    report = dict(gitSha=os.environ.get("SOURCE_SHA"), buildNumber=info["CFBundleVersion"], checks=[],
                  environment="iOS Release simulator; physical device not exercised",
                  profileOnly=args.profile_only, host=run("sysctl", "-n", "hw.model"),
                  architecture=run("uname", "-m"), success=False)
    media = output / "fixtures"
    generate_media(media)
    devices = json.loads(run("xcrun", "simctl", "list", "devices", "available", "--json"))["devices"]
    candidates = [(runtime, device) for runtime, entries in devices.items() if ".iOS-" in runtime
                  for device in entries if device.get("isAvailable") and device["name"].startswith("iPhone")]
    assert candidates, "No iPhone simulator runtime"
    runtime, device = max(candidates, key=lambda pair: tuple(int(n) for n in re.findall(r"\d+", pair[0])))
    udid = run("xcrun", "simctl", "create", "FTC Release playback regression", device["deviceTypeIdentifier"], runtime)
    report.update(runtime=runtime, device=device["name"])
    server = FixtureServer(media)
    server.start()
    try:
        run("xcrun", "simctl", "boot", udid)
        run("xcrun", "simctl", "bootstatus", udid, "-b", timeout=300)
        run("xcrun", "simctl", "ui", udid, "appearance", "light")
        run("xcrun", "simctl", "install", udid, str(args.app.resolve()))
        run("xcrun", "simctl", "launch", udid, bundle)
        container = Path(run("xcrun", "simctl", "get_app_container", udid, bundle, "data"))
        db_path = None
        for _ in range(30):
            matches = list(container.rglob("family-time-capsule.sqlite"))
            if matches:
                with sqlite3.connect(matches[0]) as db:
                    if db.execute("SELECT 1 FROM sqlite_master WHERE name='local_capture'").fetchone():
                        db_path = matches[0]
                        break
            time.sleep(1)
        assert db_path, "Release app failed to initialize local database"
        # Give asynchronous migrations the opportunity to finish before the
        # stopped-process fixture write, then verify the required durable column.
        time.sleep(2)
        run("xcrun", "simctl", "terminate", udid, bundle)
        seed_local(db_path, container, media)
        project_dir = output / "runner-project"
        run("ruby", str(Path(__file__).with_name("ios-regression") / "create-project.rb"), str(project_dir))
        runner_data = output / "runner-build"
        run("xcodebuild", "-project", str(project_dir / "NativeRegression.xcodeproj"), "-scheme", "NativeRegression",
            "-configuration", "Release", "-destination", f"platform=iOS Simulator,id={udid}",
            "-derivedDataPath", str(runner_data), "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_ALLOWED=YES",
            "build-for-testing", timeout=600, log=output / "runner-build.log")
        xctestruns = list((runner_data / "Build" / "Products").glob("*.xctestrun"))
        assert len(xctestruns) == 1, "Expected exactly one generated UI test specification"
        specification = plistlib.loads(xctestruns[0].read_bytes())

        def configure_target(value):
            if isinstance(value, dict):
                if value.get("IsUITestBundle"):
                    # Supply the externally-built AUT to XCTest's standard run
                    # specification so system scrolling metrics target its PID.
                    value["UITargetAppPath"] = str(args.app.resolve())
                    value["UITargetAppBundleIdentifier"] = bundle
                for nested in value.values():
                    configure_target(nested)
            elif isinstance(value, list):
                for nested in value:
                    configure_target(nested)

        configure_target(specification)
        xctestruns[0].write_bytes(plistlib.dumps(specification))

        def test(label, methods):
            started = time.monotonic()
            result_bundle = output / (label + ".xcresult")
            primary_failure = None
            try:
                run("xcodebuild", "test-without-building", "-xctestrun", str(xctestruns[0]),
                    "-destination", f"platform=iOS Simulator,id={udid}", "-parallel-testing-enabled", "NO",
                    "-maximum-concurrent-test-simulator-destinations", "1", "-resultBundlePath", str(result_bundle),
                    *[f"-only-testing:NativeRegression/NativeRegressionTests/{method}" for method in methods],
                    timeout=900, log=output / (label + ".log"))
            except Exception as error:
                primary_failure = error
                raise
            finally:
                report["checks"].append(dict(name=label, seconds=round(time.monotonic() - started, 2),
                                             methods=methods, success=primary_failure is None))
                # Export failed tests too: their screenshots/accessibility trees
                # are usually the evidence needed to repair a native regression.
                # Diagnostic failures must never replace the original test error.
                diagnostic_errors = []
                if result_bundle.exists():
                    formats = ["summary"] + (["metrics"] if "testLargeListScrollMetrics" in methods else [])
                    for kind in formats:
                        try:
                            value = run("xcrun", "xcresulttool", "get", "test-results", kind, "--path", str(result_bundle))
                            (output / (label + "-" + kind + ".json")).write_text(value + "\n")
                        except Exception as error:
                            diagnostic_errors.append(error)
                    try:
                        run("xcrun", "xcresulttool", "export", "attachments", "--path", str(result_bundle),
                            "--output-path", str(output / (label + "-attachments")))
                    except Exception as error:
                        diagnostic_errors.append(error)
                if diagnostic_errors:
                    (output / (label + "-diagnostics.log")).write_text("\n".join(map(str, diagnostic_errors)) + "\n")
                    if primary_failure is None:
                        raise diagnostic_errors[0]
            print(f"Native Release UI regression passed: {label}", flush=True)
            # Preserve raw typed xcresult metrics above, and extract the concise
            # XCTest console measurements for a cross-build comparison table.
            log = (output / (label + ".log")).read_text()
            readings = re.findall(r"measured \[([^\]]+)\] average: ([\d.]+).*?values: \[([^\]]+)\]", log)
            if "testLargeListScrollMetrics" in methods:
                assert readings, "XCTest did not emit any scrolling performance measurements"
                report["scrollMetrics"] = [dict(name=name, average=float(average),
                    samples=[float(value.strip()) for value in values.split(",")]) for name, average, values in readings]

        if args.profile_only:
            test("baseline-scroll", ["testLargeListScrollMetrics"])
            report["success"] = True
            return
        test("local-playback", ["testLocalMP4AndMOVPlayback"])
        test("layout-and-scroll", ["testKeyboardAndCoverGeometry", "testLargeListScrollMetrics"])
        # Same local records, fresh ordinary login screen. Credentials are entered
        # using UIKit controls and persisted by the real SecureStore path.
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE meta SET value='0' WHERE key='welcome_done'")
        test("authenticated-playback", ["testAuthenticatedRemotePlaybackAndRecovery"])
        media_requests = [row for row in server.requests if re.fullmatch(r"/api/media/[^/]+", row["path"])]
        assert media_requests and all(row["authorized"] for row in media_requests), "Native media read omitted Authorization"
        for identifier in ("remote-mp4", "remote-mov", "remote-hevc", "compatible-mp4"):
            assert any(row["path"] == f"/api/media/{identifier}" and row.get("responseStatus") == 206
                       for row in media_requests), f"Missing actual AVPlayer authenticated range read: {identifier}"
        transcodes = [row for row in server.requests if row["kind"] == "transcode"]
        transcode_paths = [row["path"] for row in transcodes]
        assert transcode_paths.count("/api/media/remote-corrupt/derivations") == 1
        assert transcode_paths.count("/api/media/remote-hevc/derivations") <= 1
        assert all(path in ("/api/media/remote-corrupt/derivations", "/api/media/remote-hevc/derivations")
                   for path in transcode_paths), "Network or permission failure incorrectly requested a compatibility transcode"
        report["hevcPlayback"] = "compatible transcode" if "/api/media/remote-hevc/derivations" in transcode_paths else "direct native HEVC"
        with sqlite3.connect(db_path) as db:
            assert db.execute("SELECT COUNT(*) FROM local_capture").fetchone()[0] == 400
            assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        report["success"] = True
    finally:
        (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        (output / "fixture-requests.json").write_text(json.dumps(server.requests, indent=2) + "\n")
        server.shutdown()
        server.server_close()
        subprocess.run(["xcrun", "simctl", "shutdown", udid], capture_output=True)
        subprocess.run(["xcrun", "simctl", "delete", udid], capture_output=True)


if __name__ == "__main__":
    main()
