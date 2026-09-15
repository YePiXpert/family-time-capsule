"""Collect independent native failures while keeping release acceptance strict."""
from contextlib import contextmanager
import subprocess


class NativeCheckpoints:
    def __init__(self, report):
        self.report = report
        self.errors = []

    @contextmanager
    def check(self, name):
        try:
            yield
        except Exception as error:
            self.errors.append(error)
            self.report.setdefault("failures", []).append({"name": name, "error": f"{type(error).__name__}: {error}"})
            print(f"Native checkpoint failed: {name}: {error}", flush=True)
            # A killed driver may leave a test running, so later fixture writes
            # cannot safely proceed after a process timeout.
            if isinstance(error, subprocess.TimeoutExpired):
                raise

    def require_success(self):
        if self.errors:
            names = ", ".join(failure["name"] for failure in self.report["failures"])
            raise RuntimeError(f"Native regression failures: {names}") from self.errors[0]
