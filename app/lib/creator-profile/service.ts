import "server-only";

import { createClient } from "../supabase/server";
import { getAiProvider } from "../ai/index";
import {
  AiError,
  AiRateLimitError,
  type StructuredGenerationRequest,
} from "../ai/types";
import {
  createSanitizedPromptContext,
  sanitizePromptText,
} from "../ai/validation";
import type {
  CreatorPreferences,
  AiProfileAnalysis,
  DiscrepancyItem,
  DraftFormat,
  CreativeIntelligenceItem,
} from "../definitions";
import {
  validateCreatorPreferences,
  getDefaultCreatorPreferences,
} from "./validation";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export interface InstagramContextTelemetry {
  username?: string | null;
  followersCount?: number | null;
  mediaCount?: number | null;
  reach30d?: number | null;
  totalInteractions?: number | null;
  recentCaptions?: string[];
}

export interface AnalyzeIdentityOptions {
  creatorAnswers: Partial<CreatorPreferences>;
  instagramContext?: InstagramContextTelemetry | null;
}

export interface AnalyzeIdentityResult {
  success: boolean;
  analysis?: AiProfileAnalysis;
  error?: string;
  isRateLimited?: boolean;
  retryAfterMs?: number;
}

/**
 * Loads creator preferences for the authenticated user from public.profiles table.
 * Adheres strictly to Supabase RLS (auth.uid() = id).
 */
export async function getCreatorPreferences(userId: string): Promise<CreatorPreferences> {
  if (!userId) {
    return getDefaultCreatorPreferences();
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .single();

    if (error || !data || !data.preferences || Object.keys(data.preferences).length === 0) {
      return getDefaultCreatorPreferences();
    }

    const { sanitized } = validateCreatorPreferences(data.preferences);
    return sanitized;
  } catch {
    return getDefaultCreatorPreferences();
  }
}

/**
 * Persists creator preferences to public.profiles table.
 * Enforces per-user RLS and input sanitization.
 */
export async function saveCreatorPreferences(
  userId: string,
  preferences: unknown
): Promise<{ success: boolean; data?: CreatorPreferences; error?: string }> {
  if (!userId) {
    return { success: false, error: "Unauthorized: Missing authenticated user session." };
  }

  const { isValid, errors, sanitized } = validateCreatorPreferences(preferences);
  if (!isValid) {
    const firstError = Object.values(errors)[0] || "Invalid creator preferences input.";
    return { success: false, error: firstError };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        preferences: sanitized,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: sanitized };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database error while saving preferences.";
    return { success: false, error: msg };
  }
}

/**
 * Generates AI-assisted identity recommendations, comparing stated creator answers
 * against genuinely available Instagram telemetry.
 *
 * Enforces strict ₹0 budget: If free-tier quota is exhausted, fails gracefully
 * without paid fallbacks or automatic upgrades.
 */
