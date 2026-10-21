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
  validateCarouselInput,
  generateCarouselDeck,
  MIN_CAROUSEL_TOPIC_LENGTH,
  MAX_CAROUSEL_TOPIC_LENGTH,
  ALLOWED_SLIDE_COUNTS,
} = await import("../app/lib/carousels/service.ts");

const { validateDraftInput } = await import("../app/lib/drafts/service.ts");
const { setAiProvider, DEFAULT_GEMINI_MODEL } = await import("../app/lib/ai/index.ts");
const { AiRateLimitError, AiAuthenticationError } = await import("../app/lib/ai/types.ts");

// ============================================================================
// 1. INPUT VALIDATION TESTS
// ============================================================================

test("Input Validation: rejects missing, empty, or too-short topic (< 3 chars)", () => {
  const missingRes = validateCarouselInput(undefined);
  assert.equal(missingRes.isValid, false);
  assert.ok(missingRes.errors._root || missingRes.errors.topic);

  const emptyRes = validateCarouselInput({ topic: "   " });
  assert.equal(emptyRes.isValid, false);
  assert.ok(emptyRes.errors.topic.includes("required") || emptyRes.errors.topic.includes("at least 3 characters"));

  const shortRes = validateCarouselInput({ topic: "Hi" });
  assert.equal(shortRes.isValid, false);
  assert.ok(shortRes.errors.topic.includes("at least 3 characters"));
});

test("Input Validation: rejects oversized topic (> 500 chars)", () => {
  const oversizedRes = validateCarouselInput({
    topic: "A".repeat(MAX_CAROUSEL_TOPIC_LENGTH + 1),
  });
  assert.equal(oversizedRes.isValid, false);
  assert.ok(oversizedRes.errors.topic.includes("500 characters"));
});

test("Input Validation: validates allowed slide counts (5, 7, 10) and defaults to 7 when omitted", () => {
  const defaultRes = validateCarouselInput({ topic: "Next.js Architecture Patterns" });
  assert.equal(defaultRes.isValid, true);
  assert.equal(defaultRes.sanitized.slideCount, 7);

  const fiveRes = validateCarouselInput({ topic: "Next.js Architecture Patterns", slideCount: 5 });
  assert.equal(fiveRes.isValid, true);
  assert.equal(fiveRes.sanitized.slideCount, 5);

  const tenRes = validateCarouselInput({ topic: "Next.js Architecture Patterns", slideCount: 10 });
  assert.equal(tenRes.isValid, true);
  assert.equal(tenRes.sanitized.slideCount, 10);

  const invalidRes = validateCarouselInput({ topic: "Next.js Architecture Patterns", slideCount: 8 });
  assert.equal(invalidRes.isValid, false);
  assert.ok(invalidRes.errors.slideCount.includes("5, 7, or 10"));

  const negativeRes = validateCarouselInput({ topic: "Next.js Architecture Patterns", slideCount: -1 });
  assert.equal(negativeRes.isValid, false);
  assert.ok(negativeRes.errors.slideCount);
});

test("Input Validation: detects and blocks sensitive credentials in input parameters", () => {
  const emailInput = validateCarouselInput({
    topic: "Contact me at creator@gmail.com for collaboration ideas",
  });
  assert.equal(emailInput.isValid, false);
  assert.ok(emailInput.errors.topic.includes("Sensitive data violation"));

  const tokenInput = validateCarouselInput({
    topic: "Valid topic here",
    pillar: "Token EAAB1234567890abcdef1234567890 here",
  });
  assert.equal(tokenInput.isValid, false);
  assert.ok(tokenInput.errors.pillar.includes("Sensitive data violation"));

  const apiKeyInput = validateCarouselInput({
    topic: "Valid topic here",
    targetGoal: "Key: " + "AIza" + "SyD12345678901234567890123456789012",
  });
  assert.equal(apiKeyInput.isValid, false);
  assert.ok(apiKeyInput.errors.targetGoal.includes("Sensitive data violation"));
});

// ============================================================================
// 2. STRUCTURED CAROUSEL GENERATION TESTS
// ============================================================================

