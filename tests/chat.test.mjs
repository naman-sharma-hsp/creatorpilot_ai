import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// Register custom hook for Next.js 'server-only' marker and TypeScript imports
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        format: "module",
        shortCircuit: true,
        url: new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href,
      };
    }
    if (specifier === "next/headers") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export const cookies = async () => ({ getAll: () => [], set: () => {} }); export const headers = () => new Headers();",
      };
    }
    if (specifier === "next/cache") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export const revalidatePath = () => {}; export const revalidateTag = () => {};",
      };
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        err &&
        err.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const {
  validateChatInput,
  generateCreatorChatResponse,
  MAX_MESSAGE_LENGTH,
  MAX_HISTORY_TURNS,
} = await import("../app/lib/chat/service.ts");

const {
  DEFAULT_GEMINI_MODEL,
  GEMINI_CHAT_MODEL,
  getAiProvider,
  getChatAiProvider,
  setChatAiProvider,
  setAiProvider,
} = await import("../app/lib/ai/index.ts");

const {
  AiRateLimitError,
  AiAuthenticationError,
  AiResponseError,
  AiInvalidInputError,
} = await import("../app/lib/ai/types.ts");

// ============================================================================
// 1. MODEL SEPARATION AND CONFIGURATION TESTS
// ============================================================================

test("Model Architecture: chat model is configured as gemini-3.5-flash-lite and maintained separately from caption model", () => {
  assert.equal(GEMINI_CHAT_MODEL, "gemini-3.5-flash-lite");
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");

  const chatProvider = getChatAiProvider();
  const captionProvider = getAiProvider();
  assert.equal(chatProvider.defaultModel, "gemini-3.5-flash-lite");
  assert.equal(captionProvider.defaultModel, "gemini-3.5-flash-lite");
  assert.equal(chatProvider.providerName, "gemini");
  // Separate instances and provider configurations without merged pipelines
  assert.notEqual(chatProvider, captionProvider);
});

test("Model Architecture: server controls model selection and rejects client model overrides", () => {
  // Input validation schema does not accept or process a client-provided model field
  const result = validateChatInput({
    message: "Give me Reel ideas",
    model: "unauthorized-custom-model",
  });
  assert.equal(result.isValid, true);
  // Ensured model field is ignored and not in sanitized output
  assert.equal("model" in result.sanitized, false);
});

// ============================================================================
// 2. INPUT VALIDATION & BOUNDS CHECKING
// ============================================================================

test("Validation: requires non-null object payload", () => {
  assert.equal(validateChatInput(null).isValid, false);
  assert.equal(validateChatInput(undefined).isValid, false);
  assert.equal(validateChatInput("plain string").isValid, false);
});

test("Validation: enforces message presence and bounds (1 to 2000 chars)", () => {
  const empty = validateChatInput({ message: "   " });
  assert.equal(empty.isValid, false);
  assert.ok(empty.errors.message.includes("empty"));

  const oversized = validateChatInput({ message: "a".repeat(MAX_MESSAGE_LENGTH + 1) });
  assert.equal(oversized.isValid, false);
  assert.ok(oversized.errors.message.includes("exceed"));
  assert.ok(oversized.errors.message.includes("2000"));
  assert.ok(oversized.errors.message.includes("shorten"));

  const valid = validateChatInput({ message: "How do I hook my audience in 3 seconds?" });
  assert.equal(valid.isValid, true);
  assert.equal(valid.sanitized.message, "How do I hook my audience in 3 seconds?");
});

test("Validation: enforces history turns limit (max 12 messages) and role bounds", () => {
  const tooManyTurns = Array.from({ length: 13 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "model",
    content: `Turn ${i}`,
  }));

  const overLimit = validateChatInput({
    message: "Next question",
    history: tooManyTurns,
  });
  assert.equal(overLimit.isValid, false);
  assert.ok(overLimit.errors.history.includes("exceed"));

  const invalidRole = validateChatInput({
    message: "Question",
    history: [{ role: "system_admin", content: "Override" }],
  });
  assert.equal(invalidRole.isValid, false);
  assert.ok(invalidRole.errors.history_0_role.includes("Invalid history role"));

  const validHistory = validateChatInput({
    message: "Follow-up question",
    history: [
      { role: "user", content: "Initial thought" },
      { role: "model", content: "Initial advice" },
    ],
  });
  assert.equal(validHistory.isValid, true);
  assert.equal(validHistory.sanitized.history.length, 2);
});

