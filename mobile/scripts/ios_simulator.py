"""Boot only a task-owned simulator; retain boot failures before one retry."""
from pathlib import Path
import subprocess


def cleanup_simulator(udid: str, output: Path):
    """Cleanup must not hang the build or replace an application's test failure."""
    logs = []
    for action in ("shutdown", "delete"):
        try:
            result = subprocess.run(["xcrun", "simctl", action, udid],
                                    capture_output=True, text=True, timeout=60)
            logs.append(f"{action}: {result.returncode}\n{result.stdout}{result.stderr}")
        except (subprocess.SubprocessError, OSError) as error:
            logs.append(f"{action}: {error}")
    output.mkdir(parents=True, exist_ok=True)
    (output / "simulator-cleanup.log").write_text("\n".join(logs) + "\n")


def boot_simulator(udid: str, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    for attempt in (1, 2):
        print(f"Booting isolated simulator ({attempt}/2): {udid}", flush=True)
        command = ["xcrun", "simctl", "bootstatus", udid, "-b"]
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=300)
            (output / f"simulator-boot-{attempt}.log").write_text(result.stdout + result.stderr)
            return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            def text(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
            (output / f"simulator-boot-{attempt}.log").write_text(
                text(error.stdout) + text(error.stderr) + "\n" + str(error) + "\n")
            if attempt == 2:
                raise
            # This UDID was freshly created by the caller. Do not reset shared
            # simulators, and do not retry any application assertion or crash.
            subprocess.run(["xcrun", "simctl", "shutdown", udid],
                           capture_output=True, timeout=60)
