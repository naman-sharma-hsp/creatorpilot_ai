import "server-only";

import type { AiProvider } from "./types";
import { GeminiProvider, type GeminiProviderOptions, GEMINI_CHAT_MODEL } from "./gemini";

export * from "./types";
export * from "./validation";
export {
  GeminiProvider,
  type GeminiProviderOptions,
  DEFAULT_GEMINI_MODEL,
  GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_TIMEOUT_MS,
} from "./gemini";

let defaultProviderInstance: AiProvider | null = null;
let chatProviderInstance: AiProvider | null = null;

/**
 * Retrieves the active AI provider singleton instance or creates a configured instance.
 * Allows seamless provider substitution (e.g. Anthropic, OpenAI) in the future.
 */
export function getAiProvider(options?: GeminiProviderOptions): AiProvider {
  if (options) {
    return new GeminiProvider(options);
  }

  if (!defaultProviderInstance) {
    defaultProviderInstance = new GeminiProvider();
  }

  return defaultProviderInstance;
}

/**
 * Sets or overrides the active provider instance.
 * Useful for automated tests and runtime provider substitution.
 */
export function setAiProvider(provider: AiProvider | null): void {
  defaultProviderInstance = provider;
}

/**
 * Retrieves the specialized server-side chat provider instance.
 * Strictly configured with GEMINI_CHAT_MODEL ("gemini-3.5-flash-lite").
 * Separated from caption generation to preserve model boundaries.
 */
export function getChatAiProvider(): AiProvider {
  if (chatProviderInstance) {
    return chatProviderInstance;
  }
  return new GeminiProvider({
    model: GEMINI_CHAT_MODEL,
  });
}

/**
 * Sets or overrides the active chat provider instance.
 * Useful for automated testing and mocking.
 */
export function setChatAiProvider(provider: AiProvider | null): void {
  chatProviderInstance = provider;
}
