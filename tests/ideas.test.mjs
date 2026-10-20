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
  validateIdeasInput,
  generateContentIdeas,
  MAX_IDEA_TOPIC_LENGTH,
} = await import("../app/lib/ideas/service.ts");

const { validateDraftInput } = await import("../app/lib/drafts/service.ts");
const { setAiProvider, DEFAULT_GEMINI_MODEL } = await import("../app/lib/ai/index.ts");
const { AiRateLimitError, AiAuthenticationError } = await import("../app/lib/ai/types.ts");

// ============================================================================
// 1. INPUT VALIDATION TESTS
// ============================================================================

test("Input Validation: allows undefined or empty input and defaults to format 'all'", () => {
  const emptyRes = validateIdeasInput(undefined);
  assert.equal(emptyRes.isValid, true);
  assert.equal(emptyRes.sanitized.format, "all");

  const objRes = validateIdeasInput({});
  assert.equal(objRes.isValid, true);
  assert.equal(objRes.sanitized.format, "all");
});

test("Input Validation: rejects invalid payload types and invalid format enums", () => {
  const arrayRes = validateIdeasInput(["not", "an", "object"]);
  assert.equal(arrayRes.isValid, false);
  assert.ok(arrayRes.errors._root);

  const stringRes = validateIdeasInput("some string");
  assert.equal(stringRes.isValid, false);
  assert.ok(stringRes.errors._root);

  const invalidFormat = validateIdeasInput({ format: "unsupported-format" });
  assert.equal(invalidFormat.isValid, false);
  assert.ok(invalidFormat.errors.format);

  const validReel = validateIdeasInput({ format: "reel" });
  assert.equal(validReel.isValid, true);
  assert.equal(validReel.sanitized.format, "reel");

  const validPost = validateIdeasInput({ format: "post" });
  assert.equal(validPost.isValid, true);
  assert.equal(validPost.sanitized.format, "post");
});

test("Input Validation: enforces topic length bound (max 500 characters)", () => {
  const oversized = validateIdeasInput({
    topic: "a".repeat(MAX_IDEA_TOPIC_LENGTH + 1),
  });
  assert.equal(oversized.isValid, false);
  assert.ok(oversized.errors.topic.includes("500"));

  const valid = validateIdeasInput({
    topic: "5 common mistakes beginner Next.js developers make",
  });
  assert.equal(valid.isValid, true);
  assert.equal(valid.sanitized.topic, "5 common mistakes beginner Next.js developers make");
});

test("Security & Privacy: detects and blocks sensitive credentials in input parameters", () => {
  const emailInput = validateIdeasInput({
    topic: "Contact me at creator@gmail.com for collaboration",
  });
  assert.equal(emailInput.isValid, false);
  assert.ok(emailInput.errors.topic.includes("Sensitive data violation"));

  const tokenInput = validateIdeasInput({
    pillar: "Token EAAB1234567890abcdef1234567890 here",
  });
  assert.equal(tokenInput.isValid, false);
  assert.ok(tokenInput.errors.pillar.includes("Sensitive data violation"));

  const apiKeyInput = validateIdeasInput({
    targetGoal: "Key: AIzaSyD12345678901234567890123456789012",
  });
  assert.equal(apiKeyInput.isValid, false);
  assert.ok(apiKeyInput.errors.targetGoal.includes("Sensitive data violation"));
});

// ============================================================================
// 2. STRUCTURED OUTPUT & HOOK/SCRIPT GENERATION
// ============================================================================

