import type { AiCapability } from "./types";

export type AiErrorCode =
  | "ai_aborted"
  | "ai_capability_unavailable"
  | "ai_configuration_invalid"
  | "ai_input_invalid"
  | "ai_network_error"
  | "ai_provider_http_error"
  | "ai_response_invalid"
  | "ai_response_too_large"
  | "ai_timeout";

/** All public fields and messages are safe to log. */
export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }

  toJSON(): Readonly<{ name: string; code: AiErrorCode; message: string }> {
    return { name: this.name, code: this.code, message: this.message };
  }
}
export class AiConfigurationError extends AiError {
  readonly variable: string | null;

  constructor(message: string, variable: string | null = null) {
    super("ai_configuration_invalid", message);
    this.name = "AiConfigurationError";
    this.variable = variable;
  }

  override toJSON(): Readonly<{
    name: string;
    code: AiErrorCode;
    message: string;
    variable: string | null;
  }> {
    return { ...super.toJSON(), variable: this.variable };
  }
}

export class AiInputError extends AiError {
  constructor(message: string) {
    super("ai_input_invalid", message);
    this.name = "AiInputError";
  }
}

export class AiCapabilityUnavailableError extends AiError {
  readonly capability: AiCapability;

  constructor(capability: AiCapability) {
    super(
      "ai_capability_unavailable",
      `AI capability '${capability}' is not available.`,
    );
    this.name = "AiCapabilityUnavailableError";
    this.capability = capability;
  }

  override toJSON(): Readonly<{
    name: string;
    code: AiErrorCode;
    message: string;
    capability: AiCapability;
  }> {
    return { ...super.toJSON(), capability: this.capability };
  }
}

export class AiProviderError extends AiError {
  readonly capability: AiCapability;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(options: {
    capability: AiCapability;
    code: Exclude<
      AiErrorCode,
      | "ai_capability_unavailable"
      | "ai_configuration_invalid"
      | "ai_input_invalid"
    >;
    message: string;
    retryable: boolean;
    status?: number | null;
    requestId?: string | null;
  }) {
    super(options.code, options.message);
    this.name = "AiProviderError";
    this.capability = options.capability;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }

  override toJSON(): Readonly<{
    name: string;
    code: AiErrorCode;
    message: string;
    capability: AiCapability;
    retryable: boolean;
    status: number | null;
    requestId: string | null;
  }> {
    return {
      ...super.toJSON(),
      capability: this.capability,
      retryable: this.retryable,
      status: this.status,
      requestId: this.requestId,
    };
  }
}
