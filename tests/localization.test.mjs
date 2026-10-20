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
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
  normalizeLanguagePreset,
  buildLanguageScriptPromptDirectives,
  checkScriptConsistency,
} = await import("../app/lib/localization/standards.ts");

const { validateIdeasInput, generateContentIdeas } = await import("../app/lib/ideas/service.ts");
const { validateChatInput } = await import("../app/lib/chat/service.ts");
const { validateCarouselInput, generateCarouselDeck } = await import("../app/lib/carousels/service.ts");
const { validateRepurposeInput } = await import("../app/lib/repurposing/service.ts");
const { validateDraftInput } = await import("../app/lib/drafts/service.ts");
const { setAiProvider } = await import("../app/lib/ai/index.ts");

// ============================================================================
// 1. STANDARDS AND CANONICAL PRESETS TESTS
// ============================================================================

test("Standards: Canonical language presets include required options", () => {
  const expectedPresetIds = [
    "English",
    "Hindi (Devanagari)",
    "Hinglish (Roman script)",
    "Punjabi (Gurmukhi)",
    "Romanized Punjabi",
  ];
  for (const id of expectedPresetIds) {
    const found = CANONICAL_LANGUAGE_PRESETS.some((p) => p.id === id);
    assert.ok(found, `Expected ${id} to be in CANONICAL_LANGUAGE_PRESETS`);
  }
});

test("Standards: Canonical tones include standard writing styles", () => {
  const expectedTones = [
    "Casual & Relatable",
    "Professional & Authoritative",
    "Entertaining & Humorous",
    "Educational & Informative",
    "Inspirational & Motivational",
  ];
  for (const t of expectedTones) {
    assert.ok(
      CANONICAL_TONE_OPTIONS.includes(t),
      `Expected ${t} to be in CANONICAL_TONE_OPTIONS`
    );
  }
});

test("Standards: normalizeLanguagePreset correctly maps aliases and legacy values", () => {
  assert.equal(normalizeLanguagePreset("Hindi"), "Hindi (Devanagari)");
  assert.equal(normalizeLanguagePreset("hindi"), "Hindi (Devanagari)");
  assert.equal(normalizeLanguagePreset("Hindi (Devanagari)"), "Hindi (Devanagari)");
  assert.equal(normalizeLanguagePreset("Hinglish"), "Hinglish (Roman script)");
  assert.equal(normalizeLanguagePreset("hinglish"), "Hinglish (Roman script)");
  assert.equal(normalizeLanguagePreset("Punjabi"), "Punjabi (Gurmukhi)");
  assert.equal(normalizeLanguagePreset("punjabi"), "Punjabi (Gurmukhi)");
  assert.equal(normalizeLanguagePreset("Romanized Punjabi"), "Romanized Punjabi");
  assert.equal(normalizeLanguagePreset("Punjabi (Roman script)"), "Romanized Punjabi");
  assert.equal(normalizeLanguagePreset("English"), "English");
  assert.equal(normalizeLanguagePreset("Spanish"), "Spanish");
  assert.equal(normalizeLanguagePreset(""), "English");
  assert.equal(normalizeLanguagePreset(null), "English");
  assert.equal(normalizeLanguagePreset(undefined), "English");
});

test("Standards: buildLanguageScriptPromptDirectives builds unambiguous rules", () => {
  const hindiDirectives = buildLanguageScriptPromptDirectives("Hindi (Devanagari)");
  assert.ok(hindiDirectives.includes("Devanagari script"));
  assert.ok(hindiDirectives.includes("Do NOT output Romanized / Latin phonetic transliteration"));

  const hinglishDirectives = buildLanguageScriptPromptDirectives("Hinglish (Roman script)");
  assert.ok(hinglishDirectives.includes("Latin / Roman alphabet"));
  assert.ok(hinglishDirectives.includes("Do NOT use Devanagari script"));

  const punjabiDirectives = buildLanguageScriptPromptDirectives("Punjabi (Gurmukhi)");
  assert.ok(punjabiDirectives.includes("Gurmukhi script"));
  assert.ok(punjabiDirectives.includes("Do NOT output Romanized / Latin transliteration"));

  const romanPunjabiDirectives = buildLanguageScriptPromptDirectives("Romanized Punjabi");
  assert.ok(romanPunjabiDirectives.includes("Latin / Roman alphabet"));
  assert.ok(romanPunjabiDirectives.includes("Do NOT use Gurmukhi script"));

  const englishDirectives = buildLanguageScriptPromptDirectives("English");
  assert.ok(englishDirectives.includes("English"));
});

// ============================================================================
// 2. SCRIPT CONSISTENCY DETECTION (NON-BLOCKING) TESTS
// ============================================================================

