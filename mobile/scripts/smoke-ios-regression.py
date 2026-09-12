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
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).with_name("ios-regression")))
from fixtures import FixtureServer, generate_media  # noqa: E402


def run(*arguments, timeout=180, log=None):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        if log:
            chunks = [chunk.decode(errors="replace") if isinstance(chunk, bytes) else chunk or ""
                      for chunk in (error.stdout, error.stderr)]
            Path(log).write_text("".join(chunks))
        raise
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


def seed_import(db_path, container, media):
    """Add a real receipt after the matched 400-record performance measurement."""
    target = container / "Documents" / "native-regression"
    stamp = "2026-09-12T13:00:00.000Z"
    with sqlite3.connect(db_path) as db:
        db.execute("""INSERT INTO local_import_session(id,source,status,total_count,completed_count,created_at,updated_at)
            VALUES ('fixture-import','files','reviewing',3,3,?,?)""", (stamp, stamp))
        db.execute("INSERT INTO local_intake_choice(session_id,scope,destination) VALUES ('fixture-import','local','pending')")
        for index, name in enumerate(("one", "two", "three")):
            identifier, filename = f"fixture-pick-{name}", f"pick-{name}.png"
            shutil.copyfile(media / "poster.png", target / filename)
            uri = (target / filename).as_uri()
            payload = json.dumps(dict(localUri=uri, fileName=filename, mimeType="image/png", mediaType="image"))
            db.execute("""INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,payload_json,title_source,sync_state)
                VALUES (?,'media_capture',?,?,?,'image',?,'rule_generated','pending')""",
                       (identifier, filename, stamp, uri, payload))
            db.execute("""INSERT INTO local_import_item(id,import_session_id,capture_id,external_id,sort_order,intake_state,local_uri,created_at,updated_at)
                VALUES (?,'fixture-import',?,?,?,'copied',?,?,?)""", (f"import-{index}", identifier, identifier, index, uri, stamp, stamp))


