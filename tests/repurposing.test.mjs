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
  validateRepurposeInput,
  repurposeContent,
  MIN_SOURCE_TEXT_LENGTH,
  MAX_SOURCE_TEXT_LENGTH,
  VALID_REPURPOSE_MODES,
  VALID_REWRITE_GOALS,
  VALID_TARGET_FORMATS,
} = await import("../app/lib/repurposing/service.ts");

const { validateDraftInput } = await import("../app/lib/drafts/service.ts");
const { setAiProvider, DEFAULT_GEMINI_MODEL } = await import("../app/lib/ai/index.ts");
const { AiRateLimitError, AiAuthenticationError } = await import("../app/lib/ai/types.ts");

// ============================================================================
// 1. INPUT VALIDATION TESTS
// ============================================================================

test("Input Validation: rejects missing, empty, or too-short source text (< 10 chars)", () => {
  const missingRes = validateRepurposeInput(undefined);
  assert.equal(missingRes.isValid, false);
  assert.ok(missingRes.errors._root || missingRes.errors.sourceText);

  const emptyRes = validateRepurposeInput({ sourceText: "   " });
  assert.equal(emptyRes.isValid, false);
  assert.ok(emptyRes.errors.sourceText);

  const shortRes = validateRepurposeInput({ sourceText: "Too short" });
  assert.equal(shortRes.isValid, false);
  assert.ok(shortRes.errors.sourceText.includes("at least 10 characters"));
});

test("Input Validation: rejects oversized source text (> 3,000 chars)", () => {
  const oversizedRes = validateRepurposeInput({
    sourceText: "A".repeat(MAX_SOURCE_TEXT_LENGTH + 1),
  });
  assert.equal(oversizedRes.isValid, false);
  assert.ok(oversizedRes.errors.sourceText.includes("3000 characters"));
});

test("Input Validation: validates allowed modes, rewrite goals, and target formats", () => {
  const validRewrite = validateRepurposeInput({
    sourceText: "Valid source content for rewriting purposes.",
    mode: "rewrite",
    goal: "shorten",
  });
  assert.equal(validRewrite.isValid, true);
  assert.equal(validRewrite.sanitized.mode, "rewrite");
  assert.equal(validRewrite.sanitized.goal, "shorten");

  const validConvert = validateRepurposeInput({
    sourceText: "Valid source content for converting to reel.",
    mode: "convert",
    targetFormat: "reel",
  });
  assert.equal(validConvert.isValid, true);
  assert.equal(validConvert.sanitized.mode, "convert");
  assert.equal(validConvert.sanitized.targetFormat, "reel");

  const validMulti = validateRepurposeInput({
    sourceText: "Valid source content for multi-pack repurposing.",
    mode: "multipack",
  });
  assert.equal(validMulti.isValid, true);
  assert.equal(validMulti.sanitized.mode, "multipack");

  const invalidMode = validateRepurposeInput({
    sourceText: "Valid source content.",
    mode: "invalid-mode",
  });
  assert.equal(invalidMode.isValid, false);
  assert.ok(invalidMode.errors.mode);
});

test("Input Validation: screens and blocks sensitive credentials in input parameters", () => {
  const emailInput = validateRepurposeInput({
    sourceText: "Here is my private draft, contact me at creator@gmail.com for details.",
  });
  assert.equal(emailInput.isValid, false);
  assert.ok(emailInput.errors.sourceText.includes("Sensitive data violation"));

  const tokenInput = validateRepurposeInput({
    sourceText: "Valid source content here for transformation.",
    tone: "Token EAAB1234567890abcdef1234567890 here",
  });
  assert.equal(tokenInput.isValid, false);
  assert.ok(tokenInput.errors.tone.includes("Sensitive data violation"));

  const keyInput = validateRepurposeInput({
    sourceText: "Valid source content here for transformation.",
    language: "Key: " + "AIza" + "SyD12345678901234567890123456789012",
  });
  assert.equal(keyInput.isValid, false);
  assert.ok(keyInput.errors.language.includes("Sensitive data violation"));
});