export async function analyzeCreatorIdentity(
  options: AnalyzeIdentityOptions
): Promise<AnalyzeIdentityResult> {
  const { creatorAnswers, instagramContext } = options;

  // Data Minimization: strictly allowlist and sanitize creator answers
  const sanitizedAnswers = createSanitizedPromptContext(
    {
      niche: creatorAnswers.niche || "",
      subNiches: creatorAnswers.subNiches || [],
      targetAudience: creatorAnswers.targetAudience || "",
      contentGoals: creatorAnswers.contentGoals || [],
      preferredFormats: creatorAnswers.preferredFormats || [],
      brandVoice: creatorAnswers.brandVoice || [],
      languages: creatorAnswers.languages || [],
      topicsToCover: creatorAnswers.topicsToCover || [],
      topicsToAvoid: creatorAnswers.topicsToAvoid || [],
      otherNotes: creatorAnswers.otherNotes || "",
    },
    [
      "niche",
      "subNiches",
      "targetAudience",
      "contentGoals",
      "preferredFormats",
      "brandVoice",
      "languages",
      "topicsToCover",
      "topicsToAvoid",
      "otherNotes",
    ]
  );

  // Data Minimization: strictly allowlist and sanitize Instagram telemetry
  const isInstagramLinked = Boolean(instagramContext && (instagramContext.username || instagramContext.followersCount !== undefined));
  const sanitizedCaptions = Array.isArray(instagramContext?.recentCaptions)
    ? instagramContext.recentCaptions
        .filter((c) => typeof c === "string" && c.trim())
        .slice(0, 5)
        .map((c) => sanitizePromptText(c.trim().slice(0, 300)))
    : [];

  const sanitizedTelemetry = isInstagramLinked
    ? {
        connected: true,
        username: instagramContext?.username ? sanitizePromptText(instagramContext.username) : null,
        followersCount: typeof instagramContext?.followersCount === "number" ? instagramContext.followersCount : null,
        reach30d: typeof instagramContext?.reach30d === "number" ? instagramContext.reach30d : null,
        mediaCount: typeof instagramContext?.mediaCount === "number" ? instagramContext.mediaCount : null,
        recentCaptions: sanitizedCaptions,
      }
    : {
        connected: false,
        note: "Instagram account is unlinked. Inferences must be derived exclusively from stated answers.",
      };

  const systemInstruction = `You are a world-class Instagram Creator Strategist and Brand Identity Consultant.
Your task is to analyze a creator's self-reported preferences alongside genuinely available Instagram telemetry.

CRITICAL INTEGRITY RULES:
1. NEVER fabricate audience demographics (age distributions, gender percentages, city/country breakdown). The standard Instagram API does NOT provide demographic data. You MUST explicitly state that exact demographics are unavailable.
2. NEVER claim access to private algorithmic rankings, watch history, or retention drop-offs.
3. If Instagram is not connected or telemetry is sparse, acknowledge uncertainty and base recommendations purely on stated answers.
4. Compare the creator's stated preferences with observed signals (e.g. tone in stated brand voice vs. tone in recent captions) to detect meaningful discrepancies.
5. Provide actionable, high-conviction creative opportunities tailored to their languages, formats, and niche.
6. Support Indian regional language ecosystems (Hindi, Punjabi, Hinglish, Romanized Punjabi, English) where indicated.`;

  const promptContent = `Analyze the following creator profile data:

CREATOR-REPORTED ANSWERS:
${JSON.stringify(sanitizedAnswers, null, 2)}

GENUINELY AVAILABLE INSTAGRAM SIGNALS:
${JSON.stringify(sanitizedTelemetry, null, 2)}

Generate a structured brand identity evaluation adhering to the requested schema.`;

  const structuredRequest: StructuredGenerationRequest = {
    prompt: promptContent,
    systemInstruction,
    temperature: 0.2,
    maxTokens: 2048,
    schemaDescription: "Creator identity and niche discovery analysis",
    responseSchema: {
      type: "object",
      properties: {
        suggestedNiche: { type: "string" },
        suggestedSubNiches: {
          type: "array",
          items: { type: "string" },
        },
        audienceThemes: {
          type: "array",
          items: { type: "string" },
        },
        audienceDemographicsNote: { type: "string" },
        contentThemes: {
          type: "array",
          items: { type: "string" },
        },
        recommendedFormats: {
          type: "array",
          items: { type: "string", enum: ["reel", "carousel", "post", "story"] },
        },
        opportunities: {
          type: "array",
          items: { type: "string" },
        },
        discrepancies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              creatorAnswer: { type: "string" },
              aiObservation: { type: "string" },
              explanation: { type: "string" },
              severity: { type: "string", enum: ["info", "warning"] },
            },
            required: ["field", "creatorAnswer", "aiObservation", "explanation", "severity"],
          },
        },
        missingEvidenceNotes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "suggestedNiche",
        "suggestedSubNiches",
        "audienceThemes",
        "audienceDemographicsNote",
        "contentThemes",
        "recommendedFormats",
        "opportunities",
        "discrepancies",
        "missingEvidenceNotes",
      ],
    },
  };

  try {
    const provider = getAiProvider();
    const response = await provider.generateStructured<Record<string, unknown>>(structuredRequest);
    const data = response.data;

    // Validate and sanitize AI response structure
    const suggestedNiche = typeof data.suggestedNiche === "string" ? data.suggestedNiche : (creatorAnswers.niche || "Creator Generalist");
    const suggestedSubNiches = Array.isArray(data.suggestedSubNiches)
      ? (data.suggestedSubNiches as string[]).filter((s) => typeof s === "string").slice(0, 5)
      : [];
    const audienceThemes = Array.isArray(data.audienceThemes)
      ? (data.audienceThemes as string[]).filter((s) => typeof s === "string").slice(0, 6)
      : [];
    const audienceDemographicsNote = typeof data.audienceDemographicsNote === "string" && data.audienceDemographicsNote
      ? data.audienceDemographicsNote
      : "Exact audience demographics (age/gender/locations) are unavailable via standard Instagram Graph API scopes.";
    const contentThemes = Array.isArray(data.contentThemes)
      ? (data.contentThemes as string[]).filter((s) => typeof s === "string").slice(0, 8)
      : [];

    const validFormats: DraftFormat[] = ["reel", "carousel", "post", "story"];
    const recommendedFormats: DraftFormat[] = Array.isArray(data.recommendedFormats)
      ? (data.recommendedFormats as DraftFormat[]).filter((f) => validFormats.includes(f))
      : ["reel", "carousel"];

    const opportunities = Array.isArray(data.opportunities)
      ? (data.opportunities as string[]).filter((s) => typeof s === "string").slice(0, 6)
      : [];

    const discrepancies: DiscrepancyItem[] = Array.isArray(data.discrepancies)
      ? (data.discrepancies as Record<string, unknown>[])
          .filter((d) => d && typeof d === "object")
          .map((d) => ({
            field: String(d.field || "General Strategy"),
            creatorAnswer: String(d.creatorAnswer || ""),
            aiObservation: String(d.aiObservation || ""),
            explanation: String(d.explanation || ""),
            severity: d.severity === "warning" ? ("warning" as const) : ("info" as const),
          }))
      : [];

    const missingEvidenceNotes = Array.isArray(data.missingEvidenceNotes)
      ? (data.missingEvidenceNotes as string[]).filter((s) => typeof s === "string").slice(0, 5)
      : [
          isInstagramLinked
            ? "Recent post captions reflect historical tone; frame retention metrics are not accessible."
            : "Instagram account unlinked: audience signals cannot be verified against historical reach.",
        ];

    const analysis: AiProfileAnalysis = {
      suggestedNiche,
      suggestedSubNiches,
      audienceThemes,
      audienceDemographicsNote,
      contentThemes,
      recommendedFormats: recommendedFormats.length > 0 ? recommendedFormats : ["reel", "carousel"],
      opportunities,
      discrepancies,
      missingEvidenceNotes,
      analyzedAt: new Date().toISOString(),
    };

    return {
      success: true,
      analysis,
    };
  } catch (err) {
    if (err instanceof AiRateLimitError) {
      return {
        success: false,
        isRateLimited: true,
        retryAfterMs: err.retryAfterMs,
        error: "AI free-tier generation limit reached. Please try again later or continue by saving your profile manually.",
      };
    }

    if (err instanceof AiError) {
      return {
        success: false,
        error: `AI analysis unavailable: ${err.message}`,
      };
    }

    const message = err instanceof Error ? err.message : "Unknown error during AI identity analysis.";
    return {
      success: false,
      error: `AI analysis service error: ${message}`,
    };
  }
}