test("Structured Generation: generates 7-slide carousel deck with sequential numbering, cover, value slides, and CTA", async () => {
  let capturedRequest = null;

  const mockSlides = [
    { slideNumber: 1, type: "cover", headline: "Stop Writing Dirty Next.js Code", bodyText: "5 architectural patterns used by high-scale production engineering teams.", visualSuggestion: "Bold contrasting title card with Next.js icon" },
    { slideNumber: 2, type: "value", headline: "1. Colocate Server Actions", bodyText: "Keep mutation actions next to the feature boundary instead of a global bucket.", visualSuggestion: "Directory tree diagram showing colocation" },
    { slideNumber: 3, type: "value", headline: "2. Guard Server Boundaries", bodyText: "Import 'server-only' in sensitive library utilities so secrets never leak to the client.", visualSuggestion: "Code snippet highlighting import 'server-only'" },
    { slideNumber: 4, type: "value", headline: "3. Lean Client Components", bodyText: "Push client state down the leaf nodes to keep your bundle footprint tiny.", visualSuggestion: "Component tree split into green server and blue client leaves" },
    { slideNumber: 5, type: "value", headline: "4. Explicit Error Boundaries", bodyText: "Use error.tsx per segment to isolate failures without crashing the entire route.", visualSuggestion: "UI mock showing isolated error card inside a dashboard" },
    { slideNumber: 6, type: "value", headline: "5. Route Handler Validation", bodyText: "Always parse searchParams and request bodies with schema validators before processing.", visualSuggestion: "Flowchart of request entering schema check before DB" },
    { slideNumber: 7, type: "cta", headline: "Which Pattern Do You Need Most?", bodyText: "Save this deck for your next refactor and drop a comment below.", visualSuggestion: "Bookmark icon with question prompt and creator handle" },
  ];

  const mockCaption = "Building scalable Next.js apps isn't about complex libraries—it's about clean architecture. Swipe through for 5 practical rules we follow on production apps.\n\nSave this for your next project kickoff!";
  const mockHashtags = ["#Nextjs", "#WebDev", "#SoftwareEngineering", "#ReactJS", "#CodingTips", "#FullStack"];

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      capturedRequest = request;
      return {
        data: {
          topicTitle: "5 Clean Next.js Architecture Patterns",
          targetAudienceSummary: "Full-stack developers and indie creators building with Next.js",
          slides: mockSlides,
          caption: mockCaption,
          hashtags: mockHashtags,
        },
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "Clean Next.js Architecture Patterns",
      slideCount: 7,
    });

    assert.equal(result.success, true);
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.ok(result.carousel);
    assert.equal(result.carousel.slides.length, 7);

    // Verify sequential numbering & slide types
    assert.equal(result.carousel.slides[0].slideNumber, 1);
    assert.equal(result.carousel.slides[0].type, "cover");
    assert.ok(result.carousel.slides[0].headline);

    for (let i = 1; i < 6; i++) {
      assert.equal(result.carousel.slides[i].slideNumber, i + 1);
      assert.equal(result.carousel.slides[i].type, "value");
      assert.ok(result.carousel.slides[i].headline);
      assert.ok(result.carousel.slides[i].bodyText);
    }

    assert.equal(result.carousel.slides[6].slideNumber, 7);
    assert.equal(result.carousel.slides[6].type, "cta");
    assert.ok(result.carousel.slides[6].headline);

    // Verify caption and hashtags
    assert.equal(result.carousel.caption, mockCaption);
    assert.equal(result.carousel.hashtags.length, 6);
    for (const tag of result.carousel.hashtags) {
      assert.ok(tag.startsWith("#"));
    }

    // Verify request parameters
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.maxTokens, 2500);
    assert.equal(capturedRequest.temperature, 0.7);
    assert.ok(capturedRequest.systemInstruction.includes("CRITICAL CAROUSEL GENERATION RULES"));
    assert.ok(capturedRequest.systemInstruction.includes("COVER HOOK"));
    assert.ok(capturedRequest.systemInstruction.includes("OUTRO / CTA"));
  } finally {
    setAiProvider(null);
  }
});

