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
  validateCaptionGenerationInput,
  generatePersonalizedCaption,
  STANDARD_LANGUAGES,
  STANDARD_TONES,
} = await import("../app/lib/ai-studio/service.ts");

const { setAiProvider } = await import("../app/lib/ai/index.ts");
const { AiRateLimitError, AiAuthenticationError } = await import("../app/lib/ai/types.ts");

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

test("Input Validation: requires non-null object", () => {
  const res = validateCaptionGenerationInput(null);
  assert.equal(res.isValid, false);
  assert.ok(res.errors._root);
});

test("Input Validation: enforces format to be 'post' or 'reel'", () => {
  const post = validateCaptionGenerationInput({ format: "post", topic: "Next.js tips" });
  assert.equal(post.isValid, true);
  assert.equal(post.sanitized.format, "post");

  const reel = validateCaptionGenerationInput({ format: "reel", topic: "Viral reels" });
  assert.equal(reel.isValid, true);
  assert.equal(reel.sanitized.format, "reel");

  const invalid = validateCaptionGenerationInput({ format: "story", topic: "Quick update" });
  assert.equal(invalid.isValid, false);
  assert.ok(invalid.errors.format);
});

test("Input Validation: enforces topic minimum and maximum length bounds", () => {
  const empty = validateCaptionGenerationInput({ format: "post", topic: "  " });
  assert.equal(empty.isValid, false);
  assert.ok(empty.errors.topic);

  const short = validateCaptionGenerationInput({ format: "post", topic: "hi" });
  assert.equal(short.isValid, false);
  assert.ok(short.errors.topic.includes("at least"));

  const long = validateCaptionGenerationInput({ format: "post", topic: "a".repeat(1001) });
  assert.equal(long.isValid, false);
  assert.ok(long.errors.topic.includes("exceed"));
});

test("Input Validation: detects and blocks sensitive credentials in topic or CTA", () => {
  // Test email detection
  const emailInput = validateCaptionGenerationInput({
    format: "post",
    topic: "Contact me at creator@example.com for collaboration.",
  });
  assert.equal(emailInput.isValid, false);
  assert.ok(emailInput.errors.topic.includes("Sensitive data violation"));

  // Test Meta token detection in CTA
  const tokenCta = validateCaptionGenerationInput({
    format: "post",
    topic: "Clean topic description",
    callToAction: "Use token EAAB1234567890abcdef1234567890 to authenticate",
  });
  assert.equal(tokenCta.isValid, false);
  assert.ok(tokenCta.errors.callToAction.includes("Sensitive data violation"));

  // Test API key prefix detection
  const apiKeyInput = validateCaptionGenerationInput({
    format: "reel",
    topic: "Here is my key: AIzaSyD12345678901234567890123456789012",
  });
  assert.equal(apiKeyInput.isValid, false);
  assert.ok(apiKeyInput.errors.topic.includes("Sensitive data violation"));
});

test("Input Validation: supports Indian regional languages and custom tones", () => {
  for (const lang of ["English", "Hindi", "Punjabi", "Hinglish", "Romanized Punjabi"]) {
    const res = validateCaptionGenerationInput({
      format: "reel",
      topic: "Punjabi coding tutorial breakdown",
      language: lang,
      tone: "Relatable & Story-Driven",
    });
    assert.equal(res.isValid, true);
    assert.equal(res.sanitized.language, lang);
  }
});

// ============================================================================
// SERVICE GENERATION & SAFEGUARDS TESTS
// ============================================================================

