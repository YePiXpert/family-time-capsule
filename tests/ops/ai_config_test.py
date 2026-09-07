import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ftc_ai", ROOT / "scripts/ops/lib/ai.py")
ai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai)


class AiConfigurationTests(unittest.TestCase):
    def test_rejects_newlines_controls_and_non_ai_keys(self):
        original = "AUTH_SECRET=do-not-change\nAI_PROVIDER=disabled\n"
        for value in ("x\nAUTH_SECRET=injected", "x\rFTC_IMAGE=other", "x\x00y"):
            with self.assertRaises(ai.OperationError):
                ai.update_environment(original, {"AI_API_KEY": value})
        with self.assertRaises(ai.OperationError):
            ai.update_environment(original, {"AUTH_SECRET": "injected"})

    def test_real_compose_preserves_quotes_dollars_and_literal_commands(self):
        env = {key: value for key, value in os.environ.items() if key not in ai.AI_KEYS}
        values = ["test'quote", 'test"quote', 'test$DOLLAR', r'test\backslash', r"test\'quote", 'test`cmd`$(cmd)', "test#comment", r'test\n']
        for value in values:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / "env"
                original = "AUTH_SECRET=keep-this-auth-secret\nBETTER_AUTH_URL=https://test.example\nAI_PROVIDER=disabled\n"
                ai.atomic_write(file, ai.update_environment(original, {"AI_API_KEY": value}))
                if os.name == "posix":
                    # 0600 是 Linux 生产的硬性要求；Windows 开发机 NTFS 不呈现真实位。
                    self.assertEqual(file.stat().st_mode & 0o777, 0o600)
                self.assertTrue(file.read_text().startswith(original))
                result = subprocess.run(["docker", "compose", "-f", str(ROOT / "docker-compose.yml"), "--env-file", str(file), "config", "--format", "json"], capture_output=True, text=True, env=env)
                self.assertEqual(result.returncode, 0)
                config = json.loads(result.stdout)
                for service in ("app", "worker"):
                    self.assertEqual(config["services"][service]["environment"]["AI_API_KEY"].replace("$$", "$"), value)
                self.assertEqual(config["services"]["app"]["environment"]["AUTH_SECRET"], "keep-this-auth-secret")

    def test_patches_existing_templates_and_preserves_proxy_volumes(self):
        for mode in ("loopback", "caddy"):
            original = (ROOT / f"scripts/ops/templates/compose.{mode}.yml").read_text()
            legacy = "\n".join(line for line in original.split("\n") if not line.strip().startswith("AI_") or "AI_PROVIDER:" in line)
            patched = ai.update_template(legacy)
            self.assertEqual(ai.update_template(patched), patched)
            self.assertIn("external: true", patched)
            self.assertIn("AUTH_SECRET: ${AUTH_SECRET:", patched)
            for key in ai.AI_KEYS:
                self.assertEqual(patched.count(f"      {key}:"), 2)
            if mode == "caddy":
                self.assertEqual(original.split("  proxy:")[1], patched.split("  proxy:")[1])

    def test_atomic_rollback_on_recreation_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").mkdir()
            (root / "releases/current").mkdir(parents=True)
            (root / "state").mkdir()
            original_env = "AUTH_SECRET=unchanged\nFTC_PROJECT_NAME=ftc-unit-test\nAI_PROVIDER=disabled\n"
            original_compose = (ROOT / "scripts/ops/templates/compose.loopback.yml").read_text()
            (root / "config/env").write_text(original_env)
            (root / "releases/current/compose.yml").write_text(original_compose)
            installation = ai.Installation(root)
            calls = []
            installation.effective_config = lambda: {}
            def fail():
                raise ai.OperationError("test-recreation-failure")
            installation.recreate = fail
            installation.run = lambda args, *rest: calls.append(args)
            with installation.lock(), self.assertRaises(ai.OperationError):
                installation.change({"AI_PROVIDER": "openai-compatible", "AI_API_KEY": "unit-secret"})
            self.assertEqual((root / "config/env").read_text(), original_env)
            self.assertEqual((root / "releases/current/compose.yml").read_text(), original_compose)
            self.assertFalse((root / "state/ai-recovery.json").exists())
            self.assertEqual(calls[0][-2:], ["app", "worker"])
            self.assertIn("--no-deps", calls[0])

    def test_preserves_recovery_record_if_old_service_cannot_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").mkdir()
            (root / "releases/current").mkdir(parents=True)
            (root / "state").mkdir()
            (root / "config/env").write_text("FTC_PROJECT_NAME=ftc-test\nAUTH_SECRET=keep\n")
            (root / "releases/current/compose.yml").write_text((ROOT / "scripts/ops/templates/compose.loopback.yml").read_text())
            installation = ai.Installation(root)
            installation.effective_config = lambda: {}
            def fail(*args):
                raise ai.OperationError("failed")
            installation.recreate = fail
            installation.run = fail
            with self.assertRaises(ai.OperationError):
                installation.change({"AI_PROVIDER": "disabled"})
            recovery = root / "state/ai-recovery.json"
            self.assertTrue(recovery.exists())
            if os.name == "posix":
                self.assertEqual(recovery.stat().st_mode & 0o777, 0o600)


