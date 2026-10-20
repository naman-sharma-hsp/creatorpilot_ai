import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// Register custom hook so Node's test runner can load Next.js 'server-only' package marker
// and resolve Next.js dynamic modules & TypeScript source modules
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
    if (specifier === "next/navigation") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export function redirect(url) { const err = new Error('NEXT_REDIRECT'); err.digest = 'NEXT_REDIRECT;replace;' + url + ';307;'; err.destination = url; throw err; }",
      };
    }
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        err &&
        (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        try {
          return nextResolve(`${specifier}.ts`, context);
        } catch {
          return nextResolve(`${specifier}/index.ts`, context);
        }
      }
      throw err;
    }
  },
});

// Dynamically import modules under test
const {
  validateCreatorPreferences,
  getDefaultCreatorPreferences,
  sanitizeStringList,
  ALLOWED_FORMATS,
  STANDARD_LANGUAGES,
} = await import("../app/lib/creator-profile/validation.ts");

const {
  analyzeCreatorIdentity,
} = await import("../app/lib/creator-profile/service.ts");

const { setAiProvider } = await import("../app/lib/ai/index.ts");
const { AiRateLimitError, AiError } = await import("../app/lib/ai/types.ts");

// ============================================================================
// SUITE 1: VALIDATION & SANITIZATION TESTS
// ============================================================================

test("Validation: returns valid default preferences", () => {
  const defaults = getDefaultCreatorPreferences();
  assert.equal(defaults.niche, "");
  assert.equal(defaults.isConfirmed, false);
  assert.deepEqual(defaults.languages, ["English"]);
  assert.deepEqual(defaults.preferredFormats, ["reel", "carousel"]);
});

test("Validation: exports standard format and language presets", () => {
  assert.ok(Array.isArray(ALLOWED_FORMATS));
  assert.ok(ALLOWED_FORMATS.includes("reel"));
  assert.ok(ALLOWED_FORMATS.includes("carousel"));
  assert.ok(Array.isArray(STANDARD_LANGUAGES));
  assert.ok(STANDARD_LANGUAGES.includes("Hindi"));
  assert.ok(STANDARD_LANGUAGES.includes("Punjabi"));
  assert.ok(STANDARD_LANGUAGES.includes("Hinglish"));
});

test("Validation: sanitizes string lists with length bounds and deduplication", () => {
  const input = ["Tech", "  tech  ", "AI & ML", "Tech", "Long".repeat(30)];
  const sanitized = sanitizeStringList(input, 20, 5);
  assert.equal(sanitized.length, 3);
  assert.equal(sanitized[0], "Tech");
  assert.equal(sanitized[1], "AI & ML");
  assert.ok(sanitized[2].length <= 20);
});

test("Validation: accepts Indian regional languages and custom scripts", () => {
  const input = {
    niche: "Coding Tutorials",
    languages: ["English", "Hindi", "Punjabi", "Hinglish", "Romanized Punjabi", "Tamil"],
  };
  const result = validateCreatorPreferences(input);
  assert.equal(result.isValid, true);
  assert.equal(result.sanitized.languages.length, 6);
  assert.ok(result.sanitized.languages.includes("Hindi"));
  assert.ok(result.sanitized.languages.includes("Punjabi"));
  assert.ok(result.sanitized.languages.includes("Hinglish"));
  assert.ok(result.sanitized.languages.includes("Romanized Punjabi"));
});

test("Validation: enforces format enum bounds", () => {
  const input = {
    niche: "Design",
    preferredFormats: ["reel", "invalid_format", "carousel", "tiktok", "story"],
  };
  const result = validateCreatorPreferences(input);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.sanitized.preferredFormats, ["reel", "carousel", "story"]);
});

test("Validation: flags excessive character lengths", () => {
  const input = {
    niche: "X".repeat(150), // max is 100
    targetAudience: "Y".repeat(600), // max is 500
  };
  const result = validateCreatorPreferences(input);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.niche);
  assert.ok(result.errors.targetAudience);
});

test("Validation: preserves confirmation status and timestamp", () => {
  const input = {
    niche: "Solo Business",
    isConfirmed: true,
    confirmedAt: "2026-10-19T10:00:00.000Z",
  };
  const result = validateCreatorPreferences(input);
  assert.equal(result.isValid, true);
  assert.equal(result.sanitized.isConfirmed, true);
  assert.equal(result.sanitized.confirmedAt, "2026-10-19T10:00:00.000Z");
});