test("Script Consistency: Native Hindi (Devanagari) output passes without warning", () => {
  const sampleHindi = "यह एक बहुत ही महत्वपूर्ण सबक है जिसे हर डेवलपर को समझना चाहिए। #coding #tech";
  const result = checkScriptConsistency(sampleHindi, "Hindi (Devanagari)");
  assert.equal(result.isConsistent, true);
  assert.equal(result.warning, undefined);
});

test("Script Consistency: Pure English output when Hindi (Devanagari) requested triggers warning", () => {
  const sampleEnglish = "This is a great lesson that every developer must understand to improve their workflow and ship faster.";
  const result = checkScriptConsistency(sampleEnglish, "Hindi (Devanagari)");
  assert.equal(result.isConsistent, false);
  assert.ok(result.warning && result.warning.includes("Devanagari"));
});

test("Script Consistency: Native Gurmukhi output passes for Punjabi (Gurmukhi)", () => {
  const sampleGurmukhi = "ਇਹ ਇੱਕ ਬਹੁਤ ਜ਼ਰੂਰੀ ਗੱਲ ਹੈ ਜੋ ਹਰ ਇੱਕ ਨੂੰ ਪਤਾ ਹੋਣੀ ਚਾਹੀਦੀ ਹੈ। ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ। #punjabi";
  const result = checkScriptConsistency(sampleGurmukhi, "Punjabi (Gurmukhi)");
  assert.equal(result.isConsistent, true);
  assert.equal(result.warning, undefined);
});

test("Script Consistency: Pure English output when Punjabi (Gurmukhi) requested triggers warning", () => {
  const sampleEnglish = "Here are the top three secrets to growing your Instagram audience organically in thirty days.";
  const result = checkScriptConsistency(sampleEnglish, "Punjabi (Gurmukhi)");
  assert.equal(result.isConsistent, false);
  assert.ok(result.warning && result.warning.includes("Gurmukhi"));
});

test("Script Consistency: Hinglish written in Roman script passes without warning", () => {
  const sampleHinglish = "Agar aap Next.js use kar rahe ho toh yeh 3 common mistakes kabhi mat karna. Check the caption below! #tech";
  const result = checkScriptConsistency(sampleHinglish, "Hinglish (Roman script)");
  assert.equal(result.isConsistent, true);
  assert.equal(result.warning, undefined);
});

test("Script Consistency: Devanagari script output when Hinglish requested triggers warning", () => {
  const sampleDevanagari = "अगर आप नेक्स्ट जेएस का उपयोग कर रहे हैं तो यह गलतियाँ बिल्कुल मत करें। #tech";
  const result = checkScriptConsistency(sampleDevanagari, "Hinglish (Roman script)");
  assert.equal(result.isConsistent, false);
  assert.ok(result.warning && result.warning.includes("Roman"));
});

test("Script Consistency: Romanized Punjabi written in Latin alphabet passes", () => {
  const sampleRomanPunjabi = "Tussi vi Instagram te grow karna chaunde ho? Aithe 3 vaddi ghaltiyan baare gal karde aan. #punjabi";
  const result = checkScriptConsistency(sampleRomanPunjabi, "Romanized Punjabi");
  assert.equal(result.isConsistent, true);
  assert.equal(result.warning, undefined);
});

test("Script Consistency: Gurmukhi script output when Romanized Punjabi requested triggers warning", () => {
  const sampleGurmukhi = "ਤੁਸੀਂ ਵੀ ਇੰਸਟਾਗ੍ਰਾਮ ਉੱਤੇ ਗ੍ਰੋ ਕਰਨਾ ਚਾਹੁੰਦੇ ਹੋ? ਇੱਥੇ ੩ ਵੱਡੀਆਂ ਗੱਲਾਂ ਬਾਰੇ ਜਾਣੋ। ਤਿੰਨ ਨੁਕਤੇ ਜ਼ਰੂਰੀ ਹਨ।";
  const result = checkScriptConsistency(sampleGurmukhi, "Romanized Punjabi");
  assert.equal(result.isConsistent, false);
  assert.ok(result.warning && result.warning.includes("Roman"));
});

test("Script Consistency: Ignores URLs, hashtags, code snippets and short snippets without false alarms", () => {
  // Short text should not trigger
  const shortResult = checkScriptConsistency("Short text", "Hindi (Devanagari)");
  assert.equal(shortResult.isConsistent, true);

  // Hashtags, English words, code blocks mixed with native script
  const mixedDevanagari = "यहाँ 5 उपयोगी कोडिंग टिप्स हैं: const x = 10; https://github.com/example/repo #javascript #nextjs #webdev";
  const mixedResult = checkScriptConsistency(mixedDevanagari, "Hindi (Devanagari)");
  assert.equal(mixedResult.isConsistent, true);
});

// ============================================================================
// 3. SERVICE-LEVEL VALIDATION & INTEGRATION TESTS
// ============================================================================

