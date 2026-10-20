import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Register custom hook so Node's test runner can load Next.js 'server-only' package marker
// and resolve TypeScript source modules dynamically
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        format: "module",
        shortCircuit: true,
        url: new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href,
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

// Dynamically import AI modules after registering loader hook
const {
  GeminiProvider,
  getAiProvider,
  setAiProvider,
  DEFAULT_GEMINI_MODEL,
  AiError,
  AiConfigurationError,
  AiAuthenticationError,
  AiRateLimitError,
  AiInvalidInputError,
  AiTimeoutError,
  AiNetworkError,
  AiResponseError,
  validateTextGenerationRequest,
  assertNoSensitivePatterns,
  detectSensitivePattern,
  sanitizePromptText,
  createSanitizedPromptContext,
  MAX_PROMPT_LENGTH,
} = await import("../app/lib/ai/index.ts");

// ============================================================================
// MOCK FETCH HELPERS
// ============================================================================

function createMockFetch(handler) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fetchFn.calls = calls;
  return fetchFn;
}

function mockSuccessResponse(text, options = {}) {
  const {
    finishReason = "STOP",
    promptTokens = 12,
    candidateTokens = 25,
    totalTokens = 37,
  } = options;

  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
            role: "model",
          },
          finishReason,
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: promptTokens,
        candidatesTokenCount: candidateTokens,
        totalTokenCount: totalTokens,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function mockErrorResponse(status, message) {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        message,
        status: status === 429 ? "RESOURCE_EXHAUSTED" : status === 401 ? "UNAUTHENTICATED" : "ERROR",
      },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// ============================================================================
// TEST SUITE: AI LAYER FOUNDATION & SECURITY
// ============================================================================