// ============================================================================
// 2. REWRITE & OPTIMIZE TESTS
// ============================================================================

test("Structured Generation: executes 'improve' rewrite and calculates word count delta", async () => {
  const source = "Here are three tips for Next.js developers. First tip is use server components. Second is colocate code. Third is avoid unnecessary client state.";
  const rewritten = "3 Essential Next.js Architecture Rules:\n\n1. Default to React Server Components for zero-bundle rendering.\n2. Colocate actions right alongside their feature modules.\n3. Push interactive client state down to leaf nodes.\n\nSave this for your next project kickoff!";

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      return {
        data: {
          rewrittenText: rewritten,
          hashtags: ["#Nextjs", "#WebDev", "#React", "#SoftwareEngineering", "#CodingTips"],
          explanation: "Enhanced formatting with clear numbered points, stronger hook, and action-oriented verbs.",
        },
        model: "gemini-3.5-flash-lite",
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "rewrite",
      goal: "improve",
    });

    assert.equal(result.success, true);
    assert.ok(result.result);
    assert.equal(result.result.mode, "rewrite");
    assert.equal(result.result.goal, "improve");
    assert.equal(result.result.rewrittenText, rewritten);
    assert.equal(result.result.hashtags.length, 5);
    assert.ok(result.result.originalWordCount > 0);
    assert.ok(result.result.rewrittenWordCount > 0);
    assert.ok(result.result.explanation);
  } finally {
    setAiProvider(null);
  }
});

test("Structured Generation: generates exactly 3 distinct opening hook variations for 'hooks' goal", async () => {
  const source = "Most creators spend hours making reels that nobody watches because the first 2 seconds are boring.";

  const mockHooks = [
    "Stop wasting 4 hours on Reels that people swipe past in 2 seconds.",
    "Are you making the #1 visual mistake that kills your Reel retention immediately?",
    "Here is the simple 1.5-second pacing rule that doubled my average watch time.",
  ];

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      return {
        data: {
          alternativeHooks: mockHooks,
          explanation: "Hooks target frustration, curiosity, and transformation.",
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "rewrite",
      goal: "hooks",
    });

    assert.equal(result.success, true);
    assert.ok(result.result);
    assert.equal(result.result.alternativeHooks.length, 3);
    assert.equal(result.result.alternativeHooks[0], mockHooks[0]);
    assert.equal(result.result.alternativeHooks[1], mockHooks[1]);
    assert.equal(result.result.alternativeHooks[2], mockHooks[2]);
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 3. FORMAT CONVERSIONS (REEL, CAROUSEL, STORY)
// ============================================================================

test("Structured Generation: converts text into a 3-beat Reel script with visual notes", async () => {
  const source = "To keep code maintainable in large teams, create strict domain boundaries and use automated architectural linting.";

  const mockReel = {
    hook: "The architectural rule that saves engineering teams 10+ hours of debugging every week.",
    beats: "1. Stop putting shared helpers in a global junk drawer.\n2. Colocate data mutation actions directly with domain components.\n3. Enforce strict import boundaries with linting rules.",
    callToAction: "Save this blueprint for your next refactoring sprint.",
    visualNotes: "Overhead shot of developer laptop with code editor -> Screen recording showing directory colocation.",
  };

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          reelScript: mockReel,
          explanation: "Converted abstract architectural advice into high-paced visual steps.",
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "convert",
      targetFormat: "reel",
    });

    assert.equal(result.success, true);
    assert.ok(result.result);
    assert.equal(result.result.reelScript.hook, mockReel.hook);
    assert.equal(result.result.reelScript.beats, mockReel.beats);
    assert.equal(result.result.reelScript.callToAction, mockReel.callToAction);
    assert.equal(result.result.reelScript.visualNotes, mockReel.visualNotes);
  } finally {
    setAiProvider(null);
  }
});

