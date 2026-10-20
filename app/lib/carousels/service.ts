import "server-only";

import { getAiProvider, DEFAULT_GEMINI_MODEL } from "../ai/index";
import {
  AiError,
  AiRateLimitError,
  AiAuthenticationError,
  AiInvalidInputError,
  type StructuredGenerationRequest,
} from "../ai/types";
import {
  assertNoSensitivePatterns,
  sanitizePromptText,
} from "../ai/validation";
import { getCreatorPreferences } from "../creator-profile/service";
import {
  buildLanguageScriptPromptDirectives,
  checkScriptConsistency,
  normalizeLanguagePreset,
} from "../localization/standards";
import type {
  CreatorPreferences,
  CarouselSlideItem,
  GeneratedCarouselResult,
  GenerateCarouselInput,
  GenerateCarouselActionResult,
} from "../definitions";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const MIN_CAROUSEL_TOPIC_LENGTH = 3;
export const MAX_CAROUSEL_TOPIC_LENGTH = 500;
export const ALLOWED_SLIDE_COUNTS = [5, 7, 10] as const;
export const DEFAULT_SLIDE_COUNT = 7;
export const MAX_CAROUSEL_PILLAR_LENGTH = 100;
export const MAX_CAROUSEL_TONE_LENGTH = 100;
export const MAX_CAROUSEL_GOAL_LENGTH = 100;
export const MAX_CAROUSEL_LANG_LENGTH = 50;

export interface ValidatedCarouselInput {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: {
    topic: string;
    slideCount: 5 | 7 | 10;
    pillar?: string;
    tone?: string;
    goal?: string;
    language?: string;
  };
}

/**
 * Validates user-supplied parameters for Carousel Studio generation.
 * Enforces topic presence and length, allowed slide counts (5, 7, 10), and screens sensitive credentials.
 */
