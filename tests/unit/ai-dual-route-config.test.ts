import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASR_BASE_URL,
  DEFAULT_ASR_MODEL,
  DEFAULT_PRIMARY_MODEL,
  loadAiProviderConfig,
  summarizeAiConfiguration,
} from "@/lib/ai/config";

/**
 * M6 双路由配置测试：AI_PROVIDER=dual 的加载、默认值、校验与能力标注。
 */

const DUAL_BASE = {
  AI_PROVIDER: "dual",
  AI_BASE_URL: "https://cpa.example.com/v1",
  AI_API_KEY: "primary-secret",
  ASR_API_KEY: "mimo-secret",
} as const;

describe("dual-route AI configuration (M6)", () => {
  it("loads dual mode with Goal defaults: Luna for text/vision, MiMo for transcription", () => {
    const config = loadAiProviderConfig({ ...DUAL_BASE });
    expect(config.kind).toBe("dual-route");
    if (config.kind !== "dual-route") return;
    expect(config.primary.models.text).toBe(DEFAULT_PRIMARY_MODEL);
    expect(config.primary.models.text).toBe("gpt-5.6-luna");
    expect(config.primary.models.vision).toBe("gpt-5.6-luna");
    // 双路由下主通道不承接转写。
    expect(config.primary.models.transcription).toBeNull();
    expect(config.asr.model).toBe(DEFAULT_ASR_MODEL);
    expect(config.asr.model).toBe("mimo-v2.5-asr");
    expect(config.asr.baseUrl).toBe(DEFAULT_ASR_BASE_URL);
    expect(config.asr.language).toBe("auto");

    // 能力标注:分能力接收方与部署身份。
    expect(config.capabilities.text).toMatchObject({
      available: true,
      providerId: "openai-compatible",
      configurationId: config.primary.configurationId,
    });
    expect(config.capabilities.transcription).toMatchObject({
      available: true,
      model: "mimo-v2.5-asr",
      providerId: "mimo-asr",
      providerName: "MiMo 语音识别",
      configurationId: config.asr.configurationId,
    });
    expect(config.capabilities.embeddings.available).toBe(false);
  });

  it("summarizes dual mode as an aggregate provider name", () => {
    const config = loadAiProviderConfig({ ...DUAL_BASE });
    const summary = summarizeAiConfiguration(config);
    expect(summary.enabled).toBe(true);
    expect(summary.providerId).toBe("dual-route");
    expect(summary.providerName).toContain("+");
    expect(summary.providerName).toContain("MiMo");
  });

  it("primary and ASR configuration ids rotate independently", () => {
    // Key 不进哈希（历史设计：避免任何凭据间接泄露）；轮换靠 revision 变量
    // 与端点/模型变化。ftc ai configure 每次同时生成新的 AI_CONFIGURATION_ID
    // 与 ASR_CONFIGURATION_ID；改一条通道的端点/模型只轮换该通道。
    const base = loadAiProviderConfig({ ...DUAL_BASE });
    expect(base.kind).toBe("dual-route");
    if (base.kind !== "dual-route") return;

    const rotatedAsr = loadAiProviderConfig({
      ...DUAL_BASE,
      ASR_BASE_URL: "https://asr-2.example.com/v1",
    });
    expect(rotatedAsr.kind).toBe("dual-route");
    if (rotatedAsr.kind !== "dual-route") return;
    expect(rotatedAsr.asr.configurationId).not.toBe(base.asr.configurationId);
    expect(rotatedAsr.primary.configurationId).toBe(base.primary.configurationId);

    const rotatedPrimary = loadAiProviderConfig({
      ...DUAL_BASE,
      AI_BASE_URL: "https://cpa-2.example.com/v1",
    });
    expect(rotatedPrimary.kind).toBe("dual-route");
    if (rotatedPrimary.kind !== "dual-route") return;
    expect(rotatedPrimary.primary.configurationId).not.toBe(
      base.primary.configurationId,
    );
    expect(rotatedPrimary.asr.configurationId).toBe(base.asr.configurationId);
  });

  it("rejects dual mode without an ASR key or with an invalid ASR endpoint", () => {
    expect(() =>
      loadAiProviderConfig({ ...DUAL_BASE, ASR_API_KEY: "" }),
    ).toThrowError(/ASR_API_KEY/u);
    expect(() =>
      loadAiProviderConfig({
        ...DUAL_BASE,
        ASR_BASE_URL: "http://api.xiaomimimo.com/v1",
      }),
    ).toThrowError(/ASR_BASE_URL/u);
    expect(() =>
      loadAiProviderConfig({ ...DUAL_BASE, ASR_LANGUAGE: "jp" }),
    ).toThrowError(/ASR_LANGUAGE/u);
  });

  it("accepts loopback ASR endpoints and custom MiMo-compatible bases", () => {
    const config = loadAiProviderConfig({
      ...DUAL_BASE,
      ASR_BASE_URL: "http://127.0.0.1:4000/v1",
      ASR_MODEL: "custom-asr",
      ASR_LANGUAGE: "zh",
    });
    expect(config.kind).toBe("dual-route");
    if (config.kind !== "dual-route") return;
    expect(config.asr.baseUrl).toBe("http://127.0.0.1:4000/v1");
    expect(config.asr.language).toBe("zh");
    expect(config.capabilities.transcription.model).toBe("custom-asr");
  });
});