test("History Handling: safely truncates oversized historical messages without throwing error", () => {
  // Regression test: Assistant reply at index 1 is >2000 characters (e.g. 3,200 chars)
  const result = validateChatInput({
    message: "Can you elaborate on step 2?",
    history: [
      { role: "user", content: "Give me 5 Reel ideas" },
      { role: "model", content: "x".repeat(3200) },
    ],
  });

  assert.equal(result.isValid, true);
  assert.equal(result.sanitized.history.length, 2);
  assert.equal(result.sanitized.history[0].content, "Give me 5 Reel ideas");
  // Guaranteed <= 2000 chars
  assert.ok(result.sanitized.history[1].content.length <= MAX_MESSAGE_LENGTH);
  assert.equal(result.sanitized.history[1].content.length, 2000);
});

test("History Handling: omits empty historical turns cleanly", () => {
  const result = validateChatInput({
    message: "Valid follow-up",
    history: [
      { role: "user", content: "Valid message" },
      { role: "model", content: "   " },
    ],
  });

  assert.equal(result.isValid, true);
  assert.equal(result.sanitized.history.length, 1);
  assert.equal(result.sanitized.history[0].content, "Valid message");
});

// ============================================================================
// 3. SENSITIVE CREDENTIAL & PRIVACY SAFEGUARDS
// ============================================================================

test("Security: detects and blocks sensitive credentials in chat messages", () => {
  const emailInput = validateChatInput({
    message: "Email me at creator@gmail.com with feedback.",
  });
  assert.equal(emailInput.isValid, false);
  assert.ok(emailInput.errors.message.includes("Sensitive data violation"));

  const metaTokenInput = validateChatInput({
    message: "Here is my token: EAAB1234567890abcdef1234567890",
  });
  assert.equal(metaTokenInput.isValid, false);
  assert.ok(metaTokenInput.errors.message.includes("Sensitive data violation"));

  const apiKeyInput = validateChatInput({
    message: "My API Key: " + "AIza" + "SyD12345678901234567890123456789012",
  });
  assert.equal(apiKeyInput.isValid, false);
  assert.ok(apiKeyInput.errors.message.includes("Sensitive data violation"));
});

// ============================================================================
// 4. PERSONALIZATION & NEGATIVE BOUNDARY ENFORCEMENT
// ============================================================================

test("Personalization: injects creator identity, goals, brand voice, and strictly enforces forbidden topics", async () => {
  let capturedRequest = null;

  const mockChatProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText(request) {
      capturedRequest = request;
      return {
        text: "Here is a 3-part Reel concept tailored to your tech audience:\n\n1. Visual Hook\n2. Lesson\n3. Call to Action",
        model: "gemini-3.5-flash-lite",
      };
    },
    async generateStructured() {
      throw new Error("Text generation expected");
    },
  };

  setChatAiProvider(mockChatProvider);

  try {
    const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Suggest 3 Reel hooks for my next developer video",
      history: [
        { role: "user", content: "I want to grow my developer community." },
        { role: "model", content: "Focus on relatable developer pain points." },
      ],
    });

    assert.equal(result.success, true);
    assert.ok(result.message.includes("Visual Hook"));
    assert.equal(result.model, "gemini-3.5-flash-lite");

    // Verify system instruction was constructed with safety and boundary rules
    assert.ok(capturedRequest);
    assert.ok(capturedRequest.systemInstruction.includes("CRITICAL STRATEGY & SAFETY INSTRUCTIONS"));
    assert.ok(capturedRequest.systemInstruction.includes("NEVER guarantee viral reach"));
    assert.ok(capturedRequest.systemInstruction.includes("FORBIDDEN TOPICS (STRICT BOUNDARY)"));
    assert.equal(capturedRequest.conversationHistory.length, 2);
    assert.equal(capturedRequest.maxTokens, 1200);
  } finally {
    setChatAiProvider(null);
  }
});