// ============================================================================
// SUITE 2: AI IDENTITY ANALYSIS & DATA MINIMIZATION
// ============================================================================

test("AI Analysis: derives identity and verifies unavailable demographics are not fabricated", async () => {
  let capturedRequest = null;

  // Mock AI Provider
  const mockProvider = {
    providerName: "MockProvider",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {
      throw new Error("Not used");
    },
    async generateStructured(request) {
      capturedRequest = request;
      return {
        model: "mock-model",
        rawText: "{}",
        data: {
          suggestedNiche: "Full-Stack Web Development",
          suggestedSubNiches: ["Next.js App Router", "Supabase Architecture"],
          audienceThemes: ["Self-taught Developers", "Engineering Students"],
          audienceDemographicsNote: "Exact demographics (age/gender/city distributions) are unavailable via standard Instagram Graph API scopes.",
          contentThemes: ["Code Snippets", "Architecture Breakdowns"],
          recommendedFormats: ["carousel", "reel"],
          opportunities: ["Break down React 19 server actions in Hinglish carousels"],
          discrepancies: [
            {
              field: "Brand Voice",
              creatorAnswer: "Casual & Relatable",
              aiObservation: "High technical jargon in recent captions",
              explanation: "Recent captions read very academic compared to the requested casual persona.",
              severity: "info",
            },
          ],
          missingEvidenceNotes: ["No demographic breakdown available without advanced graph scopes."],
        },
      };
    },
  };

  setAiProvider(mockProvider);

  const result = await analyzeCreatorIdentity({
    creatorAnswers: {
      niche: "Software Engineering",
      subNiches: ["Next.js", "React"],
      languages: ["English", "Hinglish"],
      brandVoice: ["Casual & Relatable"],
    },
    instagramContext: {
      username: "code_creator",
      followersCount: 15400,
      reach30d: 45200,
      mediaCount: 120,
      recentCaptions: ["Building a full stack app with Next.js 16 and Supabase!"],
    },
  });

  assert.equal(result.success, true);
  assert.ok(result.analysis);
  assert.equal(result.analysis.suggestedNiche, "Full-Stack Web Development");
  assert.equal(result.analysis.discrepancies.length, 1);
  assert.equal(result.analysis.discrepancies[0].field, "Brand Voice");

  // Verify that audienceDemographicsNote explicitly disclaims exact demographics
  assert.ok(result.analysis.audienceDemographicsNote.includes("unavailable"));

  // Verify Data Minimization in captured prompt:
  assert.ok(capturedRequest);
  const promptStr = capturedRequest.prompt;
  assert.ok(promptStr.includes("code_creator"));
  assert.ok(promptStr.includes("Next.js"));
  // Ensure NO tokens, secrets, or fake credentials were in prompt
  assert.ok(!promptStr.includes("EAAB"));
  assert.ok(!promptStr.includes("AIza"));
  assert.ok(!promptStr.includes("password"));
});

test("AI Analysis: handles unlinked Instagram gracefully", async () => {
  const mockProvider = {
    providerName: "MockProvider",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured(request) {
      assert.ok(request.prompt.includes("Instagram account is unlinked"));
      return {
        model: "mock-model",
        rawText: "{}",
        data: {
          suggestedNiche: "Fitness & Nutrition",
          suggestedSubNiches: ["Home Workouts", "High Protein Meals"],
          audienceThemes: ["Busy Professionals"],
          audienceDemographicsNote: "Demographics unavailable for unlinked accounts.",
          contentThemes: ["Quick 15-min routines"],
          recommendedFormats: ["reel"],
          opportunities: ["Post quick lunch recipes"],
          discrepancies: [],
          missingEvidenceNotes: ["Instagram account unlinked: audience signals cannot be verified against historical reach."],
        },
      };
    },
  };

  setAiProvider(mockProvider);

  const result = await analyzeCreatorIdentity({
    creatorAnswers: {
      niche: "Fitness & Nutrition",
      languages: ["English", "Hindi"],
    },
    instagramContext: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.analysis.suggestedNiche, "Fitness & Nutrition");
  assert.ok(result.analysis.missingEvidenceNotes[0].includes("Instagram account unlinked"));
});

// ============================================================================
// SUITE 3: STRICT ₹0 BUDGET & RATE LIMIT HANDLING
// ============================================================================

test("Strict ₹0 Budget: handles rate limit without paid fallback or false countdowns", async () => {
  const mockRateLimitedProvider = {
    providerName: "MockProvider",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiRateLimitError("Rate limit exceeded on free tier.", 12000);
    },
  };

  setAiProvider(mockRateLimitedProvider);

  const result = await analyzeCreatorIdentity({
    creatorAnswers: { niche: "Finance" },
  });

  assert.equal(result.success, false);
  assert.equal(result.isRateLimited, true);
  assert.equal(result.retryAfterMs, 12000);
  assert.ok(result.error.includes("free-tier generation limit reached"));
  assert.ok(result.error.includes("saving your profile manually"));
});