describe("AI Provider Architecture & Core Security (Milestone 5, Phase 1)", () => {
  // --------------------------------------------------------------------------
  // 1. PROVIDER INTERFACE & INSTANTIATION
  // --------------------------------------------------------------------------
  describe("Provider Interface & Factory", () => {
    it("instantiates GeminiProvider with default model and properties", () => {
      const provider = new GeminiProvider({ apiKey: "test-key" });
      assert.equal(provider.providerName, "gemini");
      assert.equal(provider.defaultModel, "gemini-3.5-flash-lite");
      assert.equal(provider.defaultModel, DEFAULT_GEMINI_MODEL);
    });

    it("allows custom model configuration override", () => {
      const provider = new GeminiProvider({ apiKey: "test-key", model: "gemini-3.8-flash" });
      assert.equal(provider.defaultModel, "gemini-3.8-flash");
    });

    it("supports provider singleton and runtime replacement via setAiProvider", () => {
      const customMockProvider = {
        providerName: "mock-custom-provider",
        defaultModel: "mock-model",
        generateText: async () => ({ text: "custom output", model: "mock-model" }),
        generateStructured: async () => ({
          data: { test: true },
          rawText: '{"test":true}',
          model: "mock-model",
        }),
      };

      setAiProvider(customMockProvider);
      const active = getAiProvider();
      assert.equal(active.providerName, "mock-custom-provider");

      // Reset provider
      setAiProvider(null);
    });

    it("verifies all typed errors inherit from base AiError class", () => {
      const configErr = new AiConfigurationError();
      const authErr = new AiAuthenticationError();
      const rateLimitErr = new AiRateLimitError();
      const inputErr = new AiInvalidInputError("test");
      const timeoutErr = new AiTimeoutError();
      const netErr = new AiNetworkError("test");
      const respErr = new AiResponseError("test");

      assert.ok(configErr instanceof AiError);
      assert.ok(authErr instanceof AiError);
      assert.ok(rateLimitErr instanceof AiError);
      assert.ok(inputErr instanceof AiError);
      assert.ok(timeoutErr instanceof AiError);
      assert.ok(netErr instanceof AiError);
      assert.ok(respErr instanceof AiError);
    });
  });

  // --------------------------------------------------------------------------
  // 2. SUCCESSFUL GENERATION (TEXT & STRUCTURED JSON)
  // --------------------------------------------------------------------------
  describe("Successful Text & Structured Generation", () => {
    it("generates natural language text using mocked Gemini response", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockSuccessResponse("5 Creative Instagram Reel Ideas for Creators"))
      );

      const provider = new GeminiProvider({ apiKey: "test-key-123", fetchFn: mockFetch });
      const result = await provider.generateText({
        prompt: "Give me 5 Reel ideas for tech educators.",
        temperature: 0.7,
        maxTokens: 500,
      });

      assert.equal(result.text, "5 Creative Instagram Reel Ideas for Creators");
      assert.equal(result.model, DEFAULT_GEMINI_MODEL);
      assert.equal(result.finishReason, "STOP");
      assert.equal(result.usage.totalTokens, 37);

      // Verify request endpoint and authentication mechanism
      assert.equal(mockFetch.calls.length, 1);
      const call = mockFetch.calls[0];
      assert.ok(call.url.includes(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`));
      assert.equal(call.init.headers["x-goog-api-key"], "test-key-123");
      assert.equal(call.init.headers["Content-Type"], "application/json");

      // Verify request payload shape
      const body = JSON.parse(call.init.body);
      assert.equal(body.contents.length, 1);
      assert.equal(body.contents[0].parts[0].text, "Give me 5 Reel ideas for tech educators.");
      assert.equal(body.generationConfig.temperature, 0.7);
      assert.equal(body.generationConfig.maxOutputTokens, 500);
    });

    it("generates structured JSON data and parses output correctly", async () => {
      const mockJsonPayload = {
        title: "Mastering Reels in 2026",
        hook: "Stop scrolling if your reach dropped this week.",
        slides: ["Slide 1: Problem", "Slide 2: Solution", "Slide 3: Action"],
      };

      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockSuccessResponse(JSON.stringify(mockJsonPayload)))
      );

      const provider = new GeminiProvider({ apiKey: "test-key-123", fetchFn: mockFetch });
      const result = await provider.generateStructured({
        prompt: "Create a 3-slide carousel structure.",
      });

      assert.deepEqual(result.data, mockJsonPayload);
      assert.equal(result.data.title, "Mastering Reels in 2026");
      assert.ok(result.rawText.includes("Mastering Reels"));

      // Verify responseMimeType was set to application/json
      const body = JSON.parse(mockFetch.calls[0].init.body);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
    });

    it("strips markdown code fences from JSON output safely", async () => {
      const jsonTextWithFences = '```json\n{\n  "hook": "Cleaned JSON hook",\n  "status": "ready"\n}\n```';
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockSuccessResponse(jsonTextWithFences))
      );

      const provider = new GeminiProvider({ apiKey: "test-key-123", fetchFn: mockFetch });
      const result = await provider.generateStructured({
        prompt: "Generate a hook JSON.",
      });

      assert.equal(result.data.hook, "Cleaned JSON hook");
      assert.equal(result.data.status, "ready");
    });

    it("supports system instruction and multi-turn conversation history", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockSuccessResponse("Understood, let's proceed."))
      );

      const provider = new GeminiProvider({ apiKey: "test-key-123", fetchFn: mockFetch });
      await provider.generateText({
        prompt: "Let's refine the hook.",
        systemInstruction: "You are an elite Instagram growth strategist.",
        conversationHistory: [
          { role: "user", content: "I want to grow on Instagram." },
          { role: "model", content: "What is your primary niche?" },
        ],
      });

      const body = JSON.parse(mockFetch.calls[0].init.body);
      assert.equal(body.systemInstruction.parts[0].text, "You are an elite Instagram growth strategist.");
      assert.equal(body.contents.length, 3);
      assert.equal(body.contents[0].role, "user");
      assert.equal(body.contents[1].role, "model");
      assert.equal(body.contents[2].role, "user");
      assert.equal(body.contents[2].parts[0].text, "Let's refine the hook.");
    });
  });

  // --------------------------------------------------------------------------
  // 3. API CONFIGURATION & CREDENTIAL PROTECTION
  // --------------------------------------------------------------------------
  describe("API Configuration & Secret Protection", () => {
    it("throws AiConfigurationError when GEMINI_API_KEY is missing", async () => {
      const prevKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      try {
        const provider = new GeminiProvider({ apiKey: "" });
        await assert.rejects(
          async () => provider.generateText({ prompt: "Hello" }),
          (err) => {
            assert.ok(err instanceof AiConfigurationError);
            assert.equal(err.code, "CONFIG_ERROR");
            assert.ok(err.message.includes("GEMINI_API_KEY is not configured"));
            return true;
          }
        );
      } finally {
        if (prevKey) process.env.GEMINI_API_KEY = prevKey;
      }
    });

    it("never includes API key in error messages, URLs, or exception output", async () => {
      const SECRET_KEY = "AIzaSySecretApiKey1234567890ABCDEF";
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockErrorResponse(400, `Bad request with key ${SECRET_KEY} invalid parameter`))
      );

      const provider = new GeminiProvider({ apiKey: SECRET_KEY, fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Hello" }),
        (err) => {
          assert.ok(!err.message.includes(SECRET_KEY), "Error message must not leak API key");
          assert.ok(err.message.includes("[REDACTED_API_KEY]"));
          return true;
        }
      );
    });

    it("uses header authentication rather than query string to prevent URL logging", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockSuccessResponse("Response text"))
      );

      const provider = new GeminiProvider({ apiKey: "test-secret-key", fetchFn: mockFetch });
      await provider.generateText({ prompt: "Test prompt" });

      const requestUrl = mockFetch.calls[0].url;
      assert.ok(!requestUrl.includes("test-secret-key"), "URL must never contain the API key");
      assert.equal(mockFetch.calls[0].init.headers["x-goog-api-key"], "test-secret-key");
    });
  });

  // --------------------------------------------------------------------------
  // 4. HTTP ERROR MAPPING & RATE LIMITING
  // --------------------------------------------------------------------------
  describe("HTTP Error Mapping & Reliability", () => {
    it("maps HTTP 401 and 403 to AiAuthenticationError", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockErrorResponse(401, "API key not valid."))
      );

      const provider = new GeminiProvider({ apiKey: "invalid-key", fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Hello" }),
        (err) => {
          assert.ok(err instanceof AiAuthenticationError);
          assert.equal(err.code, "AUTH_ERROR");
          assert.equal(err.status, 401);
          assert.equal(err.isRetryable, false);
          return true;
        }
      );
    });

    it("maps HTTP 429 to AiRateLimitError with isRetryable=true", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockErrorResponse(429, "Quota exceeded for quota metric 'Queries'"))
      );

      const provider = new GeminiProvider({ apiKey: "test-key", fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Hello" }),
        (err) => {
          assert.ok(err instanceof AiRateLimitError);
          assert.equal(err.code, "RATE_LIMIT_ERROR");
          assert.equal(err.status, 429);
          assert.equal(err.isRetryable, true);
          assert.ok(err.message.includes("rate limit or daily quota exceeded"));
          return true;
        }
      );
    });

    it("maps request timeout to AiTimeoutError", async () => {
      const mockFetch = createMockFetch(
        () =>
          new Promise((_, reject) => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            setTimeout(() => reject(err), 10);
          })
      );

      const provider = new GeminiProvider({ apiKey: "test-key", timeoutMs: 5, fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Slow request" }),
        (err) => {
          assert.ok(err instanceof AiTimeoutError);
          assert.equal(err.code, "TIMEOUT_ERROR");
          assert.equal(err.status, 504);
          assert.equal(err.isRetryable, true);
          return true;
        }
      );
    });

    it("maps network connection drop to AiNetworkError", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.reject(new Error("ECONNRESET: Connection reset by peer"))
      );

      const provider = new GeminiProvider({ apiKey: "test-key", fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Disconnect test" }),
        (err) => {
          assert.ok(err instanceof AiNetworkError);
          assert.equal(err.code, "NETWORK_ERROR");
          assert.equal(err.isRetryable, true);
          return true;
        }
      );
    });

    it("maps malformed/non-JSON response body to AiResponseError", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 }))
      );

      const provider = new GeminiProvider({ apiKey: "test-key", fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Bad gateway test" }),
        (err) => {
          assert.ok(err instanceof AiResponseError);
          assert.equal(err.code, "RESPONSE_ERROR");
          return true;
        }
      );
    });

    it("rejects when candidate text is empty or safety-filtered", async () => {
      const mockFetchBlocked = createMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{ finishReason: "SAFETY", content: { parts: [] } }],
            }),
            { status: 200 }
          )
        )
      );

      const provider = new GeminiProvider({ apiKey: "test-key", fetchFn: mockFetchBlocked });

      await assert.rejects(
        async () => provider.generateText({ prompt: "Controversial prompt" }),
        (err) => {
          assert.ok(err instanceof AiResponseError);
          assert.ok(err.message.includes("blocked by safety filters"));
          return true;
        }
      );
    });

    it("rejects when structured generation output cannot be parsed as JSON", async () => {
      const mockFetch = createMockFetch(() =>
        Promise.resolve(mockSuccessResponse("Not valid JSON at all! Just regular text."))
      );

      const provider = new GeminiProvider({ apiKey: "test-key", fetchFn: mockFetch });

      await assert.rejects(
        async () => provider.generateStructured({ prompt: "Return JSON" }),
        (err) => {
          assert.ok(err instanceof AiResponseError);
          assert.ok(err.message.includes("Failed to parse structured AI response as valid JSON"));
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. INPUT VALIDATION & SIZE LIMITS
  // --------------------------------------------------------------------------
  describe("Input Validation & Bounds Checking", () => {
    it("rejects empty or whitespace-only prompt", () => {
      assert.throws(
        () => validateTextGenerationRequest({ prompt: "   " }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("prompt is required"));
          return true;
        }
      );
    });

    it("rejects prompt exceeding maximum character limit", () => {
      const hugePrompt = "a".repeat(MAX_PROMPT_LENGTH + 1);
      assert.throws(
        () => validateTextGenerationRequest({ prompt: hugePrompt }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("Prompt exceeds maximum allowed length"));
          return true;
        }
      );
    });

    it("rejects invalid temperature values", () => {
      assert.throws(
        () => validateTextGenerationRequest({ prompt: "Valid", temperature: 3.5 }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("Temperature must be a number between"));
          return true;
        }
      );

      assert.throws(
        () => validateTextGenerationRequest({ prompt: "Valid", temperature: -0.5 }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          return true;
        }
      );
    });

    it("rejects invalid maxTokens values", () => {
      assert.throws(
        () => validateTextGenerationRequest({ prompt: "Valid", maxTokens: 0 }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("maxTokens must be an integer"));
          return true;
        }
      );

      assert.throws(
        () => validateTextGenerationRequest({ prompt: "Valid", maxTokens: 100000 }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          return true;
        }
      );
    });

    it("rejects conversation history exceeding maximum turn limit", () => {
      const turns = Array.from({ length: 55 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "model",
        content: `Message ${i}`,
      }));

      assert.throws(
        () => validateTextGenerationRequest({ prompt: "Valid", conversationHistory: turns }),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("Conversation history exceeds maximum turn limit"));
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. SENSITIVE CREDENTIAL & PRIVACY DEFENSE
  // --------------------------------------------------------------------------
  describe("Sensitive Credential & Privacy Safeguards", () => {
    it("detects and blocks email addresses in prompt payload", () => {
      const promptWithEmail = "Analyze the creator account belonging to creator@example.com for reels.";
      const match = detectSensitivePattern(promptWithEmail);
      assert.ok(match);
      assert.equal(match.name, "Email Address");

      assert.throws(
        () => assertNoSensitivePatterns(promptWithEmail, "prompt"),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("Email Address"));
          return true;
        }
      );
    });

    it("detects and blocks JWT tokens in prompt payload", () => {
      const mockJwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const promptWithJwt = `Here is my token: ${mockJwt}`;

      assert.throws(
        () => assertNoSensitivePatterns(promptWithJwt, "prompt"),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("JSON Web Token (JWT)"));
          return true;
        }
      );
    });

    it("detects and blocks Meta/Instagram access tokens in prompt payload", () => {
      const mockMetaToken = "EAAB1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const promptWithToken = `Sync account with token ${mockMetaToken}`;

      assert.throws(
        () => assertNoSensitivePatterns(promptWithToken, "prompt"),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("Meta / Instagram Access Token"));
          return true;
        }
      );
    });

    it("detects and blocks Bearer authorization headers in prompt payload", () => {
      const promptWithBearer = "Authorization: Bearer mySecretTokenString1234567890abcdef";

      assert.throws(
        () => assertNoSensitivePatterns(promptWithBearer, "prompt"),
        (err) => {
          assert.ok(err instanceof AiInvalidInputError);
          assert.ok(err.message.includes("Bearer Token Authorization Header"));
          return true;
        }
      );
    });

    it("sanitizes text by replacing sensitive tokens with [REDACTED]", () => {
      const text = "Contact support@creatorbrand.com or use token EAAB1234567890abcdefghijklmnopqrstuvwxyz for sync.";
      const sanitized = sanitizePromptText(text);

      assert.ok(!sanitized.includes("support@creatorbrand.com"));
      assert.ok(!sanitized.includes("EAAB1234567890"));
      assert.ok(sanitized.includes("[REDACTED]"));
    });

    it("createSanitizedPromptContext filters object to strictly allowlisted keys", () => {
      const rawDatabaseRecord = {
        id: "user-uuid-12345",
        email: "private@user.com",
        encrypted_token: "encrypted-aes-bytes",
        creator_handle: "growth_creator",
        followers_count: 14200,
        niche: "Fitness & Wellness",
        password_hash: "$2b$10$secretHashValue",
      };

      const allowedKeys = ["creator_handle", "followers_count", "niche"];
      const filtered = createSanitizedPromptContext(rawDatabaseRecord, allowedKeys);

      assert.equal(filtered.creator_handle, "growth_creator");
      assert.equal(filtered.followers_count, 14200);
      assert.equal(filtered.niche, "Fitness & Wellness");

      // Verify sensitive and internal keys were excluded
      assert.equal(filtered.id, undefined);
      assert.equal(filtered.email, undefined);
      assert.equal(filtered.encrypted_token, undefined);
      assert.equal(filtered.password_hash, undefined);
      assert.deepEqual(Object.keys(filtered), ["creator_handle", "followers_count", "niche"]);
    });
  });
});