test("Structured Generation: converts text into a 5-slide Carousel outline", async () => {
  const source = "How to build resilient APIs in Next.js. Validate incoming requests with schemas. Use server boundaries. Return typed errors.";

  const mockSlides = [
    { slideNumber: 1, slideType: "cover", headline: "Resilient Next.js APIs", bodyText: "3 production rules to stop runtime crashes before they happen.", visualSuggestion: "Bold title card" },
    { slideNumber: 2, slideType: "value", headline: "1. Validate Everything", bodyText: "Parse request body and query parameters through schema checks.", visualSuggestion: "Validation diagram" },
    { slideNumber: 3, slideType: "value", headline: "2. Guard Boundaries", bodyText: "Import 'server-only' in server utilities to avoid client secret leakage.", visualSuggestion: "Terminal view" },
    { slideNumber: 4, slideType: "value", headline: "3. Typed Error Handlers", bodyText: "Return structured action states rather than raw uncaught exceptions.", visualSuggestion: "Error code badge" },
    { slideNumber: 5, slideType: "cta", headline: "Save This Guide", bodyText: "Bookmark this post for your next full-stack project build.", visualSuggestion: "Save icon with handle" },
  ];

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          carouselOutline: {
            title: "3 Rules for Resilient Next.js APIs",
            slides: mockSlides,
          },
          explanation: "Structured advice into sequential 5-slide educational carousel.",
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "convert",
      targetFormat: "carousel",
    });

    assert.equal(result.success, true);
    assert.ok(result.result);
    assert.equal(result.result.carouselOutline.slides.length, 5);
    assert.equal(result.result.carouselOutline.slides[0].slideType, "cover");
    assert.equal(result.result.carouselOutline.slides[4].slideType, "cta");
  } finally {
    setAiProvider(null);
  }
});

test("Structured Generation: converts text into a 3-frame Story sequence with sticker ideas", async () => {
  const source = "We redesigned our database queries yesterday and page load dropped by 45%.";

  const mockFrames = [
    { frameNumber: 1, frameType: "hook", content: "Quick question: what is your average page load speed on mobile?", stickerSuggestion: "Poll: Under 1s vs 3s+" },
    { frameNumber: 2, frameType: "insight", content: "We eliminated 4 redundant N+1 queries yesterday and our load time plummeted by 45%.", stickerSuggestion: "Slider: Mindblown emoji" },
    { frameNumber: 3, frameType: "cta", content: "Want the SQL indexing checklist we used? Tap below to read the breakdown.", stickerSuggestion: "Link Sticker: Full Guide" },
  ];

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          storySequence: mockFrames,
          explanation: "Created interactive story sequence driving poll engagement and click-through.",
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "convert",
      targetFormat: "story",
    });

    assert.equal(result.success, true);
    assert.ok(result.result);
    assert.equal(result.result.storySequence.length, 3);
    assert.equal(result.result.storySequence[0].frameType, "hook");
    assert.equal(result.result.storySequence[2].frameType, "cta");
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 4. MULTI-PACK REPURPOSING
// ============================================================================