export function validateCarouselInput(input: unknown): ValidatedCarouselInput {
  const errors: Record<string, string> = {};
  const sanitized: ValidatedCarouselInput["sanitized"] = {
    topic: "",
    slideCount: DEFAULT_SLIDE_COUNT,
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors._root = "Carousel generation parameters must be a non-null object.";
    return { isValid: false, errors, sanitized };
  }

  const raw = input as Record<string, unknown>;

  // Topic validation
  if (typeof raw.topic !== "string" || !raw.topic.trim()) {
    errors.topic = "Topic or brief is required for carousel generation.";
  } else {
    const trimmed = raw.topic.trim();
    if (trimmed.length < MIN_CAROUSEL_TOPIC_LENGTH) {
      errors.topic = `Topic must be at least ${MIN_CAROUSEL_TOPIC_LENGTH} characters.`;
    } else if (trimmed.length > MAX_CAROUSEL_TOPIC_LENGTH) {
      errors.topic = `Topic cannot exceed ${MAX_CAROUSEL_TOPIC_LENGTH} characters.`;
    } else {
      try {
        assertNoSensitivePatterns(trimmed, "topic");
        sanitized.topic = trimmed;
      } catch (err) {
        errors.topic = err instanceof Error ? err.message : "Topic contained sensitive credentials.";
      }
    }
  }

  // Slide count validation (5, 7, or 10)
  if (raw.slideCount !== undefined && raw.slideCount !== null && raw.slideCount !== "") {
    const countNum = Number(raw.slideCount);
    if (countNum === 5 || countNum === 7 || countNum === 10) {
      sanitized.slideCount = countNum;
    } else {
      errors.slideCount = "Slide count must be 5, 7, or 10 slides.";
    }
  }

  // Pillar validation
  if (raw.pillar !== undefined && raw.pillar !== null && raw.pillar !== "") {
    if (typeof raw.pillar !== "string") {
      errors.pillar = "Pillar must be a string.";
    } else {
      const trimmed = raw.pillar.trim();
      if (trimmed.length > MAX_CAROUSEL_PILLAR_LENGTH) {
        errors.pillar = `Pillar cannot exceed ${MAX_CAROUSEL_PILLAR_LENGTH} characters.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, "pillar");
          sanitized.pillar = trimmed;
        } catch (err) {
          errors.pillar = err instanceof Error ? err.message : "Pillar contained sensitive credentials.";
        }
      }
    }
  }

  // Tone validation
  if (raw.tone !== undefined && raw.tone !== null && raw.tone !== "") {
    if (typeof raw.tone !== "string") {
      errors.tone = "Tone must be a string.";
    } else {
      const trimmed = raw.tone.trim();
      if (trimmed.length > MAX_CAROUSEL_TONE_LENGTH) {
        errors.tone = `Tone cannot exceed ${MAX_CAROUSEL_TONE_LENGTH} characters.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, "tone");
          sanitized.tone = trimmed;
        } catch (err) {
          errors.tone = err instanceof Error ? err.message : "Tone contained sensitive credentials.";
        }
      }
    }
  }

  // Goal validation (supports both goal and targetGoal)
  const isTargetGoal = raw.targetGoal !== undefined;
  const rawGoal = raw.goal !== undefined ? raw.goal : raw.targetGoal;
  const goalKey = isTargetGoal ? "targetGoal" : "goal";
  if (rawGoal !== undefined && rawGoal !== null && rawGoal !== "") {
    if (typeof rawGoal !== "string") {
      errors[goalKey] = "Goal must be a string.";
    } else {
      const trimmed = rawGoal.trim();
      if (trimmed.length > MAX_CAROUSEL_GOAL_LENGTH) {
        errors[goalKey] = `Goal cannot exceed ${MAX_CAROUSEL_GOAL_LENGTH} characters.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, goalKey);
          sanitized.goal = trimmed;
        } catch (err) {
          errors[goalKey] = err instanceof Error ? err.message : "Goal contained sensitive credentials.";
        }
      }
    }
  }

  // Language validation
  if (raw.language !== undefined && raw.language !== null && raw.language !== "") {
    if (typeof raw.language !== "string") {
      errors.language = "Language must be a string.";
    } else {
      const trimmed = raw.language.trim();
      if (trimmed.length > MAX_CAROUSEL_LANG_LENGTH) {
        errors.language = `Language cannot exceed ${MAX_CAROUSEL_LANG_LENGTH} characters.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, "language");
          sanitized.language = trimmed;
        } catch (err) {
          errors.language = err instanceof Error ? err.message : "Language contained sensitive credentials.";
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}

/**
 * Builds the authoritative system instruction for Carousel Studio generation.
 * Injects confirmed creator facts, target audience, brand voice, and strictly enforces forbidden boundaries.
 */
function buildCarouselSystemInstruction(
  preferences: CreatorPreferences | null,
  slideCount: 5 | 7 | 10,
  toneChoice?: string,
  goalChoice?: string,
  languageChoice?: string
): { instruction: string; effectiveLanguage: string; effectiveTone: string } {
  const isConfirmed = Boolean(preferences?.isConfirmed);
  const niche = preferences?.niche || "General Content Creation";
  const subNiches = preferences?.subNiches?.join(", ") || "General";
  const audience = preferences?.targetAudience || "General Instagram Audience";
  const goals = goalChoice || preferences?.contentGoals?.join(", ") || "Education, Saves & Engagement";
  const effectiveTone = toneChoice || preferences?.brandVoice?.join(", ") || "Conversational, Insightful & Actionable";
  const avoid = preferences?.topicsToAvoid?.join(", ") || "";
  const effectiveLanguage = normalizeLanguagePreset(languageChoice || preferences?.languages?.[0] || "English");

  const instruction = `You are an elite Instagram Carousel Strategist and Visual Slide Designer.
Your objective is to generate an educational, high-retention, production-ready ${slideCount}-slide Instagram carousel deck.

${
  isConfirmed
    ? `CONFIRMED CREATOR PROFILE:
- Primary Niche: ${niche}
- Content Pillars / Sub-Niches: ${subNiches}
- Target Audience: ${audience}
- Strategic Goals: ${goals}
- Brand Voice & Tone: ${effectiveTone}
- Preferred Language: ${effectiveLanguage}
- FORBIDDEN TOPICS (STRICT BOUNDARY): ${avoid ? avoid : "None declared"}`
    : `CREATOR PROFILE STATUS:
- Unconfirmed profile. Base concepts strictly on general Instagram best practices and any prompt parameters provided.
- Brand Voice & Tone: ${effectiveTone}
- Preferred Language: ${effectiveLanguage}
- FORBIDDEN TOPICS (STRICT BOUNDARY): ${avoid ? avoid : "None declared"}`
}

${buildLanguageScriptPromptDirectives(effectiveLanguage)}
- Desired Slide Deck Tone: ${effectiveTone}

CRITICAL CAROUSEL GENERATION RULES:
1. OUTPUT EXACTLY ${slideCount} SLIDES: You MUST generate exactly ${slideCount} sequential slides numbered 1 to ${slideCount}.
2. SLIDE STRUCTURE & ROLES:
   - Slide 1 (COVER HOOK): slideType MUST be "cover". Features an irresistible, high-contrast headline hook designed to stop feed scrollers, accompanied by a clean subtitle and visual suggestion.
   - Slides 2 to ${slideCount - 1} (VALUE & STORY BEATS): slideType MUST be "value". Sequential, high-value breakdown points, common pitfalls, step-by-step framework, or case study beats. Keep text punchy and readable on mobile cards (20-50 words per slide).
   - Slide ${slideCount} (OUTRO / CTA): slideType MUST be "cta". Clear, high-retention call to action prompting saves, shares, and follows.
3. VISUAL SUGGESTIONS: For every single slide, provide a practical visual layout suggestion (e.g. "Bold centered headline with dark card background", "Split 2-column contrast card with red/green indicators", "Numbered step with circular badge").
4. COMPANION FEED CAPTION: Provide a distinct, companion caption (100-250 words total) to accompany the carousel on the Instagram feed, complementing the slides rather than merely repeating them verbatim.
5. DISCOVERY HASHTAGS: Provide 5 to 10 relevant hashtags prefixed with #.
6. REGIONAL LANGUAGE COMPLIANCE: Support Indian regional language ecosystems (English, Hindi, Punjabi, Hinglish, Romanized Punjabi) accurately and idiomatically when requested.
7. ZERO FALSE PROMISES: NEVER promise viral reach, algorithm hacks, or follower count guarantees.
8. FORBIDDEN TOPICS (STRICT BOUNDARY): Strictly respect creator boundaries. If a topic is listed in FORBIDDEN TOPICS, NEVER generate ideas touching or referencing it.`;

  return { instruction, effectiveLanguage, effectiveTone };
}

/**
 * Robustly extracts the carousel payload and slides array from the parsed AI output.
 */
function extractCarouselData(data: unknown): {
  title?: string;
  slides?: unknown[];
  companionCaption?: string;
  hashtags?: unknown[];
} {
  if (!data) {
    return {};
  }

  if (Array.isArray(data)) {
    return {
      slides: data,
    };
  }

  if (typeof data !== "object") {
    return {};
  }

  const obj = data as Record<string, unknown>;

  // Check standard wrapper
  if (obj.carousel && typeof obj.carousel === "object") {
    return extractCarouselData(obj.carousel);
  }

  let slides: unknown[] = [];
  if (Array.isArray(obj.slides)) {
    slides = obj.slides;
  } else if (Array.isArray(obj.cards)) {
    slides = obj.cards;
  } else if (Array.isArray(obj.deck)) {
    slides = obj.deck;
  } else if (Array.isArray(obj.pages)) {
    slides = obj.pages;
  } else {
    // Check if any property is an array of objects
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
        slides = val;
        break;
      }
    }
  }

  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim()
      : typeof obj.headline === "string" && obj.headline.trim()
      ? obj.headline.trim()
      : undefined;

  const companionCaption =
    typeof obj.companionCaption === "string" && obj.companionCaption.trim()
      ? obj.companionCaption.trim()
      : typeof obj.caption === "string" && obj.caption.trim()
      ? obj.caption.trim()
      : typeof obj.feedCaption === "string" && obj.feedCaption.trim()
      ? obj.feedCaption.trim()
      : undefined;

  const hashtags = Array.isArray(obj.hashtags)
    ? obj.hashtags
    : Array.isArray(obj.tags)
    ? obj.tags
    : undefined;

  return { title, slides, companionCaption, hashtags };
}

