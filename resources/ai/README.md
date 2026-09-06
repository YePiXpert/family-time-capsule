# 内置 AI 检测素材

`smoke.wav` 是本仓库用 FFmpeg 的本地 libflite 合成的非私人声音：
“Hello family. This is a test recording.”（16 kHz，mono PCM，约 2.8 秒）。
不是家人录音，不使用外部 TTS。文字检测使用算术；视觉检测本地生成纯色几何图。

只在操作员明确执行 `ftc ai test --capability …` 后发送，每条命令最多一次请求。
普通 CI 不访问收费 Provider。
