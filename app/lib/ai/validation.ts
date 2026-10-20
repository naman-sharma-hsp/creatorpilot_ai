import { AiInvalidInputError, type TextGenerationRequest } from "./types";

export const MAX_PROMPT_LENGTH = 30000;
export const MAX_SYSTEM_INSTRUCTION_LENGTH = 10000;
export const MAX_CONVERSATION_TURNS = 50;
export const MAX_MESSAGE_LENGTH = 20000;
export const MIN_TEMPERATURE = 0;
export const MAX_TEMPERATURE = 2;
export const MIN_MAX_TOKENS = 1;
export const MAX_MAX_TOKENS = 8192;

/**
 * Recognized sensitive credential and personal data patterns.
 * NOTE: Pattern matching is a defense-in-depth safety net and cannot detect
 * every possible private identifier. Callers must always practice strict
 * data minimization before constructing generation requests.
 */
export const SENSITIVE_PATTERNS = [
  {
    name: "Email Address",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    description: "Personal email address detected in prompt payload.",
  },
  {
    name: "JSON Web Token (JWT)",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    description: "JWT access or identity token detected in prompt payload.",
  },
  {
    name: "Meta / Instagram Access Token",
    regex: /\b(?:EAAB|IGQV|IGQJ)[A-Za-z0-9_-]{20,}\b/,
    description: "Meta or Instagram access token detected in prompt payload.",
  },
  {
    name: "Bearer Token Authorization Header",
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}\b/i,
    description: "Bearer authorization credential detected in prompt payload.",
  },
  {
    name: "API Secret Key",
    regex: /\b(?:AIza[0-9A-Za-z-_]{35}|sbp_[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{20,})\b/,
    description: "Known API secret key prefix detected in prompt payload.",
  },
];

/**
 * Inspects a string for known sensitive credentials or tokens.
 * Returns information on the first detected match, or null if clean.
 */
export function detectSensitivePattern(text: string): { name: string; description: string } | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(text)) {
      return { name: pattern.name, description: pattern.description };
    }
  }

  return null;
}

/**
 * Throws an AiInvalidInputError if the provided text contains any known sensitive pattern.
 */
export function assertNoSensitivePatterns(text: string, fieldName = "prompt"): void {
  const match = detectSensitivePattern(text);
  if (match) {
    throw new AiInvalidInputError(
      `Sensitive data violation in ${fieldName}: ${match.name}. Provider requests must not contain credentials, tokens, or personal identifiers.`
    );
  }
}

/**
 * Sanitizes text by replacing recognized sensitive token/credential patterns with a redaction marker.
 */
export function sanitizePromptText(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(new RegExp(pattern.regex, "g"), "[REDACTED]");
  }
  return sanitized;
}

/**
 * Filters an arbitrary object using a strict allowlist of allowed property keys.
 * Defends against accidental leakage of complete database rows or session objects.
 */
export function createSanitizedPromptContext<T extends Record<string, unknown>>(
  context: T,
  allowlist: (keyof T)[]
): Partial<T> {
  if (!context || typeof context !== "object") {
    return {};
  }

  const sanitized: Partial<T> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(context, key) && context[key] !== undefined) {
      sanitized[key] = context[key];
    }
  }
  return sanitized;
}

/**
 * Validates a text generation request before it reaches the provider adapter.
 * Enforces bounded size limits, valid parameter types, and absence of known credential leaks.
 */
export function validateTextGenerationRequest(request: TextGenerationRequest): void {
  if (!request || typeof request !== "object") {
    throw new AiInvalidInputError("Generation request must be a non-null object.");
  }

  if (typeof request.prompt !== "string" || !request.prompt.trim()) {
    throw new AiInvalidInputError("Generation request prompt is required and must be a non-empty string.");
  }

  if (request.prompt.length > MAX_PROMPT_LENGTH) {
    throw new AiInvalidInputError(
      `Prompt exceeds maximum allowed length of ${MAX_PROMPT_LENGTH} characters (received ${request.prompt.length}).`
    );
  }

  assertNoSensitivePatterns(request.prompt, "prompt");

  if (request.systemInstruction !== undefined) {
    if (typeof request.systemInstruction !== "string") {
      throw new AiInvalidInputError("System instruction must be a string if provided.");
    }
    if (request.systemInstruction.length > MAX_SYSTEM_INSTRUCTION_LENGTH) {
      throw new AiInvalidInputError(
        `System instruction exceeds maximum allowed length of ${MAX_SYSTEM_INSTRUCTION_LENGTH} characters.`
      );
    }
    assertNoSensitivePatterns(request.systemInstruction, "systemInstruction");
  }

  if (request.temperature !== undefined) {
    if (
      typeof request.temperature !== "number" ||
      Number.isNaN(request.temperature) ||
      request.temperature < MIN_TEMPERATURE ||
      request.temperature > MAX_TEMPERATURE
    ) {
      throw new AiInvalidInputError(
        `Temperature must be a number between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}.`
      );
    }
  }

  if (request.maxTokens !== undefined) {
    if (
      typeof request.maxTokens !== "number" ||
      !Number.isInteger(request.maxTokens) ||
      request.maxTokens < MIN_MAX_TOKENS ||
      request.maxTokens > MAX_MAX_TOKENS
    ) {
      throw new AiInvalidInputError(
        `maxTokens must be an integer between ${MIN_MAX_TOKENS} and ${MAX_MAX_TOKENS}.`
      );
    }
  }

  if (request.conversationHistory !== undefined) {
    if (!Array.isArray(request.conversationHistory)) {
      throw new AiInvalidInputError("Conversation history must be an array of messages.");
    }
    if (request.conversationHistory.length > MAX_CONVERSATION_TURNS) {
      throw new AiInvalidInputError(
        `Conversation history exceeds maximum turn limit of ${MAX_CONVERSATION_TURNS} messages.`
      );
    }

    for (let i = 0; i < request.conversationHistory.length; i++) {
      const msg = request.conversationHistory[i];
      if (!msg || typeof msg !== "object") {
        throw new AiInvalidInputError(`Message at index ${i} must be a valid object.`);
      }
      if (!["user", "model", "system"].includes(msg.role)) {
        throw new AiInvalidInputError(
          `Message at index ${i} has invalid role "${msg.role}". Allowed roles are user, model, system.`
        );
      }
      if (typeof msg.content !== "string") {
        throw new AiInvalidInputError(`Message at index ${i} content must be a string.`);
      }
      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        throw new AiInvalidInputError(
          `Message at index ${i} exceeds maximum message length of ${MAX_MESSAGE_LENGTH} characters.`
        );
      }
      assertNoSensitivePatterns(msg.content, `conversationHistory[${i}].content`);
    }
  }
}