class BaseUrlChangeConfirmationTests(unittest.TestCase):
    """换 BaseURL 的 Key 确认（AI-2）：换服务商必须显式 confirm。"""

    def installation(self, current):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").mkdir()
            (root / "releases/current").mkdir(parents=True)
            (root / "state").mkdir()
            (root / "config/env").write_text("FTC_PROJECT_NAME=ftc-test\nAUTH_SECRET=keep\n")
            (root / "releases/current/compose.yml").write_text((ROOT / "scripts/ops/templates/compose.loopback.yml").read_text())
            install = ai.Installation(root)
            install.effective_config = lambda: current
            yield install

    def base_values(self):
        values = {key: "" for key in ai.AI_KEYS}
        values.update({"AI_PROVIDER": "dual", "AI_BASE_URL": "https://new-provider.example/v1", "AI_API_KEY": "k", "AI_MODEL": "m"})
        return values

    def test_same_host_needs_no_confirmation(self):
        for install in self.installation({"AI_BASE_URL": "https://old.example/v1"}):
            with mock.patch("builtins.input", side_effect=AssertionError("input must not be called")):
                ai.confirm_base_url_change(install, {**self.base_values(), "AI_BASE_URL": "https://old.example/v2"})

    def test_changed_host_requires_typed_confirm(self):
        for install in self.installation({"AI_BASE_URL": "https://old.example/v1"}):
            with mock.patch("builtins.input", return_value="confirm"):
                ai.confirm_base_url_change(install, self.base_values())
            with mock.patch("builtins.input", return_value="yes"):
                with self.assertRaises(ai.OperationError):
                    ai.confirm_base_url_change(install, self.base_values())

    def test_unreadable_current_config_skips_confirmation(self):
        def unavailable():
            raise ai.OperationError("不可用")
        for install in self.installation({}):
            install.effective_config = unavailable
            with mock.patch("builtins.input", side_effect=AssertionError("input must not be called")):
                ai.confirm_base_url_change(install, self.base_values())

    def test_asr_host_change_confirmed_only_in_dual_mode(self):
        for install in self.installation({
            "AI_BASE_URL": "https://same.example/v1",
            "ASR_BASE_URL": "https://old-asr.example/v1",
        }):
            values = {**self.base_values(), "AI_BASE_URL": "https://same.example/v1", "ASR_BASE_URL": "https://new-asr.example/v1"}
            with mock.patch("builtins.input", return_value="confirm"):
                ai.confirm_base_url_change(install, values)
            single = {**values, "AI_PROVIDER": "openai-compatible"}
            with mock.patch("builtins.input", side_effect=AssertionError("input must not be called")):
                ai.confirm_base_url_change(install, single)

    def test_quota_and_profile_values_are_validated(self):
        values = {key: "" for key in ai.AI_KEYS}
        values.update({"AI_PROVIDER": "dual", "AI_BASE_URL": "https://x.example/v1", "AI_API_KEY": "k", "AI_MODEL": "m", "ASR_API_KEY": "a", "ASR_MODEL": "m2"})
        ai.validate_configuration(values)
        with self.assertRaises(ai.OperationError):
            ai.validate_configuration({**values, "AI_TEXT_PROFILE": "grpc"})
        with self.assertRaises(ai.OperationError):
            ai.validate_configuration({**values, "AI_DAILY_MAX_REQUESTS": "-3"})
        ai.validate_configuration({**values, "AI_TEXT_PROFILE": "responses", "AI_DAILY_MAX_REQUESTS": "500"})


if __name__ == "__main__":
    unittest.main()
