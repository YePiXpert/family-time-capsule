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
            # This UDID was freshly created by the caller, so resetting it cannot
            # touch a shared simulator. Do not retry any application assertion or
            # crash. A device wedged on "Waiting on System App" rarely recovers
            # from a plain reboot, so erase it to hand attempt 2 a clean device.
            # Neither call may abort the retry this function exists to provide.
            for action in ("shutdown", "erase"):
                try:
                    subprocess.run(["xcrun", "simctl", action, udid],
                                   capture_output=True, timeout=120)
                except (subprocess.SubprocessError, OSError) as reset_error:
                    with (output / f"simulator-boot-{attempt}.log").open("a") as log:
                        log.write(f"\n{action} before retry: {reset_error}\n")