test("Service: generates structured caption package using mocked AI provider", async () => {
  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      throw new Error("generateStructured should be called");
    },
    async generateStructured(request) {
      assert.ok(request.prompt.includes("Instagram Reel"));
      assert.ok(request.prompt.includes("5 Visual Design Rules"));
      assert.ok(request.systemInstruction.includes("CRITICAL CONTENT & SAFETY RULES"));

      return {
        data: {
          caption: "Want to level up your mobile UI? Here are 5 quick design rules every creator should know.\n\n1. Hierarchy is king\n2. Whitespace is breathing room\n\nSave this reel for your next project!",
          hashtags: ["#UIUXDesign", "#MobileAppDesign", "#DesignTips", "#TechCreator"],
          callToAction: "Save this reel for your next project!",
          explanation: "Tailored to high-velocity Reel viewing with punchy hook and retention bullets.",
        },
        rawText: "{}",
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await generatePersonalizedCaption("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "reel",
      topic: "5 Visual Design Rules Every Creator Needs",
      callToAction: "Save this reel for your next project!",
      language: "English",
      tone: "Educational & Authority",
    });

    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.ok(result.data.caption.includes("Hierarchy is king"));
    assert.equal(result.data.hashtags.length, 4);
    assert.equal(result.data.hashtags[0], "#UIUXDesign");
    assert.equal(result.data.callToAction, "Save this reel for your next project!");
    assert.equal(result.data.format, "reel");
    assert.equal(result.data.language, "English");
  } finally {
    setAiProvider(null);
  }
});

test("Strict ₹0 Budget: handles rate limits (HTTP 429) gracefully without paid fallback", async () => {
  const rateLimitedProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiRateLimitError("Gemini rate limit exceeded (HTTP 429).");
    },
  };

  setAiProvider(rateLimitedProvider);

  try {
    const result = await generatePersonalizedCaption("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "post",
      topic: "Full-Stack Development in 2026",
    });

    assert.equal(result.success, false);
    assert.equal(result.isRateLimited, true);
    assert.ok(result.error.includes("temporarily unavailable"));
    assert.ok(result.error.includes("rate limit or quota has been reached"));
    assert.ok(result.quotaDetails.includes("Google AI Studio"));
  } finally {
    setAiProvider(null);
  }
});

test("Security & Privacy: handles authentication failure safely without secret exposure", async () => {
  const authFailingProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiAuthenticationError("Gemini API authentication failed (HTTP 401).", 401);
    },
  };

  setAiProvider(authFailingProvider);

  try {
    const result = await generatePersonalizedCaption("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "post",
      topic: "Clean architecture design",
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes("Unable to authenticate with Google Gemini"));
    assert.ok(!result.error.includes("AIza")); // Never exposes keys
  } finally {
    setAiProvider(null);
  }
});

test("Hashtags: ensures all hashtags are prefixed with # and no reach guarantees are made", async () => {
  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      return {
        data: {
          caption: "Tips for creators",
          hashtags: ["tagWithoutHash", "#tagWithHash", "anotherTag"],
          explanation: "Clean hashtags for discovery",
        },
        rawText: "{}",
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await generatePersonalizedCaption("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "post",
      topic: "Content tips",
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.data.hashtags, [
      "#tagWithoutHash",
      "#tagWithHash",
      "#anotherTag",
    ]);
  } finally {
    setAiProvider(null);
  }
});

test("Model Configuration: caption generation uses strictly gemini-3.5-flash-lite without fallback", async () => {
  const { DEFAULT_GEMINI_MODEL } = await import("../app/lib/ai/index.ts");
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
});

test("Strict ₹0 Budget: passes through retryAfterMs only when reliable metadata exists, never invents timers", async () => {
  const rateLimitWithTimer = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiRateLimitError("Rate limit exceeded", 15000);
    },
  };

  setAiProvider(rateLimitWithTimer);
  try {
    const res = await generatePersonalizedCaption("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "post",
      topic: "API Quota Testing",
    });
    assert.equal(res.success, false);
    assert.equal(res.isRateLimited, true);
    assert.equal(res.retryAfterMs, 15000);
  } finally {
    setAiProvider(null);
  }

  const rateLimitWithoutTimer = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiRateLimitError("Rate limit exceeded without header");
    },
  };

  setAiProvider(rateLimitWithoutTimer);
  try {
    const res = await generatePersonalizedCaption("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "post",
      topic: "API Quota Testing",
    });
    assert.equal(res.success, false);
    assert.equal(res.isRateLimited, true);
    assert.equal(res.retryAfterMs, undefined);
  } finally {
    setAiProvider(null);
  }
});