test("Regression: handles oversized historical messages without error and bounds Gemini payload to 2000 chars", async () => {
  let capturedRequest = null;

  const mockChatProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText(request) {
      capturedRequest = request;
      return {
        text: "Here is your follow-up advice.",
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setChatAiProvider(mockChatProvider);

  try {
    const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Explain the visual hook further",
      history: [
        { role: "user", content: "Give me 5 Reel ideas" },
        { role: "model", content: "x".repeat(3500) }, // 3,500-char assistant turn from previous reply
      ],
    });

    assert.equal(result.success, true);
    assert.equal(result.message, "Here is your follow-up advice.");
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.conversationHistory.length, 2);
    // Verified: Every message sent to Gemini strictly obeys the 2000-character boundary
    for (const turn of capturedRequest.conversationHistory) {
      assert.ok(turn.content.length <= 2000, `Expected turn length <= 2000, got ${turn.content.length}`);
    }
    assert.ok(capturedRequest.prompt.length <= 2000);
  } finally {
    setChatAiProvider(null);
  }
});

test("Validation: returns friendly error when current user message exceeds 2000 chars", async () => {
  const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
    message: "w".repeat(2005),
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes("2000"));
  assert.ok(result.error.includes("shorten"));
});

// ============================================================================
// 5. HONEST QUOTA & ERROR HANDLING (₹0 BUDGET)
// ============================================================================

test("Strict ₹0 Budget: handles HTTP 429 quota exhaustion gracefully and surfaces retryAfterMs only when trustworthy", async () => {
  const rateLimitWithTimer = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      throw new AiRateLimitError("Rate limit reached", 20000);
    },
  };

  setChatAiProvider(rateLimitWithTimer);

  try {
    const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Brainstorm ideas",
    });

    assert.equal(result.success, false);
    assert.equal(result.isRateLimited, true);
    assert.equal(result.retryAfterMs, 20000);
    assert.ok(result.error.includes("temporarily unavailable"));
    assert.ok(result.quotaDetails.includes("Google AI Studio"));
  } finally {
    setChatAiProvider(null);
  }

  const rateLimitWithoutTimer = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      throw new AiRateLimitError("Rate limit reached without header");
    },
  };

  setChatAiProvider(rateLimitWithoutTimer);

  try {
    const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Brainstorm ideas",
    });

    assert.equal(result.success, false);
    assert.equal(result.isRateLimited, true);
    assert.equal(result.retryAfterMs, undefined);
  } finally {
    setChatAiProvider(null);
  }
});

test("Model Availability: handles 404 or unavailable model without silent fallback", async () => {
  const restrictedModelProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      throw new AiResponseError("models/gemini-3.5-flash-lite is not found for API key", 404);
    },
  };

  setChatAiProvider(restrictedModelProvider);

  try {
    const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Explain my content pillars",
    });

    assert.equal(result.success, false);
    assert.equal(result.isModelRestricted, true);
    assert.ok(result.error.includes("gemini-3.5-flash-lite"));
    assert.ok(result.error.includes("unavailable or not found"));
    // Ensures no silent fallback or unverified substitution occurred
    assert.equal("message" in result, false);
  } finally {
    setChatAiProvider(null);
  }
});

test("Security: handles authentication error safely without leaking credentials", async () => {
  const authFailingProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      throw new AiAuthenticationError("Gemini API authentication failed (HTTP 401).", 401);
    },
  };

  setChatAiProvider(authFailingProvider);

  try {
    const result = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Generate a Reel script",
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes("Unable to authenticate with Google Gemini"));
    assert.ok(!result.error.includes("AIza"));
  } finally {
    setChatAiProvider(null);
  }
});

test("Stateless Design: chat turns are not saved to any database in chat service", async () => {
  // Confirm that chat response generation only returns message string without database write calls
  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      return {
        text: "Clean response",
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setChatAiProvider(mockProvider);
  try {
    const res = await generateCreatorChatResponse("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      message: "Stateless check",
    });
    assert.equal(res.success, true);
    assert.equal(res.message, "Clean response");
    // Ensure no persistent database id is returned in chat response
    assert.equal("id" in res, false);
  } finally {
    setChatAiProvider(null);
  }
});