/**
 * Generates an interactive, structured 5, 7, or 10-slide Instagram carousel deck with companion caption.
 * Powered by Gemini structured output, strictly adhering to the ₹0 budget and server session auth.
 */
export async function generateCarouselDeck(
  userId: string,
  input: GenerateCarouselInput
): Promise<GenerateCarouselActionResult> {
  const validation = validateCarouselInput(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0] || "Invalid carousel generation request.";
    return {
      success: false,
      error: firstError,
      fieldErrors: validation.errors,
    };
  }

  // Retrieve creator profile preferences
  let preferences: CreatorPreferences | null = null;
  try {
    preferences = await getCreatorPreferences(userId);
  } catch {
    preferences = null;
  }

  const { topic, slideCount, pillar, tone, goal, language } = validation.sanitized;
  const { instruction: systemInstruction, effectiveLanguage, effectiveTone } =
    buildCarouselSystemInstruction(
      preferences,
      slideCount,
      tone,
      goal,
      language
    );

  let userPrompt = `Generate a high-retention ${slideCount}-slide Instagram carousel deck on: "${sanitizePromptText(
    topic
  )}"`;

  const briefElements: string[] = [];
  if (pillar) briefElements.push(`Content Pillar: "${sanitizePromptText(pillar)}"`);
  briefElements.push(`Desired Tone: "${sanitizePromptText(effectiveTone)}"`);
  if (goal) briefElements.push(`Primary Goal: "${sanitizePromptText(goal)}"`);
  briefElements.push(`Language / Script: ${effectiveLanguage}`);

  userPrompt += `\n\nSpecific Directives:\n${briefElements.join("\n")}\n\n${buildLanguageScriptPromptDirectives(effectiveLanguage)}`;

  userPrompt += `\n\nREQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "title": "Short working title for the carousel deck (under 100 characters)",
  "slides": [
    {
      "slideNumber": 1,
      "slideType": "cover",
      "headline": "Irresistible scroll-stopping hook headline",
      "bodyText": "Subtitle or context hook teaser",
      "visualSuggestion": "Visual layout description (e.g. Minimalist dark background with bold yellow accent text)"
    },
    ... (slides 2 to ${slideCount - 1} with slideType: "value") ...,
    {
      "slideNumber": ${slideCount},
      "slideType": "cta",
      "headline": "Actionable closing hook or summary",
      "bodyText": "Clear call to action asking viewers to save, share, or comment",
      "visualSuggestion": "Clean outro card with handle branding"
    }
  ],
  "companionCaption": "Engaging 100-250 word companion feed caption with paragraph line breaks",
  "hashtags": ["#example1", "#example2", "#example3"]
}
Ensure exactly ${slideCount} slides are included in the "slides" array.`;

  const structuredRequest: StructuredGenerationRequest = {
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.7,
    maxTokens: 2500,
    schemaDescription: `${slideCount}-slide Instagram carousel deck with companion caption`,
    responseSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Working title for the carousel",
        },
        slides: {
          type: "array",
          description: `Array of exactly ${slideCount} sequential slides`,
          items: {
            type: "object",
            properties: {
              slideNumber: { type: "integer" },
              slideType: { type: "string", enum: ["cover", "value", "cta"] },
              headline: { type: "string" },
              bodyText: { type: "string" },
              visualSuggestion: { type: "string" },
            },
            required: ["slideNumber", "slideType", "headline", "bodyText", "visualSuggestion"],
          },
        },
        companionCaption: { type: "string" },
        hashtags: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["title", "slides", "companionCaption", "hashtags"],
    },
  };

  try {
    const aiProvider = getAiProvider();
    const result = await aiProvider.generateStructured<unknown>(structuredRequest);
    const parsedData = extractCarouselData(result.data);

    const rawSlides = Array.isArray(parsedData.slides) ? parsedData.slides : [];
    if (rawSlides.length === 0) {
      return {
        success: false,
        error:
          "The AI generator was unable to produce carousel slides for this request. Please try with different parameters.",
      };
    }

    // Server-side validation and formatting of each slide
    const validatedSlides: CarouselSlideItem[] = [];
    for (let i = 0; i < rawSlides.length; i++) {
      const item = rawSlides[i];
      if (!item || typeof item !== "object") continue;

      const raw = item as Record<string, unknown>;
      const slideNum = i + 1;
      const targetType: "cover" | "value" | "cta" =
        slideNum === 1 ? "cover" : slideNum === slideCount ? "cta" : "value";

      const headline =
        typeof raw.headline === "string" && raw.headline.trim()
          ? raw.headline.trim()
          : typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : `Point ${slideNum}`;

      const bodyText =
        typeof raw.bodyText === "string" && raw.bodyText.trim()
          ? raw.bodyText.trim()
          : typeof raw.content === "string" && raw.content.trim()
          ? raw.content.trim()
          : typeof raw.body === "string" && raw.body.trim()
          ? raw.body.trim()
          : headline;

      const visualSuggestion =
        typeof raw.visualSuggestion === "string" && raw.visualSuggestion.trim()
          ? raw.visualSuggestion.trim()
          : typeof raw.visual === "string" && raw.visual.trim()
          ? raw.visual.trim()
          : typeof raw.layout === "string" && raw.layout.trim()
          ? raw.layout.trim()
          : "Clean high-contrast card with generous spacing.";

      validatedSlides.push({
        slideNumber: slideNum,
        slideType: targetType,
        type: targetType,
        headline: headline.slice(0, 200),
        bodyText: bodyText.slice(0, 600),
        visualSuggestion: visualSuggestion.slice(0, 300),
      });

      if (validatedSlides.length === slideCount) break;
    }

    // Pad if AI returned fewer slides than requested
    while (validatedSlides.length < slideCount) {
      const missingIndex = validatedSlides.length + 1;
      const targetType = missingIndex === slideCount ? "cta" : "value";
      validatedSlides.push({
        slideNumber: missingIndex,
        slideType: targetType,
        type: targetType,
        headline:
          targetType === "cta"
            ? "Save This Post for Later"
            : `Key Takeaway #${missingIndex - 1}`,
        bodyText:
          targetType === "cta"
            ? "Tap the bookmark icon to save this guide for your next project."
            : "Focus on clean implementation and consistent routines.",
        visualSuggestion: "Minimalist card layout with high-contrast text.",
      });
    }

    // Format hashtags
    const rawHashtags = Array.isArray(parsedData.hashtags)
      ? (parsedData.hashtags as unknown[])
          .map((h) => String(h || "").trim())
          .filter(Boolean)
          .map((h) => (h.startsWith("#") ? h : `#${h}`))
      : [
          "#instagramgrowth",
          "#contentcreator",
          "#carousels",
          "#creators",
          "#socialmediatips",
        ];

    const companionCaption =
      parsedData.companionCaption ||
      `Swipe through for the complete breakdown on ${topic}.\n\nWhich slide resonated most with you? Let me know in the comments below!`;

    const title =
      parsedData.title ||
      validatedSlides[0]?.headline ||
      `${topic.slice(0, 60)} (${slideCount} Slides)`;

    // Non-blocking script consistency check across slides and caption
    const combinedCarouselText = `${validatedSlides.map((s) => `${s.headline} ${s.bodyText}`).join(" ")} ${companionCaption}`;
    const scriptCheck = checkScriptConsistency(combinedCarouselText, effectiveLanguage);
    const scriptWarning = !scriptCheck.isConsistent ? scriptCheck.warning : undefined;

    return {
      success: true,
      carousel: {
        title: title.slice(0, 150),
        slides: validatedSlides,
        companionCaption: companionCaption.slice(0, 1500),
        caption: companionCaption.slice(0, 1500),
        hashtags: rawHashtags.slice(0, 12),
        slideCount,
        model: result.model || DEFAULT_GEMINI_MODEL,
        pillar,
        language: effectiveLanguage,
        tone: effectiveTone,
        scriptWarning,
      },
      model: result.model || DEFAULT_GEMINI_MODEL,
      scriptWarning,
    };
  } catch (err: unknown) {
    if (err instanceof AiRateLimitError) {
      return {
        success: false,
        isRateLimited: true,
        retryAfterMs: err.retryAfterMs,
        error:
          "Carousel generation is temporarily paused because the Google Gemini rate limit or quota has been reached. Please wait a few moments before trying again.",
        quotaDetails:
          "The quota reset interval is governed by Google AI Studio. You can check usage on the Google AI Studio rate limit dashboard and retry shortly.",
      };
    }

    if (err instanceof AiAuthenticationError) {
      return {
        success: false,
        error:
          "AI service configuration error: Unable to authenticate with Google Gemini. Please verify your GEMINI_API_KEY in the server environment.",
      };
    }

    if (err instanceof AiInvalidInputError) {
      return {
        success: false,
        error: err.message || "Input rejected by AI safety or validation rules.",
      };
    }

    if (err instanceof AiError) {
      return {
        success: false,
        error: err.message || "An error occurred while generating carousel slides. Please try again.",
      };
    }

    const rawMessage = err instanceof Error ? err.message : "Unexpected error during carousel generation.";
    return {
      success: false,
      error: rawMessage,
    };
  }
}