test("Structured Generation: produces full Multi-Pack suite (Feed, Reel, Carousel, Story) in a single request", async () => {
  const source = "Batching your content on Sundays saves 15 hours during the work week.";

  const mockMulti = {
    feedCaption: "Why Sunday content batching changed everything for my workflow:\n\n1. Zero daily context switching.\n2. Predictable schedule.\n3. Better creative focus.\n\nSwipe through for my complete system!",
    hashtags: ["#Productivity", "#CreatorEconomy", "#Batching", "#Workflow", "#ContentCreation"],
    reelScript: {
      hook: "How I save 15 hours every single week with 1 calendar habit.",
      beats: "Outline on Saturday -> Record 4 videos in 90 mins on Sunday morning -> Schedule automatically.",
      callToAction: "Comment 'SYSTEM' and I'll send my full notion template.",
      visualNotes: "Desk setup shot showing weekly calendar view",
    },
    carouselOutline: {
      title: "The Sunday Batching System",
      slides: [
        { slideNumber: 1, slideType: "cover", headline: "The Sunday Batching System", bodyText: "How to save 15 hours a week." },
        { slideNumber: 2, slideType: "value", headline: "Step 1: Outline First", bodyText: "Never start recording with a blank page." },
        { slideNumber: 3, slideType: "value", headline: "Step 2: Batch Audio/Video", bodyText: "Keep lighting setup constant." },
        { slideNumber: 4, slideType: "value", headline: "Step 3: Schedule Ahead", bodyText: "Use drafts to line up the week." },
        { slideNumber: 5, slideType: "cta", headline: "Save This System", bodyText: "Bookmark for this Sunday." },
      ],
    },
    storySequence: [
      { frameNumber: 1, frameType: "hook", content: "Do you batch your content or create daily on the fly?", stickerSuggestion: "Poll: Batch vs Daily" },
      { frameNumber: 2, frameType: "insight", content: "Batching 4 videos in 1 morning freed up my entire work week for client work.", stickerSuggestion: "Question box" },
      { frameNumber: 3, frameType: "cta", content: "Check my newest post for the full breakdown step by step!", stickerSuggestion: "Tap here sticker" },
    ],
    explanation: "Repurposed across all formats.",
  };

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return { data: mockMulti };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "multipack",
    });

    assert.equal(result.success, true);
    assert.ok(result.result);
    assert.ok(result.result.multiPack);
    assert.ok(result.result.multiPack.feedCaption);
    assert.ok(result.result.multiPack.reelScript.hook);
    assert.equal(result.result.multiPack.carouselOutline.slides.length, 5);
    assert.equal(result.result.multiPack.storySequence.length, 3);
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 5. MANDATORY SAFEGUARDS & BOUNDARIES
// ============================================================================

test("Mandatory Safeguard: does NOT silently pad incomplete carousel slides; rejects and reports error", async () => {
  const source = "Some valid source text for carousel conversion.";

  // Incomplete: only 3 slides returned when 5 are required
  const incompleteProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          carouselOutline: {
            title: "Incomplete Carousel",
            slides: [
              { slideNumber: 1, headline: "Slide 1", bodyText: "Text 1" },
              { slideNumber: 2, headline: "Slide 2", bodyText: "Text 2" },
              { slideNumber: 3, headline: "Slide 3", bodyText: "Text 3" },
            ],
          },
          explanation: "Incomplete generation",
        },
      };
    },
  };

  setAiProvider(incompleteProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "convert",
      targetFormat: "carousel",
    });

    // Verified: Safeguard refuses to fabricate missing slides
    assert.equal(result.success, false);
    assert.ok(result.error.includes("incomplete carousel deck"));
  } finally {
    setAiProvider(null);
  }
});

test("Mandatory Safeguard: does NOT silently pad incomplete Story frames; rejects and reports error", async () => {
  const source = "Some valid source text for story conversion.";

  // Incomplete: only 1 frame returned when 3 are required
  const incompleteStoryProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          storySequence: [
            { frameNumber: 1, content: "Frame 1 only" },
          ],
        },
      };
    },
  };

  setAiProvider(incompleteStoryProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: source,
      mode: "convert",
      targetFormat: "story",
    });

    // Verified: Safeguard refuses to fabricate missing frames
    assert.equal(result.success, false);
    assert.ok(result.error.includes("incomplete Story sequence"));
  } finally {
    setAiProvider(null);
  }
});

test("Personalization & Boundaries: system instructions mandate factual preservation and zero false promises", async () => {
  let capturedRequest = null;

  const mockProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured(request) {
      capturedRequest = request;
      return {
        data: {
          rewrittenText: "Polished text here.",
          hashtags: ["#test"],
          explanation: "Safe",
        },
      };
    },
  };

  setAiProvider(mockProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Valid source content for instruction testing.",
      mode: "rewrite",
      goal: "improve",
    });

    assert.equal(result.success, true);
    assert.ok(capturedRequest);
    assert.ok(capturedRequest.systemInstruction.includes("PRESERVE SOURCE MEANING & FACTUAL CLAIMS"));
    assert.ok(capturedRequest.systemInstruction.includes("NEVER invent facts"));
    assert.ok(capturedRequest.systemInstruction.includes("ZERO FALSE PROMISES"));
    assert.ok(capturedRequest.systemInstruction.includes("FORBIDDEN TOPICS (STRICT BOUNDARY)"));
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 6. DRAFT INTEGRATION
// ============================================================================

