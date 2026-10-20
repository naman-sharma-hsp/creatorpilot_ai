import "server-only";

import { getChatAiProvider, GEMINI_CHAT_MODEL } from "../ai/index";
import {
  AiError,
  AiRateLimitError,
  AiAuthenticationError,
  AiInvalidInputError,
  AiResponseError,
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
  CreatorChatInput,
  CreatorChatActionResult,
} from "../definitions";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_TURNS = 12;
export const MAX_CHAT_TOKENS = 1200;
export const MAX_CHAT_LANG_LENGTH = 50;
export const MAX_CHAT_TONE_LENGTH = 60;

export interface ValidatedChatInput {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: {
    message: string;
    history: Array<{ role: "user" | "model"; content: string }>;
    language?: string;
    tone?: string;
  };
}

/**
 * Validates and sanitizes creator chat messages and conversational turn history.
 * Enforces character limits, history array bounds, allowed roles, and screens sensitive data.
 */
export function validateChatInput(input: unknown): ValidatedChatInput {
  const errors: Record<string, string> = {};
  const sanitized: ValidatedChatInput["sanitized"] = {
    message: "",
    history: [],
  };

  if (!input || typeof input !== "object") {
    errors._root = "Chat payload must be a non-null object.";
    return { isValid: false, errors, sanitized };
  }

  const raw = input as Record<string, unknown>;

    // Validate message
    if (typeof raw.message !== "string") {
      errors.message = "Message must be a string.";
    } else {
      const trimmed = raw.message.trim();
      if (trimmed.length === 0) {
        errors.message = "Message cannot be empty. Please enter your question or request.";
      } else if (trimmed.length > MAX_MESSAGE_LENGTH) {
        errors.message = `Your message exceeds the ${MAX_MESSAGE_LENGTH}-character limit (${trimmed.length} characters). Please shorten your message and try again.`;
      } else {
        try {
          assertNoSensitivePatterns(trimmed, "message");
          sanitized.message = trimmed;
        } catch (err) {
          errors.message = err instanceof Error ? err.message : "Message contained sensitive data.";
        }
      }
    }

    // Validate conversation history
    if (raw.history !== undefined) {
      if (!Array.isArray(raw.history)) {
        errors.history = "History must be an array of messages.";
      } else if (raw.history.length > MAX_HISTORY_TURNS) {
        errors.history = `Conversation history cannot exceed ${MAX_HISTORY_TURNS} recent messages.`;
      } else {
        const sanitizedHistory: Array<{ role: "user" | "model"; content: string }> = [];
        for (let i = 0; i < raw.history.length; i++) {
          const item = raw.history[i];
          if (!item || typeof item !== "object") {
            errors[`history_${i}`] = `History message at index ${i} must be an object.`;
            continue;
          }
          const msg = item as Record<string, unknown>;
          if (msg.role !== "user" && msg.role !== "model") {
            errors[`history_${i}_role`] = `Invalid history role at index ${i}. Allowed: 'user' or 'model'.`;
            continue;
          }
          if (typeof msg.content !== "string") {
            errors[`history_${i}_content`] = `History content at index ${i} must be a string.`;
            continue;
          }
          const contentTrimmed = msg.content.trim();
          if (contentTrimmed.length === 0) {
            continue;
          }

          // Safely truncate older conversation turns to preserve recent context
          // without exceeding the 2000-character boundary or causing validation failure
          let boundedContent = contentTrimmed;
          if (boundedContent.length > MAX_MESSAGE_LENGTH) {
            boundedContent = boundedContent.slice(0, MAX_MESSAGE_LENGTH);
          }

          const sanitizedContent = sanitizePromptText(boundedContent);
          const finalContent =
            sanitizedContent.length > MAX_MESSAGE_LENGTH
              ? sanitizedContent.slice(0, MAX_MESSAGE_LENGTH)
              : sanitizedContent;

          if (finalContent.trim().length > 0) {
            sanitizedHistory.push({
              role: msg.role,
              content: finalContent,
            });
          }
        }
        sanitized.history = sanitizedHistory;
      }
    }

    // Validate optional language override
    if (raw.language !== undefined && raw.language !== null && raw.language !== "") {
      if (typeof raw.language !== "string") {
        errors.language = "Language must be a string.";
      } else {
        const trimmedLang = raw.language.trim();
        if (trimmedLang.length > MAX_CHAT_LANG_LENGTH) {
          errors.language = `Language cannot exceed ${MAX_CHAT_LANG_LENGTH} characters.`;
        } else {
          try {
            assertNoSensitivePatterns(trimmedLang, "language");
            sanitized.language = trimmedLang;
          } catch (err) {
            errors.language = err instanceof Error ? err.message : "Language contained sensitive data.";
          }
        }
      }
    }

    // Validate optional tone override
    if (raw.tone !== undefined && raw.tone !== null && raw.tone !== "") {
      if (typeof raw.tone !== "string") {
        errors.tone = "Tone must be a string.";
      } else {
        const trimmedTone = raw.tone.trim();
        if (trimmedTone.length > MAX_CHAT_TONE_LENGTH) {
          errors.tone = `Tone cannot exceed ${MAX_CHAT_TONE_LENGTH} characters.`;
        } else {
          try {
            assertNoSensitivePatterns(trimmedTone, "tone");
            sanitized.tone = trimmedTone;
          } catch (err) {
            errors.tone = err instanceof Error ? err.message : "Tone contained sensitive data.";
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
 * Builds the authoritative server-side system instruction for the Creator AI Chat.
 * Injects confirmed creator facts, brand voice, audience context, and strictly enforces forbidden topics.
 */
function buildChatSystemInstruction(
  preferences: CreatorPreferences | null,
  languageChoice?: string,
  toneChoice?: string
): { instruction: string; effectiveLanguage: string; effectiveTone: string } {
  const isConfirmed = Boolean(preferences?.isConfirmed);
  const niche = preferences?.niche || "General Content Creation";
  const subNiches = preferences?.subNiches?.join(", ") || "None specified";
  const audience = preferences?.targetAudience || "General Instagram community";
  const brandVoice = toneChoice || preferences?.brandVoice?.join(", ") || "Authentic, relatable & clear";
  const goals = preferences?.contentGoals?.join(", ") || "Audience growth & engagement";
  const formats = preferences?.preferredFormats?.join(", ") || "Reels, Posts, Carousels";
  const effectiveLanguage = normalizeLanguagePreset(languageChoice || preferences?.languages?.[0] || "English");
  const forbiddenTopics = preferences?.topicsToAvoid?.join(", ") || "";
  const topicsToCover = preferences?.topicsToCover?.join(", ") || "";

  const instruction = `You are the Creator AI Studio Assistant, a world-class strategic Instagram co-pilot.
Your mission is to help this individual creator brainstorm content concepts, script high-retention Reels, craft compelling hooks and captions, refine storytelling, and explore content pillars.

CREATOR IDENTITY CONTEXT (${isConfirmed ? "CONFIRMED IDENTITY" : "INITIAL PROFILE / UNCONFIRMED"}):
- Primary Niche: ${niche}
- Sub-Niches: ${subNiches}
- Target Audience: ${audience}
- Content Goals: ${goals}
- Preferred Formats: ${formats}
- Brand Voice / Tone: ${brandVoice}
- Primary Language: ${effectiveLanguage}
${topicsToCover ? `- Focus Pillars & Themes to Cover: ${topicsToCover}` : ""}

${buildLanguageScriptPromptDirectives(effectiveLanguage)}
- Target Tone / Persona: ${brandVoice}

CRITICAL STRATEGY & SAFETY INSTRUCTIONS:
1. NEVER guarantee viral reach, specific follower counts, algorithmic exploits, or misleading growth hacks.
2. If the creator specified TOPICS TO NEVER COVER below, you MUST strictly respect those boundaries and NEVER bring them up:
   FORBIDDEN TOPICS (STRICT BOUNDARY): ${forbiddenTopics ? forbiddenTopics : "None declared"}
3. Support Indian regional language ecosystems (English, Hindi, Punjabi, Hinglish, Romanized Punjabi) accurately and idiomatically when requested.
4. If creator preferences are unconfirmed or incomplete, ask brief clarifying questions or provide clearly labeled general best practices.
5. Provide actionable, high-quality answers:
   - For Reel ideas: include 1.5-second visual hook options, story beats (problem -> insight -> payoff), and a specific CTA.
   - For captions: provide paragraph spacing, readability rhythm, and 3-5 relevant hashtags (always prefixed with #).
   - Format responses cleanly with markdown headers, bullet points, and code/quote blocks for scripts so the creator can easily copy or save them to their Drafts Vault.
6. Keep responses focused, insightful, and practical. Avoid unnecessary filler or generic conversational pleasantries.`;

  return { instruction, effectiveLanguage, effectiveTone: brandVoice };
}

/**
 * Generates an interactive multi-turn response for Creator AI Chat.
 * Uses the dedicated server-side gemini-3.5-flash-lite model configuration.
 * Strictly adheres to ₹0 budget rules and handles rate limits truthfully.
 */
export async function generateCreatorChatResponse(
  userId: string,
  input: CreatorChatInput
): Promise<CreatorChatActionResult> {
  const validation = validateChatInput(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0] || "Invalid chat request.";
    return {
      success: false,
      error: firstError,
    };
  }

  // Retrieve confirmed creator preferences from server storage
  let preferences: CreatorPreferences | null = null;
  try {
    preferences = await getCreatorPreferences(userId);
  } catch {
    // Proceed with unconfirmed fallback if preferences fail to load
    preferences = null;
  }

  const { instruction: systemInstruction, effectiveLanguage, effectiveTone } =
    buildChatSystemInstruction(
      preferences,
      validation.sanitized.language,
      validation.sanitized.tone
    );
  const prompt = sanitizePromptText(validation.sanitized.message);
  // Guarantee every history message strictly satisfies the 2000-char limit before sending to Gemini
  const conversationHistory = validation.sanitized.history
    .map((turn) => ({
      role: turn.role,
      content:
        turn.content.length > MAX_MESSAGE_LENGTH
          ? turn.content.slice(0, MAX_MESSAGE_LENGTH)
          : turn.content,
    }))
    .filter((turn) => turn.content.trim().length > 0);

  try {
    const chatProvider = getChatAiProvider();
    const response = await chatProvider.generateText({
      prompt,
      systemInstruction,
      conversationHistory,
      temperature: 0.7,
      maxTokens: MAX_CHAT_TOKENS,
    });

    const outputText = response.text?.trim();
    if (!outputText) {
      return {
        success: false,
        error: "The AI assistant returned an empty response. Please try asking your question again.",
      };
    }

    const scriptCheck = checkScriptConsistency(outputText, effectiveLanguage);
    const scriptWarning = !scriptCheck.isConsistent ? scriptCheck.warning : undefined;

    return {
      success: true,
      message: outputText,
      model: response.model || GEMINI_CHAT_MODEL,
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
          "AI chat is temporarily unavailable because the Google Gemini API rate limit or daily quota has been reached. Please wait a few moments before trying again.",
        quotaDetails:
          "The exact quota restoration time is determined by Google AI Studio. You can check your project usage on the Google AI Studio rate limit dashboard and retry shortly.",
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

    // Check for model availability or restricted access (HTTP 404 or model not found)
    if (err instanceof AiResponseError) {
      if (
        err.status === 404 ||
        err.message.includes("404") ||
        err.message.toLowerCase().includes("not found")
      ) {
        return {
          success: false,
          isModelRestricted: true,
          error:
            `The requested AI model (${GEMINI_CHAT_MODEL}) is unavailable or not found for this Google AI Studio project. Please verify project model availability.`,
        };
      }
    }

    if (err instanceof AiError) {
      return {
        success: false,
        error: err.message || "An error occurred while generating the chat response. Please try again.",
      };
    }

    const rawMessage = err instanceof Error ? err.message : "Unexpected error during chat generation.";
    return {
      success: false,
      error: rawMessage,
    };
  }
}
