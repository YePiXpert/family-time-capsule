import io

p = "scripts/ops/lib/ai.py"
s = io.open(p, encoding="utf-8").read()

# validate_configuration: 支持 disabled/dual 分支 + ASR 校验
old = '''def validate_configuration(values):
    for value in values.values():
        encode_value(value)
        if value.strip() != value:
            raise OperationError("配置值首尾不能有空白。")
    url = urlsplit(values["AI_BASE_URL"])
    if not url.hostname or url.username or url.password or url.query or url.fragment:
        raise OperationError("endpoint 必须是无账号、查询或片段的绝对地址。")
    loopback = url.hostname in ("localhost", "::1") or bool(re.fullmatch(r"127(?:\.\.\d{1,3}){3}", url.hostname))
    if url.scheme != "https" and not (url.scheme == "http" and loopback):
        raise OperationError("公网 endpoint 必须使用 HTTPS；不跳过证书校验。")
    if not values["AI_API_KEY"] or not any(values[key] for key in ("AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL")):
        raise OperationError("需要 Key 和至少一项能力模型。")
    for key in ("AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL"):
        if len(values[key]) > 256:
            raise OperationError("模型名称过长。")
    if len(values["AI_PROVIDER_LABEL"]) > 100:
        raise OperationError("服务名称过长。")'''
new = '''def validate_configuration(values):
    for value in values.values():
        encode_value(value)
        if value.strip() != value:
            raise OperationError("配置值首尾不能有空白。")
    if values["AI_PROVIDER"] not in ("disabled", "openai-compatible", "dual"):
        raise OperationError("AI_PROVIDER 只能是 disabled / openai-compatible / dual。")
    if values["AI_PROVIDER"] == "disabled":
        return
    url = urlsplit(values["AI_BASE_URL"])
    if not url.hostname or url.username or url.password or url.query or url.fragment:
        raise OperationError("endpoint 必须是无账号、查询或片段的绝对地址。")
    loopback = url.hostname in ("localhost", "::1") or bool(re.fullmatch(r"127(?:\.\.\d{1,3}){3}", url.hostname))
    if url.scheme != "https" and not (url.scheme == "http" and loopback):
        raise OperationError("公网 endpoint 必须使用 HTTPS；不跳过证书校验。")
    if not values["AI_API_KEY"] or not any(values[key] for key in ("AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL")):
        raise OperationError("需要 Key 和至少一项能力模型。")
    for key in ("AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL", "ASR_MODEL"):
        if len(values[key]) > 256:
            raise OperationError("模型名称过长。")
    for key in ("AI_PROVIDER_LABEL", "ASR_PROVIDER_LABEL"):
        if len(values[key]) > 100:
            raise OperationError("服务名称过长。")
    if values["AI_PROVIDER"] == "dual":
        asr_url = urlsplit(values["ASR_BASE_URL"] or "https://api.xiaomimimo.com/v1")
        if not asr_url.hostname or asr_url.username or asr_url.password or asr_url.query or asr_url.fragment:
            raise OperationError("MiMo 语音 endpoint 必须是无账号、查询或片段的绝对地址。")
        asr_loopback = asr_url.hostname in ("localhost", "::1") or bool(re.fullmatch(r"127(?:\.\d{1,3}){3}", asr_url.hostname))
        if asr_url.scheme != "https" and not (asr_url.scheme == "http" and asr_loopback):
            raise OperationError("公网语音 endpoint 必须使用 HTTPS；不跳过证书校验。")
        if not values["ASR_API_KEY"] or not values["ASR_MODEL"]:
            raise OperationError("双路由需要 MiMo 语音 Key 与模型。")
        if values["ASR_LANGUAGE"] not in ("auto", "zh", "en"):
            raise OperationError("ASR_LANGUAGE 只能是 auto / zh / en。")'''
assert old in s, "validate"
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("validate_configuration updated")