test("Draft Integration: outputs across all formats satisfy validateDraftInput", () => {
  // Test Post draft
  const postDraft = validateDraftInput({
    title: "Rewritten Post Draft",
    caption: "Polished caption here with generous line breaks.\n\n#Nextjs #WebDev",
    format: "post",
    status: "draft",
    metadata: { source: "repurposing_studio", mode: "rewrite", goal: "improve" },
  });
  assert.equal(postDraft.isValid, true);
  assert.equal(postDraft.sanitized.format, "post");

  // Test Reel draft
  const reelDraft = validateDraftInput({
    title: "Reel Script: 3 Architecture Tips",
    caption: "[HOOK]\nStop wasting time on slow builds.\n\n[BEATS]\n1. Colocate code.\n2. Server boundaries.\n\n[CTA]\nSave this!",
    format: "reel",
    status: "draft",
    metadata: { source: "repurposing_studio", mode: "convert", targetFormat: "reel" },
  });
  assert.equal(reelDraft.isValid, true);
  assert.equal(reelDraft.sanitized.format, "reel");

  // Test Carousel draft
  const carouselDraft = validateDraftInput({
    title: "5-Slide Carousel Deck",
    caption: "[SLIDE 1: COVER]\nHeadline\nBody\n\n---\n\n[SLIDE 2: VALUE]\nPoint 1\nDetails",
    format: "carousel",
    status: "draft",
    metadata: { source: "repurposing_studio", mode: "convert", targetFormat: "carousel" },
  });
  assert.equal(carouselDraft.isValid, true);
  assert.equal(carouselDraft.sanitized.format, "carousel");

  // Test Story draft
  const storyDraft = validateDraftInput({
    title: "3-Part Story Sequence",
    caption: "[FRAME 1: HOOK]\nPoll question\n\n---\n\n[FRAME 2: INSIGHT]\nKey takeaway\n\n---\n\n[FRAME 3: CTA]\nLink",
    format: "story",
    status: "draft",
    metadata: { source: "repurposing_studio", mode: "convert", targetFormat: "story" },
  });
  assert.equal(storyDraft.isValid, true);
  assert.equal(storyDraft.sanitized.format, "story");
});

// ============================================================================
// 7. HONEST QUOTA & ERROR HANDLING (₹0 BUDGET)
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
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Valid source content for quota testing.",
      mode: "rewrite",
      goal: "improve",
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
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Valid source content for auth failure testing.",
      mode: "rewrite",
      goal: "improve",
    });
    assert.equal(result.success, false);
    assert.ok(result.error.includes("Unable to authenticate with Google Gemini"));
    assert.ok(!result.error.includes("AIza"));
  } finally {
    setAiProvider(null);
  }
});

// ============================================================================
// 8. RESILIENT EXTRACTION REGRESSION TESTS (REAL-WORLD GEMINI SHAPES)
// ============================================================================

test("Regression: extracts rewrite when Gemini outputs alternative keys (e.g. 'rewrite', 'tags')", async () => {
  const alternativeRewriteProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          rewrite: "Polished copy using alternate key structure.",
          tags: ["#alternative", "#keys"],
          explanation: "Handled alternate wrapper.",
        },
      };
    },
  };

  setAiProvider(alternativeRewriteProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Testing alternative rewrite key extraction.",
      mode: "rewrite",
      goal: "improve",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.rewrittenText, "Polished copy using alternate key structure.");
    assert.equal(result.result.hashtags.length, 2);
  } finally {
    setAiProvider(null);
  }
});

test("Regression: extracts Reel script when Gemini outputs alternative keys ('script', 'body', 'cta')", async () => {
  const alternativeReelProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          script: {
            hook: "Stop scrolling right now.",
            body: "1. Key lesson.\n2. Key practice.",
            cta: "Save this video.",
            notes: "Quick zoom-in on face.",
          },
        },
      };
    },
  };

  setAiProvider(alternativeReelProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Testing alternative reel script extraction.",
      mode: "convert",
      targetFormat: "reel",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.reelScript.hook, "Stop scrolling right now.");
    assert.equal(result.result.reelScript.beats, "1. Key lesson.\n2. Key practice.");
    assert.equal(result.result.reelScript.callToAction, "Save this video.");
    assert.equal(result.result.reelScript.visualNotes, "Quick zoom-in on face.");
  } finally {
    setAiProvider(null);
  }
});