test("Ideas Service: validateIdeasInput accepts tone and normalizes language", () => {
  const res = validateIdeasInput({
    topic: "Next.js 15 tips",
    pillar: "Tutorials",
    format: "reel",
    language: "Hinglish (Roman script)",
    tone: "Entertaining & Humorous",
  });
  assert.equal(res.isValid, true);
  assert.equal(res.sanitized?.language, "Hinglish (Roman script)");
  assert.equal(res.sanitized?.tone, "Entertaining & Humorous");
});

test("Chat Service: validateChatInput accepts language and tone", () => {
  const res = validateChatInput({
    message: "Give me 3 content ideas for next week",
    language: "Hindi (Devanagari)",
    tone: "Professional & Authoritative",
  });
  assert.equal(res.isValid, true);
  assert.equal(res.sanitized?.language, "Hindi (Devanagari)");
  assert.equal(res.sanitized?.tone, "Professional & Authoritative");
});

test("Carousel Service: validateCarouselInput preserves language and tone", () => {
  const res = validateCarouselInput({
    topic: "How to scale Postgres",
    slideCount: 5,
    language: "Punjabi (Gurmukhi)",
    tone: "Educational & Informative",
  });
  assert.equal(res.isValid, true);
  assert.equal(res.sanitized?.language, "Punjabi (Gurmukhi)");
  assert.equal(res.sanitized?.tone, "Educational & Informative");
});

test("Repurposing Service: validateRepurposeInput preserves language and tone", () => {
  const res = validateRepurposeInput({
    sourceText: "Here is an existing caption with more than ten characters.",
    mode: "rewrite",
    goal: "improve",
    language: "Romanized Punjabi",
    tone: "Casual & Relatable",
  });
  assert.equal(res.isValid, true);
  assert.equal(res.sanitized?.language, "Romanized Punjabi");
  assert.equal(res.sanitized?.tone, "Casual & Relatable");
});

// ============================================================================
// 4. MOCK AI GENERATION WITH LANGUAGE & SCRIPT CHECKS
// ============================================================================

test("Ideas Service: generateContentIdeas propagates tone, language and checks script", async () => {
  const mockProvider = {
    generateText: async () => { throw new Error("not implemented"); },
    generateStructured: async () => ({
      data: {
        concepts: [
          {
            title: "Devanagari Concept 1",
            format: "reel",
            targetAudienceAngle: "Developers",
            hooks: [
              "क्या आप Next.js की ये ३ गलतियां कर रहे हैं?",
              "डेवलपर्स, ये गलती कभी मत करना!",
              "Next.js में स्पीड दोगुनी कैसे करें?",
            ],
            script: {
              hook: "क्या आप Next.js की ये ३ गलतियां कर रहे हैं?",
              lesson: "पहला नियम है कि आप सर्वर कंपोनेंट्स का सही उपयोग करें और बिना जरूरत क्लाइंट कंपोनेंट न बनाएं।",
              callToAction: "अधिक टिप्स के लिए फॉलो करें।",
            },
          },
        ],
      },
      tokensUsed: 150,
      cachedTokens: 0,
    }),
  };
  setAiProvider(mockProvider);

  const result = await generateContentIdeas(
    "test-user-id",
    {
      topic: "React performance",
      format: "reel",
      language: "Hindi (Devanagari)",
      tone: "Educational & Informative",
    }
  );

  assert.equal(result.success, true);
  assert.ok(result.ideas && result.ideas.length > 0);
  assert.equal(result.ideas[0].language, "Hindi (Devanagari)");
  assert.equal(result.ideas[0].tone, "Educational & Informative");
  assert.equal(result.scriptWarning, undefined);
});

test("Ideas Service: returns scriptWarning when mock AI produces English for Hindi Devanagari", async () => {
  const mockProvider = {
    generateText: async () => { throw new Error("not implemented"); },
    generateStructured: async () => ({
      data: {
        concepts: [
          {
            title: "English Concept 1",
            format: "reel",
            targetAudienceAngle: "Developers",
            hooks: [
              "Are you making these 3 huge Next.js mistakes right now?",
              "Developers, stop doing this immediately in your code!",
              "How to double your Next.js application speed today?",
            ],
            script: {
              hook: "Are you making these 3 huge Next.js mistakes right now?",
              lesson: "The core lesson is to always separate server and client boundaries carefully to avoid shipping bundle bloat.",
              callToAction: "Follow for more full-stack web development tips.",
            },
          },
        ],
      },
      tokensUsed: 150,
      cachedTokens: 0,
    }),
  };
  setAiProvider(mockProvider);

  const result = await generateContentIdeas(
    "test-user-id",
    {
      topic: "React performance",
      format: "reel",
      language: "Hindi (Devanagari)",
      tone: "Educational & Informative",
    }
  );

  assert.equal(result.success, true);
  assert.ok(result.ideas && result.ideas.length > 0);
  assert.ok(result.scriptWarning !== undefined);
  assert.ok(result.scriptWarning?.includes("Devanagari"));
});

