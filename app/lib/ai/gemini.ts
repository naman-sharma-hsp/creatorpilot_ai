import "server-only";

import {
  AiAuthenticationError,
  AiConfigurationError,
  AiInvalidInputError,
  AiNetworkError,
  AiRateLimitError,
  AiResponseError,
  AiTimeoutError,
  type AiProvider,
  type AiRequestOptions,
  type StructuredGenerationRequest,
  type StructuredGenerationResponse,
  type TextGenerationRequest,
  type TextGenerationResponse,
} from "./types";
import { validateTextGenerationRequest } from "./validation";

if (typeof window !== "undefined") {
  throw new Error("GeminiProvider can only be executed in a server environment.");
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_CHAT_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_TIMEOUT_MS = 20000; // 20 seconds

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Server-side Gemini API provider implementation.
 * Communicates with Google's official REST endpoints using secure HTTP headers.
 * Secrets are never exposed in URLs, error messages, or client payloads.
 */
export class GeminiProvider implements AiProvider {
  readonly providerName = "gemini";
  readonly defaultModel: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiProviderOptions = {}) {
    this.defaultModel = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = (options.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn || fetch;
  }

  /**
   * Generates natural language text from a validated generation request.
   */
  async generateText(
    request: TextGenerationRequest,
    options: AiRequestOptions = {}
  ): Promise<TextGenerationResponse> {
    validateTextGenerationRequest(request);

    const apiKey = this.resolveApiKey();
    const endpointUrl = `${this.baseUrl}/models/${encodeURIComponent(this.defaultModel)}:generateContent`;
    const payload = this.buildRequestBody(request, false);

    const rawResponse = await this.executeFetch(endpointUrl, apiKey, payload, options);
    return this.parseTextResponse(rawResponse);
  }

  /**
   * Generates strongly-typed structured JSON output from a validated request.
   */
  async generateStructured<T>(
    request: StructuredGenerationRequest,
    options: AiRequestOptions = {}
  ): Promise<StructuredGenerationResponse<T>> {
    validateTextGenerationRequest(request);

    const apiKey = this.resolveApiKey();
    const endpointUrl = `${this.baseUrl}/models/${encodeURIComponent(this.defaultModel)}:generateContent`;
    const payload = this.buildRequestBody(request, true);

    const rawResponse = await this.executeFetch(endpointUrl, apiKey, payload, options);
    const parsed = this.parseTextResponse(rawResponse);

    const data = this.parseJsonPayload<T>(parsed.text);

    return {
      data,
      rawText: parsed.text,
      model: parsed.model,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
    };
  }

  /**
   * Resolves the server-side API key, throwing AiConfigurationError if missing.
   */
  private resolveApiKey(): string {
    const key = this.apiKey || process.env.GEMINI_API_KEY;
    if (!key || typeof key !== "string" || !key.trim()) {
      throw new AiConfigurationError(
        "GEMINI_API_KEY is not configured in the server environment. Please set it in .env.local."
      );
    }
    return key.trim();
  }

  /**
   * Constructs the Google Gemini REST generateContent request body.
   */
  private buildRequestBody(
    request: TextGenerationRequest | StructuredGenerationRequest,
    isJsonOutput: boolean
  ): Record<string, unknown> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    // Map conversation history turns if provided
    if (request.conversationHistory && request.conversationHistory.length > 0) {
      for (const msg of request.conversationHistory) {
        contents.push({
          role: msg.role === "model" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    // Append the current prompt as the latest user turn
    contents.push({
      role: "user",
      parts: [{ text: request.prompt }],
    });

    const body: Record<string, unknown> = { contents };

    // Set system instruction if provided
    if (request.systemInstruction && request.systemInstruction.trim()) {
      body.systemInstruction = {
        parts: [{ text: request.systemInstruction.trim() }],
      };
    }

    // Configure generation parameters
    const generationConfig: Record<string, unknown> = {};

    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }

    if (isJsonOutput) {
      generationConfig.responseMimeType = "application/json";
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return body;
  }

  /**
   * Executes the HTTP request with timeout cancellation and typed error mapping.
   */
  private async executeFetch(
    url: string,
    apiKey: string,
    payload: Record<string, unknown>,
    options: AiRequestOptions
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    // Chain external signal if provided
    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;

    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutTimer);

      if (err instanceof Error) {
        if (err.name === "AbortError" || controller.signal.aborted) {
          throw new AiTimeoutError(`AI generation request timed out after ${timeoutMs}ms.`);
        }
      }

      throw new AiNetworkError("Failed to communicate with AI provider.", err);
    } finally {
      clearTimeout(timeoutTimer);
    }

    // Handle unsuccessful HTTP responses
    if (!response.ok) {
      await this.handleHttpError(response, apiKey);
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new AiResponseError("AI provider returned a malformed non-JSON response body.", response.status);
    }
  }

  /**
   * Translates HTTP error responses into typed application errors.
   * Guarantees the API key is NEVER reflected in the resulting error message.
   */
  private async handleHttpError(response: Response, apiKey: string): Promise<never> {
    let errorDetail = "";

    try {
      const errorJson = (await response.json()) as { error?: { message?: string; status?: string } };
      if (errorJson?.error?.message) {
        errorDetail = errorJson.error.message;
      }
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        errorDetail = "";
      }
    }

    // Safety scrub: ensure API key never appears in error messages
    if (apiKey && errorDetail.includes(apiKey)) {
      errorDetail = errorDetail.replaceAll(apiKey, "[REDACTED_API_KEY]");
    }

    const cleanDetail = errorDetail ? `: ${errorDetail.slice(0, 300)}` : "";

    if (response.status === 401 || response.status === 403) {
      throw new AiAuthenticationError(
        `Gemini API authentication failed (HTTP ${response.status}). Verify GEMINI_API_KEY in server environment.`,
        response.status
      );
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers?.get ? response.headers.get("retry-after") : null;
      let retryAfterMs: number | undefined;
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds) && seconds > 0) {
          retryAfterMs = seconds * 1000;
        }
      }
      throw new AiRateLimitError(
        `Gemini API rate limit or daily quota exceeded (HTTP 429). Please wait before retrying.${cleanDetail}`,
        retryAfterMs
      );
    }

    if (response.status === 400) {
      throw new AiInvalidInputError(`Gemini API rejected request (HTTP 400)${cleanDetail}`);
    }

    if (response.status === 504) {
      throw new AiTimeoutError("Gemini API gateway timed out (HTTP 504).");
    }

    throw new AiResponseError(
      `Gemini API returned an unsuccessful HTTP status ${response.status}${cleanDetail}`,
      response.status
    );
  }

  /**
   * Parses and validates the text output and usage metadata from Gemini response JSON.
   */
  private parseTextResponse(data: Record<string, unknown>): TextGenerationResponse {
    const candidates = data.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }> | undefined;

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      const promptFeedback = data.promptFeedback as { blockReason?: string } | undefined;
      if (promptFeedback?.blockReason) {
        throw new AiResponseError(
          `Prompt was blocked by Gemini content safety filters (Reason: ${promptFeedback.blockReason}).`
        );
      }
      throw new AiResponseError("AI provider returned no generation candidates.");
    }

    const firstCandidate = candidates[0];

    if (firstCandidate.finishReason === "SAFETY" || firstCandidate.finishReason === "BLOCKLIST") {
      throw new AiResponseError(
        `AI generation was blocked by safety filters (Finish Reason: ${firstCandidate.finishReason}).`
      );
    }

    const parts = firstCandidate.content?.parts;
    const textPart = parts && Array.isArray(parts) && parts.length > 0 ? parts[0]?.text : null;

    if (!textPart || typeof textPart !== "string" || !textPart.trim()) {
      throw new AiResponseError("AI provider returned an empty or whitespace text response.");
    }

    const usageMetadata = data.usageMetadata as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    } | undefined;

    return {
      text: textPart.trim(),
      model: this.defaultModel,
      finishReason: firstCandidate.finishReason,
      usage: usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount,
            candidateTokens: usageMetadata.candidatesTokenCount,
            totalTokens: usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }

  /**
   * Safely parses JSON output, stripping any accidental markdown code fences.
   */
  private parseJsonPayload<T>(rawText: string): T {
    let cleaned = rawText.trim();

    // Strip markdown code fences if present (e.g. ```json ... ``` or ``` ... ```)
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new AiResponseError("Failed to parse structured AI response as valid JSON.");
    }
  }
}
