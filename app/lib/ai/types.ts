/**
 * Provider-independent AI layer type definitions.
 * Follows vendor-neutral conventions so alternative providers (e.g., Anthropic, OpenAI)
 * can be substituted without refactoring application features.
 */

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export interface TextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  conversationHistory?: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredGenerationRequest extends TextGenerationRequest {
  schemaDescription?: string;
  responseSchema?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens?: number;
  candidateTokens?: number;
  totalTokens?: number;
}

export interface TextGenerationResponse {
  text: string;
  model: string;
  finishReason?: string;
  usage?: TokenUsage;
}

export interface StructuredGenerationResponse<T> {
  data: T;
  rawText: string;
  model: string;
  finishReason?: string;
  usage?: TokenUsage;
}

export interface AiRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly providerName: string;
  readonly defaultModel: string;
  generateText(
    request: TextGenerationRequest,
    options?: AiRequestOptions
  ): Promise<TextGenerationResponse>;
  generateStructured<T>(
    request: StructuredGenerationRequest,
    options?: AiRequestOptions
  ): Promise<StructuredGenerationResponse<T>>;
}

// ============================================================================
// TYPED APPLICATION ERROR HIERARCHY
// ============================================================================

export type AiErrorCode =
  | "CONFIG_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMIT_ERROR"
  | "INVALID_INPUT_ERROR"
  | "TIMEOUT_ERROR"
  | "NETWORK_ERROR"
  | "RESPONSE_ERROR"
  | "UNKNOWN_ERROR";

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    options: {
      code: AiErrorCode;
      status?: number;
      isRetryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "AiError";
    this.code = options.code;
    this.status = options.status;
    this.isRetryable = options.isRetryable ?? false;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export class AiConfigurationError extends AiError {
  constructor(message = "AI provider is not configured. Missing API key or configuration.") {
    super(message, { code: "CONFIG_ERROR", isRetryable: false });
    this.name = "AiConfigurationError";
  }
}

export class AiAuthenticationError extends AiError {
  constructor(message = "AI provider authentication failed. Invalid API credentials.", status = 401) {
    super(message, { code: "AUTH_ERROR", status, isRetryable: false });
    this.name = "AiAuthenticationError";
  }
}

export class AiRateLimitError extends AiError {
  readonly retryAfterMs?: number;

  constructor(
    message = "AI request limit or quota exceeded. Please wait before retrying.",
    retryAfterMs?: number
  ) {
    super(message, { code: "RATE_LIMIT_ERROR", status: 429, isRetryable: true });
    this.name = "AiRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class AiInvalidInputError extends AiError {
  constructor(message: string) {
    super(message, { code: "INVALID_INPUT_ERROR", status: 400, isRetryable: false });
    this.name = "AiInvalidInputError";
  }
}

export class AiTimeoutError extends AiError {
  constructor(message = "AI generation request timed out.") {
    super(message, { code: "TIMEOUT_ERROR", status: 504, isRetryable: true });
    this.name = "AiTimeoutError";
  }
}

export class AiNetworkError extends AiError {
  constructor(message = "Network error occurred while connecting to AI provider.", cause?: unknown) {
    super(message, { code: "NETWORK_ERROR", isRetryable: true, cause });
    this.name = "AiNetworkError";
  }
}

export class AiResponseError extends AiError {
  constructor(message: string, status?: number) {
    super(message, { code: "RESPONSE_ERROR", status, isRetryable: false });
    this.name = "AiResponseError";
  }
}
