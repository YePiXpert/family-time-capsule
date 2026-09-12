"""Synthetic media + localhost protocol fixture for Release UI verification.

No real credentials or family content are used. This server verifies that the
native client sends Authorization/Range; it does not validate a deployed server.
"""
import json
from pathlib import Path
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


TOKEN = "native-regression-synthetic-session"
STAMP = "2026-09-12T12:00:00.000Z"
VIEWER = dict(id="fixture-user", name="Native fixture", role="viewer", personId=None,
              canCapture=True, canReviewInbox=False, canCreateContributions=False, canEditEvents=False)
FAMILY = dict(id="fixture-family", name="Synthetic family", timezone="UTC")


def generate_media(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    subprocess.run(common + ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                            "-t", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
                            "-c:a", "aac", "-movflags", "+faststart", str(directory / "sample.mp4")], check=True)
    subprocess.run(common + ["-i", str(directory / "sample.mp4"), "-c", "copy",
                            str(directory / "sample.mov")], check=True)
    # HEVC is mandatory in this harness: a missing encoder must not quietly turn
    # an advertised HEVC regression check into a H.264 check.
    subprocess.run(common + ["-i", str(directory / "sample.mp4"), "-c:v", "libx265", "-preset", "ultrafast",
                            "-x265-params", "log-level=error", "-tag:v", "hvc1", "-c:a", "copy",
                            str(directory / "hevc.mov")], check=True)
    subprocess.run(common + ["-i", str(directory / "sample.mp4"), "-frames:v", "1",
                            str(directory / "poster.png")], check=True)
    (directory / "corrupt.mp4").write_bytes(b"synthetic invalid video, not a real movie\n")
    probes = {}
    for name in ("sample.mp4", "sample.mov", "hevc.mov"):
        probes[name] = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(directory / name)
        ], text=True))
    assert probes["hevc.mov"]["streams"][0]["codec_name"] == "hevc"
    (directory / "media-probes.json").write_text(json.dumps(probes, indent=2) + "\n")


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, directory, port=18765):
        super().__init__(("127.0.0.1", port), FixtureHandler)
        self.directory = Path(directory)
        self.requests = []
        self.transcodes = {}
        self.recovery = False
        self.sync_delay = 0

    def start(self):
        thread = threading.Thread(target=self.serve_forever, daemon=True)
        thread.start()
        return thread


