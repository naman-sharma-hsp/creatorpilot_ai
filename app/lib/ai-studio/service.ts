import "server-only";

import { getAiProvider } from "../ai/index";
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
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
} from "../localization/standards";
import type {
  GenerateCaptionInput,
  GeneratedCaptionResult,
  GenerateCaptionActionResult,
} from "../definitions";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const SUPPORTED_CAPTION_FORMATS = ["post", "reel"] as const;

export const STANDARD_LANGUAGES = [
  ...CANONICAL_LANGUAGE_PRESETS.map((p) => p.id),
  "Gujarati",
  "Bengali",
  "Tamil",
  "Telugu",
  "Marathi",
  "Kannada",
  "Malayalam",
  "Spanish",
  "French",
  "German",
] as const;

export const STANDARD_TONES = CANONICAL_TONE_OPTIONS;

export const MIN_TOPIC_LENGTH = 3;
export const MAX_TOPIC_LENGTH = 1000;
export const MAX_CTA_LENGTH = 150;

/**
 * Validates the user input for caption generation.
 */
export function validateCaptionGenerationInput(
  input: unknown
): {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: {
    format: "post" | "reel";
    topic: string;
    callToAction?: string;
    language?: string;
    tone?: string;
  };
} {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      isValid: false,
      errors: { _root: "Input payload must be a non-null object." },
      sanitized: { format: "post", topic: "" },
    };
  }

  const raw = input as Record<string, unknown>;

  // Format validation
  const format = String(raw.format || "").toLowerCase();
  if (format !== "post" && format !== "reel") {
    errors.format = "Format must be either 'post' or 'reel'.";
  }

  // Topic validation
  if (typeof raw.topic !== "string" || !raw.topic.trim()) {
    errors.topic = "Topic or brief is required.";
  } else if (raw.topic.trim().length < MIN_TOPIC_LENGTH) {
    errors.topic = `Topic must be at least ${MIN_TOPIC_LENGTH} characters.`;
  } else if (raw.topic.trim().length > MAX_TOPIC_LENGTH) {
    errors.topic = `Topic cannot exceed ${MAX_TOPIC_LENGTH} characters.`;
  }

  // Call to action validation
  let cleanCta: string | undefined;
  if (raw.callToAction !== undefined && raw.callToAction !== null && raw.callToAction !== "") {
    if (typeof raw.callToAction !== "string") {
      errors.callToAction = "Call to action must be a string.";
    } else if (raw.callToAction.trim().length > MAX_CTA_LENGTH) {
      errors.callToAction = `Call to action cannot exceed ${MAX_CTA_LENGTH} characters.`;
    } else {
      cleanCta = raw.callToAction.trim();
    }
  }

  // Language validation
  let cleanLanguage: string | undefined;
  if (raw.language !== undefined && raw.language !== null && raw.language !== "") {
    if (typeof raw.language !== "string") {
      errors.language = "Language must be a string.";
    } else {
      cleanLanguage = raw.language.trim().slice(0, 50);
    }
  }

  // Tone validation
  let cleanTone: string | undefined;
  if (raw.tone !== undefined && raw.tone !== null && raw.tone !== "") {
    if (typeof raw.tone !== "string") {
      errors.tone = "Tone must be a string.";
    } else {
      cleanTone = raw.tone.trim().slice(0, 60);
    }
  }

  // Check for sensitive credentials in untrusted inputs
  if (typeof raw.topic === "string") {
    try {
      assertNoSensitivePatterns(raw.topic, "topic");
    } catch (err) {
      errors.topic = err instanceof Error ? err.message : "Sensitive credentials detected in topic.";
    }
  }

  if (cleanCta) {
    try {
      assertNoSensitivePatterns(cleanCta, "callToAction");
    } catch (err) {
      errors.callToAction = err instanceof Error ? err.message : "Sensitive credentials detected in CTA.";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      format: (format === "reel" ? "reel" : "post"),
      topic: typeof raw.topic === "string" ? raw.topic.trim() : "",
      callToAction: cleanCta,
      language: cleanLanguage,
      tone: cleanTone,
    },
  };
}

