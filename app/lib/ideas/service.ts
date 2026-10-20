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
  ContentIdeaCard,
  GenerateIdeasInput,
  GenerateIdeasActionResult,
} from "../definitions";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const MAX_IDEA_TOPIC_LENGTH = 500;
export const MAX_PILLAR_LENGTH = 100;
export const MAX_GOAL_LENGTH = 100;
export const MAX_LANGUAGE_LENGTH = 50;
export const MAX_TONE_LENGTH = 60;

export interface ValidatedIdeasInput {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: {
    topic?: string;
    pillar?: string;
    format: "all" | "reel" | "post";
    targetGoal?: string;
    language?: string;
    tone?: string;
  };
}

/**
 * Validates user-supplied parameters for the Hook & Reel Idea Lab.
 * Enforces length bounds, allowed format enums, and checks for sensitive data.
 */
export function validateIdeasInput(input: unknown): ValidatedIdeasInput {
  const errors: Record<string, string> = {};
  const sanitized: ValidatedIdeasInput["sanitized"] = {
    format: "all",
  };

  if (input === undefined || input === null) {
    return { isValid: true, errors, sanitized };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    errors._root = "Idea generation parameters must be an object.";
    return { isValid: false, errors, sanitized };
  }

  const raw = input as Record<string, unknown>;

  // Format validation
  if (raw.format !== undefined && raw.format !== null && raw.format !== "") {
    const fmt = String(raw.format).toLowerCase().trim();
    if (fmt === "all" || fmt === "reel" || fmt === "post") {
      sanitized.format = fmt;
    } else {
      errors.format = "Format must be 'all', 'reel', or 'post'.";
    }
  }

  // Topic validation
  if (raw.topic !== undefined && raw.topic !== null && raw.topic !== "") {
    if (typeof raw.topic !== "string") {
      errors.topic = "Topic must be a string.";
    } else {
      const trimmed = raw.topic.trim();
      if (trimmed.length > MAX_IDEA_TOPIC_LENGTH) {
        errors.topic = `Topic cannot exceed ${MAX_IDEA_TOPIC_LENGTH} characters.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, "topic");
          sanitized.topic = trimmed;
        } catch (err) {
          errors.topic = err instanceof Error ? err.message : "Topic contained sensitive credentials.";
        }
      }
    }
  }

  // Pillar validation
  if (raw.pillar !== undefined && raw.pillar !== null && raw.pillar !== "") {
    if (typeof raw.pillar !== "string") {
      errors.pillar = "Pillar must be a string.";
    } else {
      const trimmed = raw.pillar.trim();
      if (trimmed.length > MAX_PILLAR_LENGTH) {
        errors.pillar = `Pillar cannot exceed ${MAX_PILLAR_LENGTH} characters.`;
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

  // Target Goal validation
  if (raw.targetGoal !== undefined && raw.targetGoal !== null && raw.targetGoal !== "") {
    if (typeof raw.targetGoal !== "string") {
      errors.targetGoal = "Target goal must be a string.";
    } else {
      const trimmed = raw.targetGoal.trim();
      if (trimmed.length > MAX_GOAL_LENGTH) {
        errors.targetGoal = `Target goal cannot exceed ${MAX_GOAL_LENGTH} characters.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, "targetGoal");
          sanitized.targetGoal = trimmed;
        } catch (err) {
          errors.targetGoal = err instanceof Error ? err.message : "Target goal contained sensitive credentials.";
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
      if (trimmed.length > MAX_LANGUAGE_LENGTH) {
        errors.language = `Language cannot exceed ${MAX_LANGUAGE_LENGTH} characters.`;
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

  // Tone validation
  if (raw.tone !== undefined && raw.tone !== null && raw.tone !== "") {
    if (typeof raw.tone !== "string") {
      errors.tone = "Tone must be a string.";
    } else {
      const trimmed = raw.tone.trim();
      if (trimmed.length > MAX_TONE_LENGTH) {
        errors.tone = `Tone cannot exceed ${MAX_TONE_LENGTH} characters.`;
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

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}

/**
 * Builds the system instruction for Idea Lab concept generation.
 * Injects creator identity, target audience, brand voice, and strictly enforces forbidden boundaries.
 */
function buildIdeasSystemInstruction(
  preferences: CreatorPreferences | null,
  formatChoice: "all" | "reel" | "post",
  languageChoice?: string,
  toneChoice?: string
): { instruction: string; effectiveLanguage: string; effectiveTone: string } {
  const isConfirmed = Boolean(preferences?.isConfirmed);
  const niche = preferences?.niche || "General Content Creation";
  const subNiches = preferences?.subNiches?.join(", ") || "General";
  const audience = preferences?.targetAudience || "General Instagram Audience";
  const goals = preferences?.contentGoals?.join(", ") || "Engagement & Growth";
  const effectiveTone = toneChoice || preferences?.brandVoice?.join(", ") || "Conversational, Insightful";
  const avoid = preferences?.topicsToAvoid?.join(", ") || "";
  const effectiveLanguage = normalizeLanguagePreset(languageChoice || preferences?.languages?.[0] || "English");

  const instruction = `You are a high-performing Instagram Creative Director and Short-Form Script Strategist.
Generate exactly 3 fresh, high-impact, actionable Instagram content concepts tailored to the creator's confirmed profile.

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
- Desired Creative Tone: ${effectiveTone}

CRITICAL GENERATION RULES:
1. OUTPUT EXACTLY 3 CONCEPTS: Each must be creative, distinct, and practical to produce.
2. FORMAT REQUIREMENT: ${
    formatChoice === "all"
      ? "Provide a mix of short-form Reels and feed Posts (prefer at least 2 Reels)."
      : formatChoice === "reel"
      ? "All 3 concepts must be designed specifically for short-form video (Instagram Reels)."
      : "All 3 concepts must be designed for single-image or multi-image feed Posts."
  }
3. 3 DISTINCT HOOK VARIATIONS PER CONCEPT: Every concept MUST include 3 completely different 1.5-second visual or verbal hooks:
   - Variant A: Curiosity Gap / Intriguing Question
   - Variant B: Common Mistake / Negative Constraint / Warning
   - Variant C: Direct Benefit / Insider Secret / Actionable Payoff
4. 3-BEAT SHORT SCRIPT FRAMEWORK: For each concept, provide a concise, high-retention script structure:
   - hook: The recommended primary visual & verbal hook (1-3 seconds).
   - lesson: 3 punchy story beats, actionable tips, or breakdown points.
   - callToAction: Clear, specific closing action (e.g. "Save this for your next shoot", "Comment 'TEMPLATE' for my checklist").
5. REGIONAL LANGUAGE COMPLIANCE: Support Indian regional language ecosystems (English, Hindi, Punjabi, Hinglish, Romanized Punjabi) accurately and idiomatically when requested.
6. ZERO FALSE PROMISES: NEVER promise viral reach, algorithm hacks, or follower count guarantees.
7. FORBIDDEN TOPICS (STRICT BOUNDARY): Strictly respect creator boundaries. If a topic is listed in FORBIDDEN TOPICS, NEVER generate ideas touching or referencing it.`;

  return { instruction, effectiveLanguage, effectiveTone };
}

/**
 * Robustly extracts the array of concept items from the AI JSON payload,
 * accommodating root arrays, 'ideas', 'concepts', or other wrappers.
 */
function extractIdeasArray(data: unknown): unknown[] {
  if (!data) return [];

  // Case 1: Root array of concepts [ { title: ... }, ... ]
  if (Array.isArray(data)) {
    return data;
  }

  if (typeof data !== "object") {
    return [];
  }

  const obj = data as Record<string, unknown>;

  // Case 2: Standard expected property names
  if (Array.isArray(obj.ideas)) return obj.ideas;
  if (Array.isArray(obj.concepts)) return obj.concepts;
  if (Array.isArray(obj.content_ideas)) return obj.content_ideas;
  if (Array.isArray(obj.contentIdeas)) return obj.contentIdeas;
  if (Array.isArray(obj.posts)) return obj.posts;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.data)) return obj.data;

  // Case 3: Any array found among the object's values
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return value;
    }
  }

  // Case 4: The object itself is a single idea card
  if (typeof obj.title === "string" || typeof obj.concept === "string") {
    return [obj];
  }

  return [];
}

/**
 * Generates 3 personalized post/Reel concepts with 3 hook variations and a 3-beat script outline.
 * Powered by Gemini structured output, strictly adhering to the ₹0 budget and server session auth.
 */
export async function generateContentIdeas(
  userId: string,
  input: GenerateIdeasInput = {}
): Promise<GenerateIdeasActionResult> {
  const validation = validateIdeasInput(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0] || "Invalid idea generation request.";
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

  const { format, topic, pillar, targetGoal, language, tone } = validation.sanitized;
  const { instruction: systemInstruction, effectiveLanguage, effectiveTone } =
    buildIdeasSystemInstruction(preferences, format, language, tone);

  let userPrompt = "Generate 3 personalized, production-ready Instagram concepts.";
  const briefElements: string[] = [];
  if (topic) briefElements.push(`Topic / Creative Angle: "${sanitizePromptText(topic)}"`);
  if (pillar) briefElements.push(`Pillar Focus: "${sanitizePromptText(pillar)}"`);
  if (targetGoal) briefElements.push(`Primary Objective: "${sanitizePromptText(targetGoal)}"`);
  if (language) briefElements.push(`Target Language: ${language}`);

  if (briefElements.length > 0) {
    userPrompt += `\n\nSpecific Creator Directives:\n${briefElements.join("\n")}`;
  }

  userPrompt += `\n\nREQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "ideas": [
    {
      "title": "Catchy working title",
      "concept": "Core creative premise in 1-2 sentences",
      "format": "${format === "post" ? "post" : format === "reel" ? "reel" : "reel or post"}",
      "hooks": [
        "Hook 1 (Curiosity gap or provocative question)",
        "Hook 2 (Common mistake, warning, or negative constraint)",
        "Hook 3 (Direct benefit, insider secret, or actionable payoff)"
      ],
      "script": {
        "hook": "Primary visual and spoken hook (1-3 seconds)",
        "lesson": "3 punchy story beats, actionable tips, or breakdown points",
        "callToAction": "Clear closing call to action"
      },
      "targetAudienceAngle": "Brief reason why this appeals to the audience",
      "suggestedPillar": "${pillar || "Content Pillar"}"
    }
  ]
}
Ensure exactly 3 concepts are included in the "ideas" array.`;

  const structuredRequest: StructuredGenerationRequest = {
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.7,
    maxTokens: 1800,
    schemaDescription: "3 structured Instagram content concepts with hooks and scripts",
    responseSchema: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          description: "List of exactly 3 distinct Instagram concepts",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Catchy working title for this concept (under 100 characters)",
              },
              concept: {
                type: "string",
                description: "The core creative angle or premise in 1-2 clear sentences",
              },
              format: {
                type: "string",
                enum: ["reel", "post"],
                description: "Recommended format for this concept",
              },
              hooks: {
                type: "array",
                description: "Exactly 3 distinct 1.5-second visual or verbal hook variants",
                items: { type: "string" },
              },
              script: {
                type: "object",
                description: "3-beat script breakdown",
                properties: {
                  hook: {
                    type: "string",
                    description: "Opening 1.5-second visual and spoken hook",
                  },
                  lesson: {
                    type: "string",
                    description: "Core lesson, breakdown points, or value delivery",
                  },
                  callToAction: {
                    type: "string",
                    description: "Specific call to action",
                  },
                },
                required: ["hook", "lesson", "callToAction"],
              },
              targetAudienceAngle: {
                type: "string",
                description: "Brief reason why this appeals to the target audience",
              },
              suggestedPillar: {
                type: "string",
                description: "Content pillar or niche category",
              },
            },
            required: [
              "title",
              "concept",
              "format",
              "hooks",
              "script",
              "targetAudienceAngle",
            ],
          },
        },
      },
      required: ["ideas"],
    },
  };

  try {
    const aiProvider = getAiProvider();
    const result = await aiProvider.generateStructured<unknown>(structuredRequest);
    const rawIdeas = extractIdeasArray(result.data);

    if (rawIdeas.length === 0) {
      return {
        success: false,
        error: "The AI generator was unable to produce concepts for this request. Please try with different parameters.",
      };
    }

    // Server-side validation and formatting of each idea card
    const validatedIdeas: ContentIdeaCard[] = [];
    for (let i = 0; i < rawIdeas.length; i++) {
      const item = rawIdeas[i];
      if (!item || typeof item !== "object") continue;

      const raw = item as Record<string, unknown>;
      const title =
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : `Concept ${i + 1}`;
      const concept =
        typeof raw.concept === "string" && raw.concept.trim()
          ? raw.concept.trim()
          : typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim()
          : title;
      const rawFormat = String(raw.format || "reel").toLowerCase().trim();
      const cardFormat: "reel" | "post" = rawFormat === "post" ? "post" : "reel";

      // Validate exactly 3 hooks
      let rawHooks: string[] = [];
      if (Array.isArray(raw.hooks)) {
        rawHooks = raw.hooks.map((h) => String(h || "").trim()).filter(Boolean);
      } else if (Array.isArray(raw.hook_options)) {
        rawHooks = raw.hook_options.map((h) => String(h || "").trim()).filter(Boolean);
      } else if (Array.isArray(raw.hookOptions)) {
        rawHooks = raw.hookOptions.map((h) => String(h || "").trim()).filter(Boolean);
      } else if (typeof raw.hooks === "string" && raw.hooks.trim()) {
        rawHooks = [raw.hooks.trim()];
      }

      while (rawHooks.length < 3) {
        rawHooks.push(rawHooks[0] || "Stop scrolling: here is what you need to know today.");
      }
      const hooks: [string, string, string] = [
        rawHooks[0].slice(0, 300),
        rawHooks[1].slice(0, 300),
        rawHooks[2].slice(0, 300),
      ];

      // Validate script
      const rawScript =
        raw.script && typeof raw.script === "object"
          ? (raw.script as Record<string, unknown>)
          : {};
      const script = {
        hook:
          typeof rawScript.hook === "string" && rawScript.hook.trim()
            ? rawScript.hook.trim()
            : typeof rawScript.opening === "string" && rawScript.opening.trim()
            ? rawScript.opening.trim()
            : hooks[0],
        lesson:
          typeof rawScript.lesson === "string" && rawScript.lesson.trim()
            ? rawScript.lesson.trim()
            : typeof rawScript.body === "string" && rawScript.body.trim()
            ? rawScript.body.trim()
            : typeof rawScript.beats === "string" && rawScript.beats.trim()
            ? rawScript.beats.trim()
            : concept,
        callToAction:
          typeof rawScript.callToAction === "string" && rawScript.callToAction.trim()
            ? rawScript.callToAction.trim()
            : typeof rawScript.cta === "string" && rawScript.cta.trim()
            ? rawScript.cta.trim()
            : "Save this post and follow for more.",
      };

      const targetAudienceAngle =
        typeof raw.targetAudienceAngle === "string" && raw.targetAudienceAngle.trim()
          ? raw.targetAudienceAngle.trim()
          : typeof raw.audienceAngle === "string" && raw.audienceAngle.trim()
          ? raw.audienceAngle.trim()
          : "Tailored to your community.";
      const suggestedPillar =
        typeof raw.suggestedPillar === "string" && raw.suggestedPillar.trim()
          ? raw.suggestedPillar.trim()
          : typeof raw.pillar === "string" && raw.pillar.trim()
          ? raw.pillar.trim()
          : undefined;

      validatedIdeas.push({
        id: `idea-${i + 1}-${Date.now()}`,
        title: title.slice(0, 150),
        concept: concept || title,
        format: cardFormat,
        hooks,
        script,
        targetAudienceAngle,
        suggestedPillar,
        language: effectiveLanguage,
        tone: effectiveTone,
      });

      // Stop once we have 3 concepts
      if (validatedIdeas.length === 3) break;
    }

    if (validatedIdeas.length === 0) {
      return {
        success: false,
        error: "AI generation returned unparseable content concepts. Please retry.",
      };
    }

    // Script consistency heuristic across all generated concepts
    const combinedSample = validatedIdeas
      .map(
        (id) =>
          `${id.title} ${id.concept} ${id.hooks.join(" ")} ${id.script.hook} ${id.script.lesson}`
      )
      .join(" ");
    const scriptCheck = checkScriptConsistency(combinedSample, effectiveLanguage);
    const scriptWarning = !scriptCheck.isConsistent ? scriptCheck.warning : undefined;

    return {
      success: true,
      ideas: validatedIdeas,
      model: result.model || DEFAULT_GEMINI_MODEL,
      language: effectiveLanguage,
      tone: effectiveTone,
      scriptWarning,
    };
  } catch (err: unknown) {
    if (err instanceof AiRateLimitError) {
      return {
        success: false,
        isRateLimited: true,
        retryAfterMs: err.retryAfterMs,
        error:
          "Idea generation is temporarily paused because the Google Gemini rate limit or quota has been reached. Please wait a few moments before trying again.",
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
        error: err.message || "An error occurred while generating content concepts. Please try again.",
      };
    }

    const rawMessage = err instanceof Error ? err.message : "Unexpected error during idea generation.";
    return {
      success: false,
      error: rawMessage,
    };
  }
}