def verify_import(db_path):
    with sqlite3.connect(db_path) as db:
        row = db.execute("SELECT snapshot_json FROM local_import_selection WHERE scope='local' AND session_id='fixture-import'").fetchone()
        assert row, "Native selection was not durably saved"
        selection = json.loads(row[0])
        chosen = {"fixture-pick-one", "fixture-pick-two"}
        assert set(selection["selectedIds"]) == chosen
        assert selection["coverId"] == "fixture-pick-two"
        manual = next(group for group in selection["groups"] if group["reason"] == "manual")
        assert set(manual["ids"]) == chosen and manual["representativeId"] == "fixture-pick-two"
        choice = db.execute("SELECT destination,draft_id FROM local_intake_choice WHERE session_id='fixture-import'").fetchone()
        assert choice and choice[0] == "draft"
        draft = json.loads(db.execute("SELECT snapshot_json FROM local_draft WHERE scope='local' AND id=?", (choice[1],)).fetchone()[0])
        references = {item["localCaptureRef"] for item in draft["content"]["items"]}
        assert references == chosen, "Unselected original was included in the new draft"
        cover = next(item for item in draft["content"]["items"] if item["id"] == draft["content"]["coverItemId"])
        assert cover["localCaptureRef"] == "fixture-pick-two"
        originals = db.execute("SELECT id,local_uri FROM local_capture WHERE id LIKE 'fixture-pick-%'").fetchall()
        assert len(originals) == 3 and all(Path(unquote(urlsplit(uri).path)).is_file() for _, uri in originals)
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 0, "Choosing photos unexpectedly queued an upload"
        return dict(selectedIds=selection["selectedIds"], coverId=selection["coverId"], groups=selection["groups"],
                    revision=selection["revision"], originalsPreserved=3, uploadCount=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile-only", action="store_true", help="Run the identical scrolling metric on a baseline Release app")
    parser.add_argument("--runner-build", type=Path, help="Reuse a precompiled Release XCTest runner (DerivedData directory)")
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
        runner_data = args.runner_build.resolve() if args.runner_build else output / "runner-build"
        if not args.runner_build:
            project_dir = output / "runner-project"
            run("ruby", str(Path(__file__).with_name("ios-regression") / "create-project.rb"), str(project_dir))
            run("xcodebuild", "-project", str(project_dir / "NativeRegression.xcodeproj"), "-scheme", "NativeRegression",
                "-configuration", "Release", "-destination", f"platform=iOS Simulator,id={udid}",
                "-derivedDataPath", str(runner_data), f"ARCHS={report['architecture']}", "ONLY_ACTIVE_ARCH=YES",
                "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_ALLOWED=YES", "build-for-testing", timeout=600, log=output / "runner-build.log")
        xctestruns = list((runner_data / "Build" / "Products").glob("*.xctestrun"))
        assert len(xctestruns) == 1, "Expected exactly one generated UI test specification"
        def relocate_test_root(value):
            if isinstance(value, str):
                return value.replace("__TESTROOT__", str(xctestruns[0].parent))
            if isinstance(value, dict):
                return {key: relocate_test_root(nested) for key, nested in value.items()}
            if isinstance(value, list):
                return [relocate_test_root(nested) for nested in value]
            return value

        specification = relocate_test_root(plistlib.loads(xctestruns[0].read_bytes()))

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
        test_specification = output / "NativeRegression.xctestrun"
        test_specification.write_bytes(plistlib.dumps(specification))

        def test(label, methods):
            started = time.monotonic()
            result_bundle = output / (label + ".xcresult")
            primary_failure = None
            try:
                run("xcodebuild", "test-without-building", "-xctestrun", str(test_specification),
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
        seed_import(db_path, container, media)
        test("import-selection", ["testImportSelectionPersistsAndCreatesOnlySelectedReferences"])
        report["importSelection"] = verify_import(db_path)
        # Same local records, fresh ordinary login screen. Credentials are entered
        # using UIKit controls and persisted by the real SecureStore path.
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE meta SET value='0' WHERE key='welcome_done'")
        test("authenticated-playback", ["testAuthenticatedRemotePlaybackAndRecovery"])
        test("family-viewing", ["testFamilyViewingHidesEditingAndRequiresOwnerExit"])
        media_requests = [row for row in server.requests if re.fullmatch(r"/api/media/[^/]+", row["path"])]
        assert media_requests and all(row["authorized"] for row in media_requests), "Native media read omitted Authorization"
        for identifier in ("remote-mp4", "remote-mov", "remote-hevc", "compatible-mp4", "family-video"):
            assert any(row["path"] == f"/api/media/{identifier}" and row.get("responseStatus") == 206 and row.get("responseBytes", 0) > 2
                       for row in media_requests), f"Missing actual AVPlayer authenticated range read: {identifier}"
        transcodes = [row for row in server.requests if row["kind"] == "transcode"]
        transcode_paths = [row["path"] for row in transcodes]
        assert transcode_paths.count("/api/media/remote-corrupt/derivations") == 1
        assert transcode_paths.count("/api/media/remote-hevc/derivations") <= 1
        assert all(path in ("/api/media/remote-corrupt/derivations", "/api/media/remote-hevc/derivations")
                   for path in transcode_paths), "Network or permission failure incorrectly requested a compatibility transcode"
        report["hevcPlayback"] = "compatible transcode" if "/api/media/remote-hevc/derivations" in transcode_paths else "direct native HEVC"
        viewing_writes = [row for row in server.requests if row["phase"] == "family-viewing"
                          and row["method"] not in ("GET", "HEAD") and row["path"] != "/fixture/control"]
        assert not viewing_writes, "Family viewing unexpectedly sent a mutation request"
        report["familyViewing"] = {"mutationRequests": 0}
        with sqlite3.connect(db_path) as db:
            assert db.execute("SELECT COUNT(*) FROM local_capture").fetchone()[0] == 403
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