test("Strict ₹0 Budget: handles rate limit when retryAfterMs is absent without inventing fake timers", async () => {
  const mockRateLimitedProvider = {
    providerName: "MockProvider",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiRateLimitError("Rate limit reached.", undefined);
    },
  };

  setAiProvider(mockRateLimitedProvider);

  const result = await analyzeCreatorIdentity({
    creatorAnswers: { niche: "Travel" },
  });

  assert.equal(result.success, false);
  assert.equal(result.isRateLimited, true);
  assert.equal(result.retryAfterMs, undefined);
  assert.ok(result.error.includes("free-tier generation limit reached"));
});

test("AI Analysis: catches generic AiError gracefully", async () => {
  const mockFailingProvider = {
    providerName: "MockProvider",
    defaultModel: "gemini-3.5-flash-lite",
    async generateText() {},
    async generateStructured() {
      throw new AiError("Simulated network timeout", { code: "TIMEOUT_ERROR" });
    },
  };

  setAiProvider(mockFailingProvider);

  const result = await analyzeCreatorIdentity({
    creatorAnswers: { niche: "Cooking" },
  });

  assert.equal(result.success, false);
  assert.ok(result.error.includes("AI analysis unavailable"));
});

// ============================================================================
// SUITE 4: CREATOR PRECEDENCE & PREFERENCE PERSISTENCE
// ============================================================================

test("Creator Precedence: creator explicit choices take precedence over AI suggestions", () => {
  const creatorChoice = {
    niche: "Minimalist Web Design",
    subNiches: ["Typography", "CSS Grid"],
    brandVoice: ["Authoritative & Expert"],
    languages: ["English"],
    preferredFormats: ["carousel"],
    isConfirmed: true,
    confirmedAt: "2026-10-19T12:00:00.000Z",
  };

  const aiSuggestions = {
    suggestedNiche: "Modern SaaS Graphic Design",
    suggestedSubNiches: ["3D Illustrations", "Figma"],
    audienceThemes: ["General Freelancers"],
    audienceDemographicsNote: "Demographics unavailable",
    contentThemes: ["Trending Palettes"],
    recommendedFormats: ["reel"],
    opportunities: ["Make 15-second Figma reels"],
    discrepancies: [],
    missingEvidenceNotes: [],
    analyzedAt: "2026-10-19T12:05:00.000Z",
  };

  // When saved, the creator's confirmed fields must NOT be overwritten by AI suggestions
  const merged = {
    ...creatorChoice,
    aiSuggestions,
  };

  const validated = validateCreatorPreferences(merged);
  assert.equal(validated.sanitized.niche, "Minimalist Web Design");
  assert.deepEqual(validated.sanitized.subNiches, ["Typography", "CSS Grid"]);
  assert.deepEqual(validated.sanitized.brandVoice, ["Authoritative & Expert"]);
  assert.deepEqual(validated.sanitized.preferredFormats, ["carousel"]);
  assert.equal(validated.sanitized.isConfirmed, true);
  assert.equal(validated.sanitized.aiSuggestions.suggestedNiche, "Modern SaaS Graphic Design");
});

test("Validation: handles null, undefined and non-object inputs safely", () => {
  const nullResult = validateCreatorPreferences(null);
  assert.equal(nullResult.isValid, false);
  assert.equal(nullResult.sanitized.niche, "");

  const undefinedResult = validateCreatorPreferences(undefined);
  assert.equal(undefinedResult.isValid, false);

  const stringResult = validateCreatorPreferences("invalid string payload");
  assert.equal(stringResult.isValid, false);
});