test("Carousel Service: generateCarouselDeck checks script consistency across slides and caption", async () => {
  const mockProvider = {
    generateText: async () => { throw new Error("not implemented"); },
    generateStructured: async () => ({
      data: {
        title: "ਪੰਜਾਬੀ ਕੈਰੋਸਲ ਡੈੱਕ",
        companionCaption: "ਇਹ ਕੈਰੋਸਲ ਜ਼ਰੂਰ ਪੜ੍ਹੋ ਅਤੇ ਆਪਣੇ ਦੋਸਤਾਂ ਨਾਲ ਸਾਂਝਾ ਕਰੋ ਜੀ। #punjabi",
        hashtags: ["#punjabi", "#tech"],
        slides: [
          {
            slideNumber: 1,
            slideType: "cover",
            headline: "ਸਿੱਖੋ ਨਵੀਆਂ ਗੱਲਾਂ",
            bodyText: "ਇਸ ਕੈਰੋਸਲ ਵਿੱਚ ਅਸੀਂ ਵੈੱਬ ਡਿਵੈਲਪਮੈਂਟ ਦੀਆਂ ੫ ਜ਼ਰੂਰੀ ਗੱਲਾਂ ਬਾਰੇ ਚਰਚਾ ਕਰਾਂਗੇ।",
            visualSuggestion: "ਬੋਲਡ ਫੌਂਟ ਅਤੇ ਸਾਫ਼ ਬੈਕਗ੍ਰਾਊਂਡ",
          },
          {
            slideNumber: 2,
            slideType: "value",
            headline: "ਪਹਿਲਾ ਨਿਯਮ",
            bodyText: "ਸਰਵਰ ਕੰਪੋਨੈਂਟਸ ਦੀ ਵਰਤੋਂ ਕਰੋ ਤਾਂ ਜੋ ਸਪੀਡ ਵਧ ਸਕੇ।",
            visualSuggestion: "ਸਰਵਰ ਆਈਕਨ",
          },
          {
            slideNumber: 3,
            slideType: "value",
            headline: "ਦੂਜਾ ਨਿਯਮ",
            bodyText: "ਕੋਡ ਨੂੰ ਸਾਫ਼ ਅਤੇ ਸੌਖਾ ਰੱਖੋ।",
            visualSuggestion: "ਕੋਡ ਸਨਿੱਪਟ",
          },
          {
            slideNumber: 4,
            slideType: "value",
            headline: "ਤੀਜਾ ਨਿਯਮ",
            bodyText: "ਹਮੇਸ਼ਾ ਟੈਸਟਿੰਗ ਕਰੋ।",
            visualSuggestion: "ਚੈੱਕਮਾਰਕ",
          },
          {
            slideNumber: 5,
            slideType: "cta",
            headline: "ਹੁਣੇ ਸੇਵ ਕਰੋ",
            bodyText: "ਜੇ ਇਹ ਪੋਸਟ ਪਸੰਦ ਆਈ ਤਾਂ ਲਾਈਕ ਅਤੇ ਸ਼ੇਅਰ ਕਰੋ!",
            visualSuggestion: "ਸੇਵ ਬਟਨ ਐਰੋ",
          },
        ],
      },
      tokensUsed: 220,
      cachedTokens: 0,
    }),
  };
  setAiProvider(mockProvider);

  const result = await generateCarouselDeck(
    "test-user-id",
    {
      topic: "Web development basics",
      slideCount: 5,
      language: "Punjabi (Gurmukhi)",
      tone: "Educational & Informative",
    }
  );

  assert.equal(result.success, true);
  assert.ok(result.carousel);
  assert.equal(result.carousel.language, "Punjabi (Gurmukhi)");
  assert.equal(result.carousel.tone, "Educational & Informative");
  assert.equal(result.scriptWarning, undefined);
});

test("Draft Storage: validateDraftInput accepts language, tone and scriptWarning in metadata", () => {
  const validation = validateDraftInput({
    title: "Localized Draft Test",
    caption: "यह एक हिंदी ड्राफ्ट है।",
    format: "post",
    status: "draft",
    metadata: {
      language: "Hindi (Devanagari)",
      tone: "Casual & Relatable",
      scriptWarning: "Notice: Note on script check.",
      source: "caption_generator",
    },
  });

  assert.equal(validation.isValid, true);
  assert.equal(validation.sanitized?.metadata?.language, "Hindi (Devanagari)");
  assert.equal(validation.sanitized?.metadata?.tone, "Casual & Relatable");
  assert.equal(validation.sanitized?.metadata?.scriptWarning, "Notice: Note on script check.");
});
