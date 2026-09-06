import io

ASR_BLOCK = """      ASR_CONFIGURATION_ID: ${ASR_CONFIGURATION_ID:-}
      ASR_BASE_URL: ${ASR_BASE_URL:-}
      ASR_API_KEY: ${ASR_API_KEY:-}
      ASR_PROVIDER_LABEL: ${ASR_PROVIDER_LABEL:-}
      ASR_MODEL: ${ASR_MODEL:-}
      ASR_LANGUAGE: ${ASR_LANGUAGE:-}
      ASR_REQUEST_TIMEOUT_MS: ${ASR_REQUEST_TIMEOUT_MS:-}
      ASR_MAX_REQUEST_BYTES: ${ASR_MAX_REQUEST_BYTES:-}
      ASR_MAX_RESPONSE_BYTES: ${ASR_MAX_RESPONSE_BYTES:-}
"""

AI_LAST = "      AI_TRANSCRIPTION_FORMAT: ${AI_TRANSCRIPTION_FORMAT:-}\n"

for path, count in [
    ("docker-compose.yml", 2),
    ("scripts/ops/templates/compose.caddy.yml", 1),
    ("scripts/ops/templates/compose.loopback.yml", 1),
]:
    s = io.open(path, encoding="utf-8").read()
    occurrences = s.count(AI_LAST)
    assert occurrences == count, (path, occurrences)
    s = s.replace(AI_LAST, AI_LAST + ASR_BLOCK)
    io.open(path, "w", encoding="utf-8", newline="").write(s)
    print(f"{path}: ASR block x{occurrences}")

# env.example 模板补 ASR 说明
p = "scripts/ops/templates/env.example"
s = io.open(p, encoding="utf-8").read()
old = "AI_PROVIDER=disabled\n"
new = """AI_PROVIDER=disabled

# M6 双路由（AI_PROVIDER=dual 时生效）：语音转写走 MiMo。
# 默认端点 https://api.xiaomimimo.com/v1，默认模型 mimo-v2.5-asr。
# 主通道（文字/图片）在 dual 模式下默认模型 gpt-5.6-luna。
# ASR_API_KEY=
# ASR_BASE_URL=https://api.xiaomimimo.com/v1
# ASR_MODEL=mimo-v2.5-asr
# ASR_LANGUAGE=auto
"""
assert old in s
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("env.example updated")