test("Structured Generation: produces exactly 3 concepts, each with 3 hook variants and 3-beat script", async () => {
  let capturedRequest = null;

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      capturedRequest = request;
      return {
        data: {
          ideas: [
            {
              title: "The 3-Second Rule Every Creator Breaks",
              concept: "Break down why the first 1.5 seconds decides 80% of your Reel retention.",
              format: "reel",
              hooks: [
                "Stop wasting hours on videos that nobody watches past second 2.",
                "The biggest mistake creators make before saying their first word.",
                "Here is how 1 simple visual cut doubled my average watch time.",
              ],
              script: {
                hook: "Stop wasting hours on videos that nobody watches past second 2.",
                lesson: "1. Match visual movement to your first syllable.\n2. Cut the greeting entirely.\n3. Show the payoff before explaining the process.",
                callToAction: "Save this checklist for your next shoot.",
              },
              targetAudienceAngle: "Appeals directly to creators struggling with low video retention.",
              suggestedPillar: "Growth Tips",
            },
            {
              title: "5 Micro-Habits of Top Tech Creators",
              concept: "Actionable routines that keep content production sustainable.",
              format: "post",
              hooks: [
                "How I batch 4 Reels in 90 minutes without burning out.",
                "Stop scripting word-for-word: use this 3-bullet system instead.",
                "The simple content pipeline I wish I used 2 years ago.",
              ],
              script: {
                hook: "How I batch 4 Reels in 90 minutes without burning out.",
                lesson: "Outline core beats -> Record in one sitting -> Edit with templates.",
                callToAction: "Comment 'WORKFLOW' and I'll send my full Notion template.",
              },
              targetAudienceAngle: "Resonates with part-time creators managing busy schedules.",
              suggestedPillar: "Productivity",
            },
            {
              title: "The Zero-Budget Studio Setup Breakdown",
              concept: "Show that good lighting and clear audio outperform an expensive camera every time.",
              format: "reel",
              hooks: [
                "You don't need a ₹1,00,000 camera to look like a professional.",
                "The ₹0 lighting hack using just a window and white foam board.",
                "Why your phone's back camera is 10x better than you think.",
              ],
              script: {
                hook: "You don't need a ₹1,00,000 camera to look like a professional.",
                lesson: "Clean your lens -> Position 45 degrees to a window -> Lock exposure manually.",
                callToAction: "Share this with a friend who is waiting for better gear to start.",
              },
              targetAudienceAngle: "Empowers beginners who feel held back by equipment costs.",
              suggestedPillar: "Gear & Setups",
            },
          ],
        },
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await generateContentIdeas("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "all",
      topic: "Content production routines",
    });

    assert.equal(result.success, true);
    assert.equal(result.ideas.length, 3);
    assert.equal(result.model, "gemini-3.5-flash-lite");

    // Verify idea card structure
    for (const idea of result.ideas) {
      assert.ok(idea.id);
      assert.ok(idea.title);
      assert.ok(idea.concept);
      assert.ok(["reel", "post"].includes(idea.format));
      assert.equal(idea.hooks.length, 3);
      assert.ok(idea.script.hook);
      assert.ok(idea.script.lesson);
      assert.ok(idea.script.callToAction);
      assert.ok(idea.targetAudienceAngle);
    }

    // Verify request structure & schema requirements
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.maxTokens, 1800);
    assert.equal(capturedRequest.temperature, 0.7);
    assert.ok(capturedRequest.systemInstruction.includes("CRITICAL GENERATION RULES"));
    assert.ok(capturedRequest.systemInstruction.includes("OUTPUT EXACTLY 3 CONCEPTS"));
    assert.ok(capturedRequest.systemInstruction.includes("3 DISTINCT HOOK VARIATIONS PER CONCEPT"));
    assert.ok(capturedRequest.systemInstruction.includes("3-BEAT SHORT SCRIPT FRAMEWORK"));
  } finally {
    setAiProvider(null);
  }
});

