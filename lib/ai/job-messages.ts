const MESSAGES: Record<string, string> = {
  dependency_failed: "前面的分析或转录未完成，命名已暂停。重试会保留成功步骤。",
  insufficient_evidence: "现有资料不足以给出可靠建议，请补充文字或清晰语音。",
  organizer_batch_limit: "一次最多整理 10 份素材，请减少本次选择。",
  video_duration_limit: "这段视频超过 2 分钟，暂不支持 AI 整理。原件仍可播放。",
  video_too_large: "视频超过 128 MiB，暂不支持 AI 整理。原件仍可播放。",
  video_duration_unknown: "无法可靠读取视频时长，未发送给 AI。",
  video_has_no_audio: "视频没有可提取的音轨，可继续使用画面分析。",
  video_requires_manual_request: "视频需要你手动选择处理。",
  audio_extraction_failed: "暂时无法读取视频音轨，原视频仍可播放。",
  ffmpeg_unavailable: "服务器暂不支持视频处理，请联系管理员。",
  frame_extraction_failed: "暂时无法读取视频画面，原视频仍可播放。",
  audio_too_large: "音频超过 25 MiB，暂不支持转写。原件仍可播放。",
  ai_timeout: "服务响应超时，未自动重试；远端可能已计入用量。",
  ai_network_error: "暂时无法连接整理服务，请稍后查看任务状态。",
  ai_provider_http_error: "整理服务拒绝了请求，请在 AI 设置中查看检测状态。",
  configuration_changed: "服务配置已变化，请核对设置后重新选择处理。",
  consent_changed: "外部处理授权已变化，这次任务已停止。",
  authorization_revoked: "处理权限已变化，这次任务已停止。",
  source_changed: "素材内容已变化，需要重新选择处理。",
  ai_aborted: "已停止本地处理；已经发出的远端请求可能仍在处理。",
};
export function aiJobFailureMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "这次整理未完成。原件仍可查看，请检查 AI 设置后重试。";
}