test("Regression: extracts Carousel slides when Gemini wraps in 'carousel.slides' or 'deck'", async () => {
  const alternativeCarouselProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          carousel: {
            title: "Alternative Deck Title",
            slides: [
              { title: "Slide 1", content: "Details 1", visual: "Card 1" },
              { title: "Slide 2", content: "Details 2", visual: "Card 2" },
              { title: "Slide 3", content: "Details 3", visual: "Card 3" },
              { title: "Slide 4", content: "Details 4", visual: "Card 4" },
              { title: "Slide 5", content: "Details 5", visual: "Card 5" },
            ],
          },
        },
      };
    },
  };

  setAiProvider(alternativeCarouselProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Testing alternative carousel outline extraction.",
      mode: "convert",
      targetFormat: "carousel",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.carouselOutline.title, "Alternative Deck Title");
    assert.equal(result.result.carouselOutline.slides.length, 5);
    assert.equal(result.result.carouselOutline.slides[0].headline, "Slide 1");
    assert.equal(result.result.carouselOutline.slides[0].bodyText, "Details 1");
    assert.equal(result.result.carouselOutline.slides[0].visualSuggestion, "Card 1");
  } finally {
    setAiProvider(null);
  }
});

test("Regression: extracts Story sequence when Gemini outputs 'stories' array with 'text' and 'sticker'", async () => {
  const alternativeStoryProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          stories: [
            { text: "Frame 1 Question", sticker: "Poll: Yes/No" },
            { text: "Frame 2 Breakdown", sticker: "Slider" },
            { text: "Frame 3 Call to action", sticker: "Link" },
          ],
        },
      };
    },
  };

  setAiProvider(alternativeStoryProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Testing alternative story sequence extraction.",
      mode: "convert",
      targetFormat: "story",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.storySequence.length, 3);
    assert.equal(result.result.storySequence[0].content, "Frame 1 Question");
    assert.equal(result.result.storySequence[0].stickerSuggestion, "Poll: Yes/No");
  } finally {
    setAiProvider(null);
  }
});

test("Regression: extracts Multi-Pack when Gemini uses 'caption', 'reel', 'carousel', 'story' shorthand", async () => {
  const alternativeMultiPackProvider = {
    providerName: "gemini",
    defaultModel: "gemini-3.5-flash-lite",
    async generateStructured() {
      return {
        data: {
          caption: "Shorthand multi-pack caption.",
          tags: ["#multi", "#pack"],
          reel: {
            hook: "Shorthand hook",
            beats: "Shorthand lesson",
            cta: "Shorthand CTA",
          },
          carousel: {
            slides: [
              { headline: "S1", bodyText: "B1" },
              { headline: "S2", bodyText: "B2" },
              { headline: "S3", bodyText: "B3" },
              { headline: "S4", bodyText: "B4" },
              { headline: "S5", bodyText: "B5" },
            ],
          },
          story: [
            { content: "F1 content" },
            { content: "F2 content" },
            { content: "F3 content" },
          ],
        },
      };
    },
  };

  setAiProvider(alternativeMultiPackProvider);

  try {
    const result = await repurposeContent("d6071436-1a92-4bbd-ad76-d4d2689705a0", {
      sourceText: "Testing alternative multi-pack extraction.",
      mode: "multipack",
    });

    assert.equal(result.success, true);
    assert.ok(result.result.multiPack);
    assert.equal(result.result.multiPack.feedCaption, "Shorthand multi-pack caption.");
    assert.equal(result.result.multiPack.reelScript.hook, "Shorthand hook");
    assert.equal(result.result.multiPack.carouselOutline.slides.length, 5);
    assert.equal(result.result.multiPack.storySequence.length, 3);
  } finally {
    setAiProvider(null);
  }
});