test("Structured Generation: supports 5-slide and 10-slide requested deck lengths", async () => {
  const createMockDeck = (count) => {
    return Array.from({ length: count }, (_, i) => ({
      slideNumber: i + 1,
      type: i === 0 ? "cover" : i === count - 1 ? "cta" : "value",
      headline: `Slide ${i + 1} Headline`,
      bodyText: `Slide ${i + 1} Body Details`,
      visualSuggestion: `Visual suggestion ${i + 1}`,
    }));
  };

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      const match = request.prompt.match(/Generate exactly (\d+) slides/);
      const count = match ? parseInt(match[1], 10) : 5;
      return {
        data: {
          topicTitle: `Topic for ${count} slides`,
          targetAudienceSummary: "Developers",
          slides: createMockDeck(count),
          caption: "Companion caption here.",
          hashtags: ["#code", "#tips", "#dev", "#react", "#web"],
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const res5 = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "5 Essential Productivity Habits",
      slideCount: 5,
    });
    assert.equal(res5.success, true);
    assert.equal(res5.carousel.slides.length, 5);
    assert.equal(res5.carousel.slides[0].type, "cover");
    assert.equal(res5.carousel.slides[4].type, "cta");

    const res10 = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "10 Steps to Master TypeScript Generics",
      slideCount: 10,
    });
    assert.equal(res10.success, true);
    assert.equal(res10.carousel.slides.length, 10);
    assert.equal(res10.carousel.slides[0].type, "cover");
    assert.equal(res10.carousel.slides[9].type, "cta");
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 3. RESILIENT EXTRACTION & NORMALIZATION
// ============================================================================

test("Resilient Extraction: handles root array [ ... ] and missing wrapper fields gracefully", async () => {
  const rootArrayProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: [
          { slideNumber: 1, type: "cover", headline: "Root Array Cover", bodyText: "Overview", visualSuggestion: "Card 1" },
          { slideNumber: 2, type: "value", headline: "Key Step 1", bodyText: "Details", visualSuggestion: "Card 2" },
          { slideNumber: 3, type: "value", headline: "Key Step 2", bodyText: "Details", visualSuggestion: "Card 3" },
          { slideNumber: 4, type: "value", headline: "Key Step 3", bodyText: "Details", visualSuggestion: "Card 4" },
          { slideNumber: 5, type: "cta", headline: "Save & Share", bodyText: "Closing", visualSuggestion: "Card 5" },
        ],
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(rootArrayProvider);

  try {
    const result = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "Testing Root Array Parser",
      slideCount: 5,
    });

    assert.equal(result.success, true);
    assert.equal(result.carousel.slides.length, 5);
    assert.equal(result.carousel.slides[0].headline, "Root Array Cover");
    assert.equal(result.carousel.slides[4].headline, "Save & Share");
    assert.ok(result.carousel.caption);
    assert.ok(result.carousel.hashtags.length >= 3);
  } finally {
    setAiProvider(null);
  }
});

test("Resilient Normalization: normalizes slide counts and types if model produces extra or fewer slides", async () => {
  // Model returned only 3 slides when 5 were requested
  const undersizedProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          slides: [
            { slideNumber: 1, type: "value", headline: "Initial Slide", bodyText: "Content 1" },
            { slideNumber: 2, type: "value", headline: "Middle Slide", bodyText: "Content 2" },
            { slideNumber: 3, type: "value", headline: "Final Slide", bodyText: "Content 3" },
          ],
          caption: "Short caption",
          hashtags: ["#test", "#pad"],
        },
      };
    },
  };

  setAiProvider(undersizedProvider);

  try {
    const result = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "Under-generated deck test",
      slideCount: 5,
    });

    assert.equal(result.success, true);
    assert.equal(result.carousel.slides.length, 5);
    // Verified: slide 1 is normalized to cover, slide 5 to cta, all 1-to-5 sequential
    assert.equal(result.carousel.slides[0].slideNumber, 1);
    assert.equal(result.carousel.slides[0].type, "cover");
    assert.equal(result.carousel.slides[4].slideNumber, 5);
    assert.equal(result.carousel.slides[4].type, "cta");
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 4. PERSONALIZATION & FORBIDDEN TOPICS (BOUNDARIES)
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
          slides: [
            { slideNumber: 1, type: "cover", headline: "Cover", bodyText: "Intro" },
            { slideNumber: 2, type: "value", headline: "Value 1", bodyText: "Points" },
            { slideNumber: 3, type: "value", headline: "Value 2", bodyText: "Points" },
            { slideNumber: 4, type: "value", headline: "Value 3", bodyText: "Points" },
            { slideNumber: 5, type: "cta", headline: "CTA", bodyText: "Outro" },
          ],
          caption: "Safe caption",
          hashtags: ["#coding", "#tips", "#tech", "#dev", "#growth"],
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "Safe Tech Topic",
      slideCount: 5,
    });

    assert.equal(result.success, true);
    assert.ok(capturedRequest);
    assert.ok(capturedRequest.systemInstruction.includes("FORBIDDEN TOPICS (STRICT BOUNDARY)"));
    assert.ok(capturedRequest.systemInstruction.includes("ZERO FALSE PROMISES"));
    assert.ok(capturedRequest.systemInstruction.includes("NEVER promise viral reach"));
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 5. DRAFT INTEGRATION & SCHEMA VALIDATION
// ============================================================================