test("Structured Generation: handles root array [ ... ] and alternative JSON wrappers from Gemini robustly", async () => {
  // Test Case: Gemini outputs a top-level array directly rather than { ideas: [...] }
  const rootArrayProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: [
          {
            title: "Direct Array Concept 1",
            concept: "Concept premise 1",
            format: "reel",
            hooks: ["Hook A", "Hook B", "Hook C"],
            script: { hook: "Hook A", lesson: "Lesson 1", callToAction: "CTA 1" },
            targetAudienceAngle: "Angle 1",
          },
          {
            title: "Direct Array Concept 2",
            concept: "Concept premise 2",
            format: "post",
            hooks: ["Hook D", "Hook E", "Hook F"],
            script: { hook: "Hook D", lesson: "Lesson 2", callToAction: "CTA 2" },
            targetAudienceAngle: "Angle 2",
          },
          {
            title: "Direct Array Concept 3",
            concept: "Concept premise 3",
            format: "reel",
            hooks: ["Hook G", "Hook H", "Hook I"],
            script: { hook: "Hook G", lesson: "Lesson 3", callToAction: "CTA 3" },
            targetAudienceAngle: "Angle 3",
          },
        ],
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(rootArrayProvider);

  try {
    const result = await generateContentIdeas("d6071436-1a92-4bbd-ad76-d4d2689705a0", {});
    assert.equal(result.success, true);
    assert.equal(result.ideas.length, 3);
    assert.equal(result.ideas[0].title, "Direct Array Concept 1");
    assert.equal(result.ideas[1].title, "Direct Array Concept 2");
    assert.equal(result.ideas[2].title, "Direct Array Concept 3");
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 3. PERSONALIZATION & FORBIDDEN TOPICS (BOUNDARIES)
// ============================================================================

test("Personalization & Boundaries: injects confirmed preferences and strictly enforces forbidden topics", async () => {
  let capturedRequest = null;

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      capturedRequest = request;
      return {
        data: {
          ideas: [
            {
              title: "Concept 1",
              concept: "Safe concept",
              format: "reel",
              hooks: ["Hook 1", "Hook 2", "Hook 3"],
              script: { hook: "Hook 1", lesson: "Lesson 1", callToAction: "CTA 1" },
              targetAudienceAngle: "Community",
            },
          ],
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await generateContentIdeas("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      format: "reel",
    });

    assert.equal(result.success, true);
    assert.ok(capturedRequest);
    // Verifies system instructions strictly enforce boundaries and never guarantee reach
    assert.ok(capturedRequest.systemInstruction.includes("FORBIDDEN TOPICS (STRICT BOUNDARY)"));
    assert.ok(capturedRequest.systemInstruction.includes("ZERO FALSE PROMISES"));
    assert.ok(capturedRequest.systemInstruction.includes("NEVER promise viral reach"));
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 4. DRAFT INTEGRATION & OWNER SCOPE
// ============================================================================

test("Draft Integration: formatted draft from idea card strictly satisfies validateDraftInput", () => {
  const ideaCard = {
    id: "idea-1-12345",
    title: "The 3-Second Rule for High-Retention Reels",
    concept: "Explain how opening visual cuts keep viewers watching.",
    format: "reel",
    hooks: [
      "Stop losing viewers in second 1.",
      "The visual hook mistake creators make.",
      "How 1 cut doubled my watch time.",
    ],
    script: {
      hook: "Stop losing viewers in second 1.",
      lesson: "1. Match visual motion to speech.\n2. Cut greeting.\n3. Show result first.",
      callToAction: "Save this for your next shoot.",
    },
    targetAudienceAngle: "Junior creators",
    suggestedPillar: "Growth Tips",
  };

  const selectedHook = ideaCard.hooks[0];
  const draftCaption = `[HOOK]\n${selectedHook}\n\n[LESSON]\n${ideaCard.script.lesson}\n\n[CTA]\n${ideaCard.script.callToAction}\n\n---\nAlternative Hooks:\n1. ${ideaCard.hooks[0]}\n2. ${ideaCard.hooks[1]}\n3. ${ideaCard.hooks[2]}`;

  const draftPayload = {
    title: ideaCard.title,
    caption: draftCaption,
    format: ideaCard.format,
    status: "draft",
    metadata: {
      source: "idea_lab",
      model: "gemini-3.5-flash-lite",
      concept: ideaCard.concept,
      hooks: ideaCard.hooks,
      script: ideaCard.script,
      pillar: ideaCard.suggestedPillar,
      targetAudienceAngle: ideaCard.targetAudienceAngle,
    },
  };

  const validation = validateDraftInput(draftPayload);
  assert.equal(validation.isValid, true);
  assert.equal(validation.sanitized.title, ideaCard.title);
  assert.equal(validation.sanitized.format, "reel");
  assert.equal(validation.sanitized.status, "draft");
  assert.equal(validation.sanitized.metadata.source, "idea_lab");
  assert.equal(validation.sanitized.metadata.hooks.length, 3);
});

// ============================================================================
// 5. HONEST QUOTA & ERROR HANDLING (₹0 BUDGET)
// ============================================================================

test("Strict ₹0 Budget: handles HTTP 429 quota limits gracefully without paid fallback", async () => {
  const rateLimitProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      throw new AiRateLimitError("Quota limit reached", 15000);
    },
  };

  setAiProvider(rateLimitProvider);

  try {
    const result = await generateContentIdeas("d6071436-1a92-4bbd-ad76-d4d2689705a0", {});
    assert.equal(result.success, false);
    assert.equal(result.isRateLimited, true);
    assert.equal(result.retryAfterMs, 15000);
    assert.ok(result.error.includes("temporarily paused"));
    assert.ok(result.quotaDetails.includes("Google AI Studio"));
  } finally {
    setAiProvider(null);
  }
});

test("Security & Auth: handles authentication errors safely without secret exposure", async () => {
  const authFailingProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      throw new AiAuthenticationError("Invalid API key provided", 401);
    },
  };

  setAiProvider(authFailingProvider);

  try {
    const result = await generateContentIdeas("d6071436-1a92-4bbd-ad76-d4d2689705a0", {});
    assert.equal(result.success, false);
    assert.ok(result.error.includes("Unable to authenticate with Google Gemini"));
    assert.ok(!result.error.includes("AIza"));
  } finally {
    setAiProvider(null);
  }
});