/**
 * Generates an optimized, personalized Instagram caption using Gemini.
 * Pulls confirmed creator preferences and enforces ₹0 budget safeguards.
 */
export async function generatePersonalizedCaption(
  userId: string,
  input: GenerateCaptionInput
): Promise<GenerateCaptionActionResult> {
  const validation = validateCaptionGenerationInput(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0] || "Invalid caption generation input.";
    return {
      success: false,
      error: firstError,
      fieldErrors: validation.errors,
    };
  }

  const { format, topic, callToAction, language, tone } = validation.sanitized;

  // Retrieve creator preferences for personalization
  let creatorPreferences = null;
  try {
    creatorPreferences = await getCreatorPreferences(userId);
  } catch {
    // Graceful fallback: continue with honest general guidance
  }

  const isConfirmed = Boolean(creatorPreferences?.isConfirmed);

  // Determine language preference
  const targetLanguage = normalizeLanguagePreset(
    language ||
    (isConfirmed && creatorPreferences?.languages && creatorPreferences.languages.length > 0
      ? creatorPreferences.languages[0]
      : "English")
  );

  // Determine tone preference
  const targetTone =
    tone ||
    (isConfirmed && creatorPreferences?.brandVoice && creatorPreferences.brandVoice.length > 0
      ? creatorPreferences.brandVoice.join(", ")
      : "Conversational & Engaging");

  // Format-specific instructions
  const formatGuidelines =
    format === "reel"
      ? `FORMAT: Instagram Reel
- Write an engaging 1-2 sentence opening hook optimized for short-form video release.
- Follow with high-value, punchy bulleted insights or key takeaway points.
- Include a clear call-to-action inviting viewer saves, shares, or comments.
- Keep the caption readable and concise (100 - 250 words total).`
      : `FORMAT: Instagram Post / Carousel
- Write a compelling headline hook to stop users scrolling on the feed.
- Provide thoughtful, well-paced paragraph copy with generous visual line breaks.
- Include a specific, valuable call-to-action.
- Length: 150 - 350 words total.`;

  // Personalization context
  let personalizationContext = "";
  if (isConfirmed && creatorPreferences) {
    const niche = sanitizePromptText(creatorPreferences.niche || "Creator");
    const subNiches = (creatorPreferences.subNiches || []).map(sanitizePromptText).join(", ");
    const audience = sanitizePromptText(creatorPreferences.targetAudience || "General Community");
    const goals = (creatorPreferences.contentGoals || []).map(sanitizePromptText).join(", ");
    const voice = (creatorPreferences.brandVoice || []).map(sanitizePromptText).join(", ");
    const avoid = (creatorPreferences.topicsToAvoid || []).map(sanitizePromptText).join(", ");
    const notes = sanitizePromptText(creatorPreferences.otherNotes || "");

    personalizationContext = `CONFIRMED CREATOR PROFILE:
- Primary Niche: ${niche}
- Sub-Niches / Pillars: ${subNiches || "General"}
- Target Audience: ${audience}
- Content Goals: ${goals || "Audience Engagement"}
- Brand Voice: ${voice || targetTone}
- Creator Guidelines: ${notes || "None"}
${avoid ? `- STRICT BOUNDARIES (TOPICS TO NEVER COVER OR MENTION): ${avoid}` : ""}`;
  } else {
    personalizationContext = `CREATOR PROFILE STATUS:
- Unconfirmed creator profile. Base caption strictly on the topic and brief provided below without assuming prior niche facts.`;
  }

  const systemInstruction = `You are a professional Instagram Copywriter and Content Strategist.
Generate an engaging, production-ready Instagram caption tailored to the specified format, language, and creator context.

CRITICAL CONTENT & SAFETY RULES:
1. NEVER promise viral growth, follower counts, reach guarantees, or algorithmic secrets.
2. If the creator specified TOPICS TO NEVER COVER (boundaries), you MUST strictly respect those boundaries and NEVER mention them.
3. Support Indian regional language ecosystems (English, Hindi, Punjabi, Hinglish, Romanized Punjabi) accurately and idiomatically when requested.
4. Output clean Instagram formatting with proper spacing, emojis where appropriate to tone, and readable line breaks.
5. Provide 5-10 relevant, targeted hashtags (prefixed with #) focused on discovery, without claiming reach guarantees.
6. Provide an honest explanation separating known creator choices from AI inferences.`;

  const userPrompt = `${formatGuidelines}

${buildLanguageScriptPromptDirectives(targetLanguage)}
DESIRED TONE: ${targetTone}
${callToAction ? `REQUESTED CALL TO ACTION: "${sanitizePromptText(callToAction)}"` : ""}

${personalizationContext}

USER TOPIC & BRIEF:
<user_brief>
${sanitizePromptText(topic)}
</user_brief>

Generate the structured caption package adhering to the JSON schema.`;

  const structuredRequest: StructuredGenerationRequest = {
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.7,
    maxTokens: 1200,
    schemaDescription: "Instagram caption generation output",
    responseSchema: {
      type: "object",
      properties: {
        caption: {
          type: "string",
          description: "Full caption text formatted with paragraph line breaks and spacing.",
        },
        hashtags: {
          type: "array",
          items: { type: "string" },
          description: "5 to 10 relevant hashtags prefixed with #.",
        },
        callToAction: {
          type: "string",
          description: "The primary call to action included in the caption.",
        },
        explanation: {
          type: "string",
          description: "A concise 1-2 sentence explanation of why this caption aligns with the creator's voice and format.",
        },
      },
      required: ["caption", "hashtags", "explanation"],
    },
  };

  try {
    const aiProvider = getAiProvider();
    const result = await aiProvider.generateStructured<Record<string, unknown>>(structuredRequest);
    const data = result.data;

    // Server-side output validation
    const rawCaption = typeof data.caption === "string" ? data.caption.trim() : "";
    if (!rawCaption) {
      return {
        success: false,
        error: "AI generation returned an empty caption. Please try again with additional brief details.",
      };
    }

    const rawHashtags = Array.isArray(data.hashtags)
      ? (data.hashtags as unknown[])
          .map((h) => String(h || "").trim())
          .filter((h) => h.length > 0)
          .map((h) => (h.startsWith("#") ? h : `#${h}`))
          .slice(0, 15)
      : [];

    const rawCta = typeof data.callToAction === "string" ? data.callToAction.trim() : callToAction || undefined;

    const explanation =
      typeof data.explanation === "string" && data.explanation.trim()
        ? data.explanation.trim()
        : `Crafted for an Instagram ${format} in ${targetLanguage} matching your ${targetTone} tone.`;

    const scriptCheck = checkScriptConsistency(rawCaption, targetLanguage);
    const scriptWarning = !scriptCheck.isConsistent ? scriptCheck.warning : undefined;

    const generatedData: GeneratedCaptionResult = {
      caption: rawCaption,
      hashtags: rawHashtags,
      callToAction: rawCta,
      explanation,
      format,
      language: targetLanguage,
      tone: targetTone,
      scriptWarning,
    };

    return {
      success: true,
      data: generatedData,
      scriptWarning,
    };
  } catch (err: unknown) {
    if (err instanceof AiRateLimitError) {
      return {
        success: false,
        isRateLimited: true,
        retryAfterMs: err.retryAfterMs,
        error:
          "AI generation is temporarily unavailable because the Google Gemini API rate limit or quota has been reached. Please wait a few moments before trying again.",
        quotaDetails:
          "The exact quota restoration time is determined by Google AI Studio. You can check your project usage on the Google AI Studio rate limit dashboard and retry shortly.",
      };
    }

    if (err instanceof AiAuthenticationError) {
      return {
        success: false,
        error: "AI service configuration error: Unable to authenticate with Google Gemini. Please verify your GEMINI_API_KEY.",
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
        error: err.message || "An error occurred while generating your caption. Please try again.",
      };
    }

    const message = err instanceof Error ? err.message : "Unexpected error during caption generation.";
    return {
      success: false,
      error: message,
    };
  }
}