/**
 * Generates tailored, high-conviction creative recommendations derived from
 * confirmed creator preferences and genuine Instagram account telemetry.
 *
 * Provides deterministic, offline-resilient recommendations when Gemini quota is exhausted.
 */
export function generateHeuristicRecommendations(
  preferences?: Partial<CreatorPreferences>,
  context?: InstagramContextTelemetry | null
): CreativeIntelligenceItem[] {
  const niche = (preferences?.niche || "").toLowerCase();
  const formats = preferences?.preferredFormats || ["reel", "carousel"];
  const languages = preferences?.languages || ["English"];
  const creatorHandle = context?.username ? `@${context.username}` : "your profile";

  const isTech =
    niche.includes("tech") ||
    niche.includes("code") ||
    niche.includes("programming") ||
    niche.includes("developer") ||
    niche.includes("software");
  const isFitness =
    niche.includes("fit") ||
    niche.includes("health") ||
    niche.includes("gym") ||
    niche.includes("workout");
  const isDesign =
    niche.includes("design") ||
    niche.includes("art") ||
    niche.includes("photo") ||
    niche.includes("creative");
  const isBusiness =
    niche.includes("business") ||
    niche.includes("finance") ||
    niche.includes("market") ||
    niche.includes("money") ||
    niche.includes("sales");

  const prefersReels = formats.includes("reel");
  const prefersCarousels = formats.includes("carousel");

  const defaultFormatBadge = preferences?.niche ? `Niche: ${preferences.niche}` : "Format Strategy";
  const defaultTimingBadge = "Timing Strategy";
  const defaultRetentionBadge = context?.followersCount
    ? `${context.followersCount.toLocaleString()} Followers`
    : "Audience Retention";

  if (isTech) {
    return [
      {
        id: "rec-tech-1",
        category: "Format Optimization",
        title: prefersReels
          ? "Prioritize 18–24s Code Walkthrough Reels with Visual Bug Hooks"
          : "Deploy Quick-Fix Video Snippets Highlighting Common Syntax Pitfalls",
        summary: `In Tech & Programming, opening with an unresolved runtime error or bug in the first 2 seconds captures developer interest before they scroll${
          languages.includes("Hinglish") ? " when paired with conversational Hinglish narration" : ""
        }.`,
        impactScore: "High Impact",
        iconType: "video",
        suggestedAction: "Draft Script in AI Studio",
        targetTab: "ai-studio",
        factBadge: defaultFormatBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-tech-2",
        category: "Publishing Window",
        title: "Target Developer Transit & Evening Focus (7:15 PM – 8:30 PM)",
        summary: "Tech and software professionals exhibit peak active exploration during evening wind-down hours. Publishing technical breakdowns in this slot supports early discussion and saves.",
        impactScore: "Timing Signal",
        iconType: "clock",
        suggestedAction: "Schedule Slot in Planner",
        targetTab: "planner",
        factBadge: defaultTimingBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-tech-3",
        category: "Audience Retention",
        title: prefersCarousels
          ? "Deploy 6-Slide Architecture Carousels with Takeaway Syntax Cards"
          : "Publish Modular Concept Breakdowns with High-Save Code Snippets",
        summary: "Multi-slide educational carousels with standalone reference slides encourage viewers to bookmark posts for future debugging and revision.",
        impactScore: "Save Potential",
        iconType: "layers",
        suggestedAction: "Generate Carousel Outline",
        targetTab: "ai-studio",
        factBadge: defaultRetentionBadge,
        isAiHypothesis: true,
      },
    ];
  }

  if (isFitness) {
    return [
      {
        id: "rec-fit-1",
        category: "Format Optimization",
        title: "Lead with 3-Second Form Correction Hooks in Workout Reels",
        summary: "Opening with an exaggerated common posture or exercise mistake qualifies high-intent viewers immediately, encouraging complete view-throughs.",
        impactScore: "High Impact",
        iconType: "video",
        suggestedAction: "Draft Script in AI Studio",
        targetTab: "ai-studio",
        factBadge: defaultFormatBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-fit-2",
        category: "Publishing Window",
        title: "Target Pre-Workout Morning Intervals (6:30 AM – 7:45 AM)",
        summary: "Fitness audiences show highest initial save and share activity before work and early gym sessions, driving immediate morning distribution.",
        impactScore: "Timing Signal",
        iconType: "clock",
        suggestedAction: "Schedule Slot in Planner",
        targetTab: "planner",
        factBadge: defaultTimingBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-fit-3",
        category: "Audience Retention",
        title: "Deploy 5-Slide Weekly Macro & Meal Prep Carousels",
        summary: "Step-by-step grocery checklists and macro meal breakdowns provide practical reference value that drives saves and returning viewers.",
        impactScore: "Save Potential",
        iconType: "layers",
        suggestedAction: "Generate Carousel Outline",
        targetTab: "ai-studio",
        factBadge: defaultRetentionBadge,
        isAiHypothesis: true,
      },
    ];
  }

  if (isDesign) {
    return [
      {
        id: "rec-des-1",
        category: "Format Optimization",
        title: "Deploy Before/After Color Grading Transition Hooks in Reels",
        summary: "Visual split-screen transitions synced to audio tempos create visual contrast that sustains audience attention through the final reveal.",
        impactScore: "High Impact",
        iconType: "video",
        suggestedAction: "Draft Script in AI Studio",
        targetTab: "ai-studio",
        factBadge: defaultFormatBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-des-2",
        category: "Publishing Window",
        title: "Schedule for Weekend Creative Leisure (Saturday 11:30 AM – 1:00 PM)",
        summary: "Design and visual art audiences browse and bookmark highest during weekend relaxation windows, giving educational posts prolonged organic discovery.",
        impactScore: "Timing Signal",
        iconType: "clock",
        suggestedAction: "Schedule Slot in Planner",
        targetTab: "planner",
        factBadge: defaultTimingBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-des-3",
        category: "Audience Retention",
        title: "Deploy Process Breakdown Carousels with Actionable Palettes",
        summary: "Carousels with layer hierarchies, typography pairings, and hex palettes provide tangible utility that encourages direct bookmarks.",
        impactScore: "Save Potential",
        iconType: "layers",
        suggestedAction: "Generate Carousel Outline",
        targetTab: "ai-studio",
        factBadge: defaultRetentionBadge,
        isAiHypothesis: true,
      },
    ];
  }

  if (isBusiness) {
    return [
      {
        id: "rec-biz-1",
        category: "Format Optimization",
        title: "Open Case Study Reels with a Concrete Outcome or Metric",
        summary: "Leading with a verified milestone or strategic business outcome in opening seconds captures high-intent professional attention and prevents scroll-away.",
        impactScore: "High Impact",
        iconType: "video",
        suggestedAction: "Draft Script in AI Studio",
        targetTab: "ai-studio",
        factBadge: defaultFormatBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-biz-2",
        category: "Publishing Window",
        title: "Target Midday Desk Browse Slot (12:30 PM – 1:45 PM Tuesday/Thursday)",
        summary: "Professional and business audiences engage actively during lunch breaks, accelerating comments, saves, and profile visits.",
        impactScore: "Timing Signal",
        iconType: "clock",
        suggestedAction: "Schedule Slot in Planner",
        targetTab: "planner",
        factBadge: defaultTimingBadge,
        isAiHypothesis: true,
      },
      {
        id: "rec-biz-3",
        category: "Audience Retention",
        title: "Deploy 7-Slide Framework Carousels with Actionable Checklists",
        summary: "Framework carousels with clear diagnostic checklists offer practical utility that prompts viewers to bookmark and share with industry colleagues.",
        impactScore: "Save Potential",
        iconType: "layers",
        suggestedAction: "Generate Carousel Outline",
        targetTab: "ai-studio",
        factBadge: defaultRetentionBadge,
        isAiHypothesis: true,
      },
    ];
  }

  const statedNiche = preferences?.niche || "your creator niche";
  return [
    {
      id: "rec-gen-1",
      category: "Format Optimization",
      title: prefersReels
        ? `Prioritize 18–24s Reels with Problem-Statement Hooks in ${statedNiche}`
        : `Deliver Concise Value-Driven Visuals for ${statedNiche}`,
      summary: `Short-form video under 25 seconds captures attention when paired with an upfront problem-statement hook in the first 2 seconds${
        languages.length > 1 ? ` in ${languages.join(" & ")}` : ""
      }.`,
      impactScore: "High Impact",
      iconType: "video",
      suggestedAction: "Draft Script in AI Studio",
      targetTab: "ai-studio",
      factBadge: defaultFormatBadge,
      isAiHypothesis: true,
    },
    {
      id: "rec-gen-2",
      category: "Publishing Window",
      title: "Optimize Evening Audience Convergence (6:45 PM – 7:45 PM)",
      summary: "Audience engagement peaks during evening transit and leisure windows. Moving releases closer to this slot lifts early viewer velocity.",
      impactScore: "Timing Signal",
      iconType: "clock",
      suggestedAction: "Schedule Slot in Planner",
      targetTab: "planner",
      factBadge: defaultTimingBadge,
      isAiHypothesis: true,
    },
    {
      id: "rec-gen-3",
      category: "Audience Retention",
      title: prefersCarousels
        ? `Deploy 5-Slide Educational Carousels with Takeaway Cover in ${statedNiche}`
        : "Generate Multi-Step Carousels with Actionable Save Prompts",
      summary: `Carousels featuring concise takeaways and structured covers encourage community members across ${creatorHandle} to save for future reference.`,
      impactScore: "Save Potential",
      iconType: "layers",
      suggestedAction: "Generate Carousel Outline",
      targetTab: "ai-studio",
      factBadge: defaultRetentionBadge,
      isAiHypothesis: true,
    },
  ];
}