def memory_assets():
    return [dict(id=identifier, type="video", filename=filename, mimeType=mime,
                 durationMs=24000, mediaPath=f"/api/media/{identifier}", thumbnailPath=None)
            for identifier, filename, mime in [
                ("remote-mp4", "remote.mp4", "video/mp4"),
                ("remote-mov", "remote.mov", "video/quicktime"),
                ("remote-hevc", "remote-hevc.mov", "video/quicktime"),
                ("remote-corrupt", "compatibility.mp4", "video/mp4"),
                ("remote-denied", "permission.mp4", "video/mp4"),
                ("remote-offline", "network.mp4", "video/mp4"),
                ("remote-slow", "slow.mp4", "video/mp4"),
            ]]


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # Never log headers, credentials, or input passwords.

    def send_json(self, body, status=200):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.body = json.loads(self.rfile.read(length) or b"{}")
        self.handle_route()

    def do_GET(self):
        self.body = {}
        self.handle_route()

    do_HEAD = do_GET

    def handle_route(self):
        path = urlsplit(self.path).path
        authorized = self.headers.get("Authorization") == f"Bearer {TOKEN}"
        self.record = dict(method=self.command, path=path, authorized=authorized,
                           range=self.headers.get("Range"), at=time.monotonic(), kind=self.body.get("kind"))
        self.server.requests.append(self.record)
        if path == "/fixture/control":
            self.server.recovery = self.body.get("recover", False)
            self.server.sync_delay = self.body.get("syncDelay", 0)
            return self.send_json({"ok": True})
        if path == "/api/auth/sign-in/email":
            if self.body.get("email") != "native@example.invalid" or self.body.get("password") != "FixtureOnly123!":
                return self.send_json({"error": "invalid_fixture_login"}, 401)
            return self.send_json({"token": TOKEN})
        if path == "/api/bootstrap":
            return self.send_json(dict(product="family-time-capsule", apiVersion=1,
                                       instanceId="native-fixture", setup={"state": "completed"}))
        if not authorized:
            return self.send_json({"error": "unauthorized"}, 401)
        if path == "/api/mobile/v1/me":
            return self.send_json(dict(status="ready", user={"id": VIEWER["id"], "displayName": VIEWER["name"],
                                                             "email": "native@example.invalid"},
                                       family=FAMILY, account={"role": VIEWER["role"], "personId": None, "isGuardian": False}))
        if path == "/api/mobile/v1/sync":
            time.sleep(self.server.sync_delay)
            event = dict(id="remote-memory", title="Remote native video fixtures", bodyText="Synthetic fixture",
                         occurredAt=STAMP, occurredAtPrecision="exact", locationText=None, childPersonId=None,
                         ageDays=None, ageLabel=None, updatedAt=STAMP, assetCount=len(memory_assets()),
                         participantNames=[], captureIds=[], cover=None)
            return self.send_json(dict(apiVersion=1, serverTime=STAMP, viewer=VIEWER, family=FAMILY,
                                       people=[], events=[event], nextCursor=None))
        if path == "/api/mobile/v1/home":
            return self.send_json(dict(family=FAMILY, capabilities={"canCapture": True}, inbox={"count": 0}, pendingImports=[]))
        if path == "/api/mobile/v1/memories/remote-memory":
            return self.send_json(dict(id="remote-memory", title="Remote native video fixtures", bodyText="",
                                       occurredAt=STAMP, occurredAtWall="2026-09-12T12:00:00", occurredAtPrecision="exact",
                                       ageDays=None, ageLabel=None, locationText=None, childPersonId=None,
                                       participantPersonIds=[], participants=[], sourceNotes=[], assets=memory_assets(),
                                       contributions=[], updatedAt=STAMP, canWrite=False))
        if path.endswith("/derivations"):
            identifier = path.split("/")[-2]
            if self.body.get("kind") == "transcode":
                self.server.transcodes.setdefault(identifier, time.monotonic())
            started = self.server.transcodes.get(identifier)
            jobs = []
            if started:
                ready = time.monotonic() - started > 2
                jobs.append(dict(kind="transcode", status="succeeded" if ready else "running",
                                 outputAssetId="compatible-mp4" if ready else None, errorCode=None))
            return self.send_json({"jobs": jobs, "transcript": None})
        if path.startswith("/api/media/"):
            identifier = path.split("/")[-1]
            if identifier == "remote-denied":
                return self.send_json({"error": "forbidden"}, 403)
            if identifier == "remote-offline" and not self.server.recovery:
                return self.send_json({"error": "temporary_network_failure"}, 503)
            if identifier == "remote-slow" and not self.server.recovery:
                time.sleep(22)
            filename = {"remote-mov": "sample.mov", "remote-hevc": "hevc.mov",
                        "remote-corrupt": "corrupt.mp4"}.get(identifier, "sample.mp4")
            return self.send_media(filename)
        # Optional organizer/read-download requests may fail without affecting
        # playback. Unexpected endpoints remain explicit in the request report.
        return self.send_json({"error": "fixture_endpoint_not_implemented"}, 404)

    def send_media(self, filename):
        raw = (self.server.directory / filename).read_bytes()
        requested = self.headers.get("Range")
        start, end, status = 0, len(raw) - 1, 200
        if requested:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", requested)
            if not match or int(match[1]) >= len(raw):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(raw)}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            start, end, status = int(match[1]), min(int(match[2] or len(raw) - 1), len(raw) - 1), 206
        self.record["responseStatus"] = status
        self.send_response(status)
        self.send_header("Content-Type", "video/quicktime" if filename.endswith(".mov") else "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(raw)}")
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(raw[start:end + 1])
            except (BrokenPipeError, ConnectionResetError):
                pass  # AVPlayer legitimately cancels obsolete/seek range reads.