test("Draft Integration: formatted carousel text and metadata satisfies validateDraftInput with format 'carousel'", () => {
  const slides = [
    { slideNumber: 1, type: "cover", headline: "Stop Writing Dirty Next.js Code", bodyText: "5 architectural patterns used by high-scale production engineering teams.", visualSuggestion: "Bold contrasting title card with Next.js icon" },
    { slideNumber: 2, type: "value", headline: "1. Colocate Server Actions", bodyText: "Keep mutation actions next to the feature boundary instead of a global bucket.", visualSuggestion: "Directory tree diagram showing colocation" },
    { slideNumber: 3, type: "value", headline: "2. Guard Server Boundaries", bodyText: "Import 'server-only' in sensitive library utilities so secrets never leak to the client.", visualSuggestion: "Code snippet highlighting import 'server-only'" },
    { slideNumber: 4, type: "value", headline: "3. Lean Client Components", bodyText: "Push client state down the leaf nodes to keep your bundle footprint tiny.", visualSuggestion: "Component tree split into green server and blue client leaves" },
    { slideNumber: 5, type: "value", headline: "4. Explicit Error Boundaries", bodyText: "Use error.tsx per segment to isolate failures without crashing the entire route.", visualSuggestion: "UI mock showing isolated error card inside a dashboard" },
    { slideNumber: 6, type: "value", headline: "5. Route Handler Validation", bodyText: "Always parse searchParams and request bodies with schema validators before processing.", visualSuggestion: "Flowchart of request entering schema check before DB" },
    { slideNumber: 7, type: "cta", headline: "Which Pattern Do You Need Most?", bodyText: "Save this deck for your next refactor and drop a comment below.", visualSuggestion: "Bookmark icon with question prompt and creator handle" },
  ];

  const caption = "Building scalable Next.js apps isn't about complex libraries—it's about clean architecture. Swipe through for 5 practical rules we follow on production apps.\n\nSave this for your next project kickoff!";
  const hashtags = ["#Nextjs", "#WebDev", "#SoftwareEngineering", "#ReactJS", "#CodingTips", "#FullStack"];

  // Format readable caption as constructed by CarouselGenerator
  const slidesFormatted = slides
    .map(
      (s) =>
        `[SLIDE ${s.slideNumber}: ${s.type.toUpperCase()}]\n${s.headline}\n${s.bodyText}${
          s.visualSuggestion ? `\n(Visual: ${s.visualSuggestion})` : ""
        }`
    )
    .join("\n\n---\n\n");

  const readableDraftCaption = `${slidesFormatted}\n\n========================\nCOMPANION CAPTION\n========================\n${caption}\n\n${hashtags.join(" ")}`;

  const draftPayload = {
    title: "5 Clean Next.js Architecture Patterns",
    caption: readableDraftCaption,
    format: "carousel",
    status: "draft",
    metadata: {
      source: "carousel_studio",
      model: "gemini-3.5-flash-lite",
      slideCount: 7,
      slides,
      companionCaption: caption,
      hashtags,
    },
  };

  const validation = validateDraftInput(draftPayload);
  assert.equal(validation.isValid, true);
  assert.equal(validation.sanitized.title, "5 Clean Next.js Architecture Patterns");
  assert.equal(validation.sanitized.format, "carousel");
  assert.equal(validation.sanitized.status, "draft");
  assert.equal(validation.sanitized.metadata.source, "carousel_studio");
  assert.equal(validation.sanitized.metadata.slideCount, 7);
  assert.equal(validation.sanitized.metadata.slides.length, 7);
  // Ensure readable caption does not exceed MAX_CAPTION_LENGTH (5000 chars)
  assert.ok(validation.sanitized.caption.length < 5000);
});

// ============================================================================
// 6. HONEST QUOTA & ERROR HANDLING (₹0 BUDGET)
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
    const result = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "Quota test topic",
      slideCount: 5,
    });
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
    const result = await generateCarouselDeck("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      topic: "Auth test topic",
      slideCount: 5,
    });
    assert.equal(result.success, false);
    assert.ok(result.error.includes("Unable to authenticate with Google Gemini"));
    assert.ok(!result.error.includes("AIza"));
  } finally {
    setAiProvider(null);
  }
});