export interface GetCreativeIntelligenceOptions {
  creatorAnswers?: Partial<CreatorPreferences>;
  instagramContext?: InstagramContextTelemetry | null;
}

export interface GetCreativeIntelligenceResult {
  success: boolean;
  recommendations: CreativeIntelligenceItem[];
  model: string;
  isAiGenerated: boolean;
  error?: string;
}

/**
 * Gathers creative intelligence using Gemini 3.5 Flash Lite if available and within free limits,
 * falling back seamlessly to deterministic niche-tailored heuristics under strict ₹0 budget rules.
 */
export async function getCreativeIntelligence(
  options: GetCreativeIntelligenceOptions
): Promise<GetCreativeIntelligenceResult> {
  const { creatorAnswers, instagramContext } = options;

  // Try calling Gemini if API key is configured
  if (process.env.GEMINI_API_KEY) {
    try {
      const aiProvider = getAiProvider();
      const sanitizedNiche = sanitizePromptText(creatorAnswers?.niche || "General Content Creation");
      const sanitizedSubNiches = (creatorAnswers?.subNiches || []).slice(0, 3).map(sanitizePromptText);
      const sanitizedFormats = (creatorAnswers?.preferredFormats || ["reel", "carousel"]).map(sanitizePromptText);
      const sanitizedLanguages = (creatorAnswers?.languages || ["English"]).slice(0, 3).map(sanitizePromptText);
      const sanitizedVoice = (creatorAnswers?.brandVoice || ["Authentic"]).slice(0, 3).map(sanitizePromptText);
      const sanitizedHandle = instagramContext?.username ? sanitizePromptText(instagramContext.username) : "creator";

      const prompt = `Analyze this creator profile and generate exactly 3 creative intelligence recommendations:
- Niche: ${sanitizedNiche}
- Sub-niches: ${sanitizedSubNiches.join(", ") || "General"}
- Preferred Formats: ${sanitizedFormats.join(", ")}
- Languages: ${sanitizedLanguages.join(", ")}
- Brand Voice: ${sanitizedVoice.join(", ")}
- Instagram Account: @${sanitizedHandle}
- Verified Followers: ${instagramContext?.followersCount ?? "N/A"}
- 28-Day Reach: ${instagramContext?.reach30d ?? "N/A"}
- Total Recent Interactions: ${instagramContext?.totalInteractions ?? "N/A"}

Provide exactly 3 items adhering to the schema:
1. Category: "Format Optimization" | "Publishing Window" | "Audience Retention"
2. Title: A sharp, niche-specific actionable headline
3. Summary: 1-2 sentence evidence-backed justification without fabricated statistics
4. ImpactScore: A qualitative priority label, e.g. "High Impact", "Timing Signal", or "Save Potential" (never invent unsupported percentage matches)
5. IconType: "video" | "clock" | "layers" | "trending" | "sparkles"
6. SuggestedAction: e.g. "Draft Script in AI Studio" or "Schedule Slot in Planner"
7. TargetTab: "ai-studio" | "planner"
8. FactBadge: Short label attributing the recommendation to confirmed preferences or verified account telemetry
9. IsAiHypothesis: Boolean set to true since recommendations are forward-looking hypotheses`;

      const request: StructuredGenerationRequest = {
        prompt,
        systemInstruction:
          "You are an expert Instagram Creator Strategist. Generate 3 actionable creative recommendations tailored to the creator's exact niche and verified metrics. CRITICAL: Clearly distinguish between verified account facts and AI hypotheses. Do NOT invent or cite fake market statistics, percentages, or fabricated benchmarks (e.g. do NOT say 'retains 64% more' or '3.4x saves'). Instead, provide qualitative, evidence-backed creative reasoning. Strictly output valid JSON matching the schema.",
        responseSchema: {
          type: "OBJECT",
          properties: {
            recommendations: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  category: { type: "STRING" },
                  title: { type: "STRING" },
                  summary: { type: "STRING" },
                  impactScore: { type: "STRING" },
                  iconType: { type: "STRING" },
                  suggestedAction: { type: "STRING" },
                  targetTab: { type: "STRING" },
                  factBadge: { type: "STRING" },
                  isAiHypothesis: { type: "BOOLEAN" },
                },
                required: ["id", "category", "title", "summary", "impactScore", "suggestedAction"],
              },
            },
          },
          required: ["recommendations"],
        },
        maxTokens: 600,
        temperature: 0.2,
      };

      const result = await aiProvider.generateStructured<{
        recommendations: Array<Record<string, unknown>>;
      }>(request);

      const rawRecs = result?.data?.recommendations;
      if (Array.isArray(rawRecs) && rawRecs.length >= 3) {
        const validIconTypes: Array<CreativeIntelligenceItem["iconType"]> = [
          "video",
          "clock",
          "layers",
          "trending",
          "sparkles",
        ];

        const mapped: CreativeIntelligenceItem[] = rawRecs.slice(0, 3).map((r: Record<string, unknown>, i: number) => {
          const rawIcon = String(r.iconType || "").toLowerCase();
          const iconType = validIconTypes.includes(rawIcon as CreativeIntelligenceItem["iconType"])
            ? (rawIcon as CreativeIntelligenceItem["iconType"])
            : i === 0
            ? "video"
            : i === 1
            ? "clock"
            : "layers";

          const rawTab = String(r.targetTab || "").toLowerCase();
          const targetTab = rawTab === "planner" ? "planner" : "ai-studio";

          return {
            id: String(r.id || `rec-ai-${i + 1}`),
            category: String(r.category || (i === 0 ? "Format Optimization" : i === 1 ? "Publishing Window" : "Audience Retention")),
            title: String(r.title || "Tailored Strategic Recommendation"),
            summary: String(r.summary || "Data-informed creative recommendation based on verified audience engagement signals."),
            impactScore: String(r.impactScore || "High Impact").replace(/\s*\(\d+%\s*match\)/i, ""),
            iconType,
            suggestedAction: String(r.suggestedAction || (targetTab === "planner" ? "Schedule Slot in Planner" : "Draft Script in AI Studio")),
            targetTab,
            factBadge: typeof r.factBadge === "string" && r.factBadge.trim().length > 0
              ? r.factBadge.trim()
              : (instagramContext?.followersCount ? `${instagramContext.followersCount.toLocaleString()} Followers` : "Account Telemetry"),
            isAiHypothesis: typeof r.isAiHypothesis === "boolean" ? r.isAiHypothesis : true,
          };
        });

        return {
          success: true,
          recommendations: mapped,
          model: "gemini-3.5-flash-lite",
          isAiGenerated: true,
        };
      }
    } catch {
      // In accordance with ₹0 budget, fail gracefully to heuristic recommendations
    }
  }

  // Graceful heuristic fallback derived from verified creator preferences
  const fallback = generateHeuristicRecommendations(creatorAnswers, instagramContext);
  return {
    success: true,
    recommendations: fallback,
    model: "gemini-3.5-flash-lite",
    isAiGenerated: false,
  };
}