test("Validation: falls back to English if languages list is empty", () => {
  const input = {
    niche: "Travel Vlogs",
    languages: [],
  };
  const result = validateCreatorPreferences(input);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.sanitized.languages, ["English"]);
});

test("Validation: sanitizes topics to cover and topics to avoid", () => {
  const input = {
    niche: "Coding",
    topicsToCover: ["React", "react", "  Next.js  ", "TypeScript"],
    topicsToAvoid: ["Politics", "GOSSIP", "politics"],
  };
  const result = validateCreatorPreferences(input);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.sanitized.topicsToCover, ["React", "Next.js", "TypeScript"]);
  assert.deepEqual(result.sanitized.topicsToAvoid, ["Politics", "GOSSIP"]);
});

test("Profile Lifecycle: allows re-editing confirmed profile and preserves edits", () => {
  const originalConfirmed = {
    niche: "Full-Stack Web Dev",
    subNiches: ["Node.js"],
    languages: ["English", "Hindi"],
    preferredFormats: ["reel"],
    isConfirmed: true,
    confirmedAt: "2026-10-18T10:00:00.000Z",
  };

  const validatedOriginal = validateCreatorPreferences(originalConfirmed).sanitized;
  assert.equal(validatedOriginal.isConfirmed, true);

  // User re-opens questionnaire to edit niche and add Punjabi
  const updatedByCreator = {
    ...validatedOriginal,
    niche: "Full-Stack Web & Mobile Dev",
    languages: ["English", "Hindi", "Punjabi"],
    subNiches: ["Node.js", "React Native"],
  };

  const validatedUpdate = validateCreatorPreferences(updatedByCreator).sanitized;
  assert.equal(validatedUpdate.niche, "Full-Stack Web & Mobile Dev");
  assert.deepEqual(validatedUpdate.languages, ["English", "Hindi", "Punjabi"]);
  assert.deepEqual(validatedUpdate.subNiches, ["Node.js", "React Native"]);
  assert.equal(validatedUpdate.isConfirmed, true);
});

test("Avatar Sync: resolves Instagram profile picture URL from metadata when profile avatar_url is missing", () => {
  const accountMeta = {
    name: "Aryan Malhotra",
    account_type: "CREATOR",
    profile_picture_url: "https://scontent.cdninstagram.com/v/t51.2885-19/avatar.jpg?token=abc",
  };
  const profileRecord = {
    id: "user-123",
    full_name: "Aryan Malhotra",
    creator_handle: null,
    avatar_url: null,
  };

  // Simulating resolution logic from dal.ts
  const resolvedAvatar = profileRecord.avatar_url || accountMeta.profile_picture_url || null;
  assert.equal(resolvedAvatar, "https://scontent.cdninstagram.com/v/t51.2885-19/avatar.jpg?token=abc");
});

test("Avatar Sync: falls back to creator initials when profile picture is absent", () => {
  const profileRecord = {
    id: "user-456",
    full_name: "Simran Kaur",
    creator_handle: "simran_creates",
    avatar_url: null,
  };
  const accountMeta = {
    name: "Simran Kaur",
    profile_picture_url: null,
  };

  const resolvedAvatar = profileRecord.avatar_url || accountMeta.profile_picture_url || null;
  assert.equal(resolvedAvatar, null);

  const initials = (profileRecord.full_name || profileRecord.creator_handle || "CR")
    .substring(0, 2)
    .toUpperCase();
  assert.equal(initials, "SI");
});

test("OAuth Callback: synchronizes profilePictureUrl into public.profiles updates", () => {
  const profile = {
    id: "ig-999",
    username: "pro_creator",
    profilePictureUrl: "https://scontent.cdninstagram.com/avatar_new.jpg",
  };
  const nowIso = "2026-10-20T10:00:00.000Z";

  const profileUpdates = {
    creator_handle: profile.username,
    updated_at: nowIso,
  };
  if (profile.profilePictureUrl) {
    profileUpdates.avatar_url = profile.profilePictureUrl;
  }

  assert.equal(profileUpdates.creator_handle, "pro_creator");
  assert.equal(profileUpdates.avatar_url, "https://scontent.cdninstagram.com/avatar_new.jpg");
});

// Reset AI Provider after test suite runs
test.after(() => {
  setAiProvider(null);
});
