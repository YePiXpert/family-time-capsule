"""Boot only a task-owned simulator; retain boot failures before one retry."""
import argparse
import json
from pathlib import Path
import subprocess
import time

# 冷跑的 macos-26 runner 上，第一次启动 iOS 26 模拟器过五分钟是常事
# （run 35354311139 连着两次都卡在 300 秒上）。给够时间，别把慢当成坏。
BOOT_TIMEOUT = 600
# 设计稿的 390 点宽手机。
DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-16e"
# XCTest 等模拟器把应用拉起来的时限到了：应用还没开始跑，什么都没断言。
# run 35736146539（1.0.3 首轮）与 run 35827094155 都是这一句，模拟器自己的启动调用卡了 30 秒以上。
LAUNCH_TIMEOUT = "Timed out attempting to launch app"


def _simctl(*args: str, timeout: int = 180) -> str:
    return subprocess.run(["xcrun", "simctl", *args], check=True, capture_output=True,
                          text=True, timeout=timeout).stdout.strip()


def create_simulator(name: str) -> str:
    """Create a task-owned iPhone 16e on the newest available iOS runtime; returns its UDID."""
    runtimes = json.loads(_simctl("list", "runtimes", "--json"))["runtimes"]
    runtime = max((r for r in runtimes if r.get("isAvailable") and ".iOS-" in r["identifier"]),
                  key=lambda r: tuple(int(n) for n in r["version"].split(".")))
    return _simctl("create", name, DEVICE_TYPE, runtime["identifier"])


def describe_simulator(udid: str) -> dict:
    """Runtime and device-type name of an existing simulator, for evidence reports."""
    types = {t["identifier"]: t["name"] for t in json.loads(_simctl("list", "devicetypes", "--json"))["devicetypes"]}
    for runtime, devices in json.loads(_simctl("list", "devices", "--json"))["devices"].items():
        for device in devices:
            if device["udid"] == udid:
                kind = device.get("deviceTypeIdentifier", "")
                return {"runtime": runtime, "device": types.get(kind, kind)}
    raise RuntimeError(f"Simulator {udid} does not exist")


def warm_up(udid: str):
    """Launch Settings twice on the idle, freshly booted device. The first launches after a
    boot are the slow ones; done here, while the app is still building, they cost nothing.
    Only durations are logged: a slow or failed warm-up must never fail the job."""
    for attempt in (1, 2):
        started = time.monotonic()
        try:
            _simctl("launch", "--terminate-running-process", udid, "com.apple.Preferences")
            outcome = "launched"
        except (subprocess.SubprocessError, OSError) as error:
            outcome = f"did not launch ({error})"
        print(f"Warm-up: Settings {outcome} in {time.monotonic() - started:.0f}s", flush=True)
        try:
            _simctl("terminate", udid, "com.apple.Preferences", timeout=60)
        except (subprocess.SubprocessError, OSError):
            pass


def prepare_simulator(name: str, output: Path) -> str:
    """Create, boot and warm up a simulator before the app under test exists."""
    started = time.monotonic()
    udid = create_simulator(name)
    print(f"Created {name} ({udid}) in {time.monotonic() - started:.0f}s", flush=True)
    boot_simulator(udid, output)
    warm_up(udid)
    return udid


def xctest_launch_timed_out(log: str, bundle: str) -> bool:
    """True only when every failure XCTest reported is the simulator not launching the app in
    time. Assertion failures, crashes and runner errors never match, so they are never retried."""
    failures = [line for line in log.splitlines() if ": error: -[" in line]
    return bool(failures) and all(f"Failed to launch {bundle}: {LAUNCH_TIMEOUT}" in line for line in failures)


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
        started = time.monotonic()
        try:
            result = subprocess.run(command, check=True, capture_output=True,
                                    text=True, timeout=BOOT_TIMEOUT)
            (output / f"simulator-boot-{attempt}.log").write_text(result.stdout + result.stderr)
            print(f"Booted in {time.monotonic() - started:.0f}s", flush=True)
            return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            def text(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
            (output / f"simulator-boot-{attempt}.log").write_text(
                text(error.stdout) + text(error.stderr) + "\n" + str(error) + "\n")
            print(f"Boot attempt {attempt} failed after "
                  f"{time.monotonic() - started:.0f}s: {error}", flush=True)
            if attempt == 2:
                raise
            # 超时和报错要区别对待：bootstatus 被我们杀掉时设备还在后台继续启动，
            # 再等一次就够了；抹掉它等于把一台快好了的设备推回原点，白扔十分钟。
            if isinstance(error, subprocess.TimeoutExpired):
                continue
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


def launch_simulator_app(udid: str, bundle: str, output: Path, label: str):
    """Retry only simctl command timeouts, never app crashes or screen assertions."""
    command = ["xcrun", "simctl", "launch", "--terminate-running-process", udid, bundle]
    for attempt in (1, 2):
        try:
            result = subprocess.run(command, check=True, capture_output=True,
                                    text=True, timeout=300)
            return result.stdout.strip()
        except subprocess.TimeoutExpired as error:
            output.mkdir(parents=True, exist_ok=True)
            def text(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
            (output / f"{label}-launch-{attempt}.log").write_text(
                text(error.stdout) + text(error.stderr) + "\n" + str(error) + "\n")
            if attempt == 2:
                raise
            print(f"simctl launch timed out for {label}; retrying once", flush=True)
            # A timed-out client may have left the app running. The next launch
            # explicitly terminates it; preserve this simulator and its data.


def main():
    # 出包流水线里，验证作业与模拟器构建同时起跑：先在这里建好、启动并热身模拟器，
    # 等构建传上测试包，再把 UDID 交给冒烟脚本（--udid）。
    parser = argparse.ArgumentParser(description="Prepare a simulator ahead of the app under test.")
    parser.add_argument("action", choices=["prepare"])
    parser.add_argument("--name", required=True)
    parser.add_argument("--output", type=Path, required=True, help="evidence directory for the boot logs")
    parser.add_argument("--udid-file", type=Path, required=True)
    args = parser.parse_args()
    udid = prepare_simulator(args.name, args.output.resolve())
    args.udid_file.write_text(udid + "\n")


if __name__ == "__main__":
    main()
