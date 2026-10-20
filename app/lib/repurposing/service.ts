import "server-only";

import { getAiProvider, DEFAULT_GEMINI_MODEL } from "../ai/index";
import {
  assertNoSensitivePatterns,
  sanitizePromptText,
} from "../ai/validation";
import {
  AiRateLimitError,
  AiAuthenticationError,
  type StructuredGenerationRequest,
} from "../ai/types";
import { getCreatorPreferences } from "../creator-profile/service";
import {
  buildLanguageScriptPromptDirectives,
  checkScriptConsistency,
  normalizeLanguagePreset,
} from "../localization/standards";
import type {
  CreatorPreferences,
  RepurposeMode,
  RewriteGoal,
  RepurposeTargetFormat,
  GenerateRepurposeInput,
  GeneratedRepurposeResult,
  GenerateRepurposeActionResult,
  ReelScriptItem,
  CarouselOutlineSlide,
  StoryFrameItem,
  MultiPackRepurposeResult,
} from "../definitions";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const MIN_SOURCE_TEXT_LENGTH = 10;
export const MAX_SOURCE_TEXT_LENGTH = 3000;
export const MAX_TONE_LENGTH = 100;
export const MAX_LANGUAGE_LENGTH = 50;

export const VALID_REPURPOSE_MODES: readonly RepurposeMode[] = [
  "rewrite",
  "convert",
  "multipack",
] as const;

export const VALID_REWRITE_GOALS: readonly RewriteGoal[] = [
  "improve",
  "shorten",
  "expand",
  "hooks",
] as const;

export const VALID_TARGET_FORMATS: readonly RepurposeTargetFormat[] = [
  "reel",
  "carousel",
  "story",
] as const;

export interface ValidatedRepurposeInput {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: {
    sourceText: string;
    mode: RepurposeMode;
    goal?: RewriteGoal;
    targetFormat?: RepurposeTargetFormat;
    tone?: string;
    language?: string;
    sourceDraftId?: string;
  };
}

function countWords(str: string): number {
  return str.trim() ? str.trim().split(/\s+/).length : 0;
}

/**
 * Validates and sanitizes user input for Content Rewriting and Repurposing.
 * Enforces text length bounds (10-3000 chars), valid mode/goal/format enums, and credential screening.
 */
export function validateRepurposeInput(input: unknown): ValidatedRepurposeInput {
  const errors: Record<string, string> = {};
  const sanitized: ValidatedRepurposeInput["sanitized"] = {
    sourceText: "",
    mode: "rewrite",
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors._root = "Repurposing parameters must be a non-null object.";
    return { isValid: false, errors, sanitized };
  }

  const raw = input as Record<string, unknown>;

  // Source text validation
  if (typeof raw.sourceText !== "string" || !raw.sourceText.trim()) {
    errors.sourceText = "Source content is required.";
  } else {
    const trimmed = raw.sourceText.trim();
    if (trimmed.length < MIN_SOURCE_TEXT_LENGTH) {
      errors.sourceText = `Source content must be at least ${MIN_SOURCE_TEXT_LENGTH} characters.`;
    } else if (trimmed.length > MAX_SOURCE_TEXT_LENGTH) {
      errors.sourceText = `Source content cannot exceed ${MAX_SOURCE_TEXT_LENGTH} characters.`;
    } else {
      try {
        assertNoSensitivePatterns(trimmed, "sourceText");
        sanitized.sourceText = trimmed;
      } catch (err) {
        errors.sourceText = err instanceof Error ? err.message : "Source content contained sensitive credentials.";
      }
    }
  }

  // Mode validation
  if (raw.mode !== undefined && raw.mode !== null && raw.mode !== "") {
    if (typeof raw.mode !== "string" || !VALID_REPURPOSE_MODES.includes(raw.mode as RepurposeMode)) {
      errors.mode = `Mode must be one of: ${VALID_REPURPOSE_MODES.join(", ")}.`;
    } else {
      sanitized.mode = raw.mode as RepurposeMode;
    }
  }

  // Goal validation (for rewrite mode)
  if (sanitized.mode === "rewrite") {
    if (raw.goal !== undefined && raw.goal !== null && raw.goal !== "") {
      if (typeof raw.goal !== "string" || !VALID_REWRITE_GOALS.includes(raw.goal as RewriteGoal)) {
        errors.goal = `Rewrite goal must be one of: ${VALID_REWRITE_GOALS.join(", ")}.`;
      } else {
        sanitized.goal = raw.goal as RewriteGoal;
      }
    } else {
      sanitized.goal = "improve";
    }
  }

  // Target format validation (for convert mode)
  if (sanitized.mode === "convert") {
    if (raw.targetFormat !== undefined && raw.targetFormat !== null && raw.targetFormat !== "") {
      if (
        typeof raw.targetFormat !== "string" ||
        !VALID_TARGET_FORMATS.includes(raw.targetFormat as RepurposeTargetFormat)
      ) {
        errors.targetFormat = `Target format must be one of: ${VALID_TARGET_FORMATS.join(", ")}.`;
      } else {
        sanitized.targetFormat = raw.targetFormat as RepurposeTargetFormat;
      }
    } else {
      sanitized.targetFormat = "reel";
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

  // Source draft ID (pass-through string)
  if (typeof raw.sourceDraftId === "string" && raw.sourceDraftId.trim()) {
    sanitized.sourceDraftId = raw.sourceDraftId.trim();
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}

/**
 * Builds system instruction for content rewriting and repurposing with strict factual preservation and boundaries.
 */
export function buildRepurposingSystemInstruction(
  preferences: CreatorPreferences | null,
  mode: RepurposeMode,
  goal?: RewriteGoal,
  targetFormat?: RepurposeTargetFormat,
  tone?: string,
  language?: string
): string {
  const isConfirmed = Boolean(preferences?.isConfirmed);
  const niche = sanitizePromptText(preferences?.niche || "Content Creator");
  const audience = sanitizePromptText(preferences?.targetAudience || "General Community");
  const brandVoice = (preferences?.brandVoice || []).map(sanitizePromptText).join(", ") || "Authentic & Engaging";
  const effectiveTone = tone || brandVoice;
  const effectiveLanguage = normalizeLanguagePreset(language || preferences?.languages?.[0] || "English");
  const avoid = (preferences?.topicsToAvoid || []).map(sanitizePromptText).join(", ");

  let modeSpecificRules = "";

  if (mode === "rewrite") {
    switch (goal) {
      case "shorten":
        modeSpecificRules = `REWRITE GOAL: SHORTEN & CONDENSE
- Eliminate filler words, redundancy, and fluff.
- Distill the core takeaway into a punchy, high-retention 50-120 word read.
- Maintain the original meaning, key metrics, and personal voice.`;
        break;
      case "expand":
        modeSpecificRules = `REWRITE GOAL: EXPAND & ELABORATE
- Elaborate on the core points and thoughts already present in the source.
- Add logical depth, structured bullet takeaways, and helpful context.
- DO NOT invent fake personal experiences, false statistics, or unsupported case studies.`;
        break;
      case "hooks":
        modeSpecificRules = `REWRITE GOAL: HOOK VARIATIONS
- Generate exactly 3 distinct, scroll-stopping opening hook variations for this text:
  1. Direct Curiosity/Contrarian hook
  2. Question/Problem-Agitation hook
  3. Transformation/Lesson hook
- Keep hooks punchy (1-2 sentences each).`;
        break;
      case "improve":
      default:
        modeSpecificRules = `REWRITE GOAL: IMPROVE & POLISH
- Elevate the flow, clarity, sentence variety, and engagement of the text.
- Strengthen the opening line and pacing for Instagram mobile readers.
- Correct grammatical weaknesses while retaining the creator's natural tone.`;
        break;
    }
  } else if (mode === "convert") {
    switch (targetFormat) {
      case "reel":
        modeSpecificRules = `CONVERT GOAL: CAPTION TO REEL SCRIPT
- Transform the source text into a structured, high-retention 3-beat short video script:
  1. Hook (opening 3 seconds)
  2. Lesson/Body Beats (core takeaway with concise points)
  3. Call to Action (clear viewer prompt)
- Provide concise visual/b-roll suggestions in visualNotes.`;
        break;
      case "carousel":
        modeSpecificRules = `CONVERT GOAL: CAPTION TO 5-SLIDE CAROUSEL OUTLINE
- Structure the content into EXACTLY 5 sequential slides:
  - Slide 1: Cover hook (headline + teaser subtitle)
  - Slide 2: Value point / Step 1
  - Slide 3: Value point / Step 2
  - Slide 4: Value point / Step 3
  - Slide 5: Call to action (prompt to save/share)
- Every slide must include slideNumber (1-5), slideType ("cover" | "value" | "cta"), headline, bodyText, and practical visualSuggestion.`;
        break;
      case "story":
        modeSpecificRules = `CONVERT GOAL: CAPTION TO 3-FRAME STORY SEQUENCE
- Structure the content into EXACTLY 3 interactive Instagram Story frames:
  - Frame 1: Hook / Context / Poll question
  - Frame 2: Core insight / Key breakdown
  - Frame 3: Call to action / Question sticker / DM prompt
- Every frame must include frameNumber (1-3), frameType ("hook" | "insight" | "cta"), content, and stickerSuggestion.`;
        break;
    }
  } else if (mode === "multipack") {
    modeSpecificRules = `REPURPOSE GOAL: ALL-IN-ONE MULTI-FORMAT PACK
- Repurpose the single source text into ALL 4 companion Instagram formats:
  1. Polished Feed Caption: Engaging caption (100-250 words) with 5-10 hashtags.
  2. Reel Script: 3-beat script (hook, beats, callToAction, visualNotes).
  3. 5-Slide Carousel Outline: Exactly 5 slides (1 cover, 3 value, 1 cta).
  4. 3-Frame Story Sequence: Exactly 3 story frames with interactive sticker ideas.`;
  }

  return `You are a professional Instagram Content Strategist and Repurposing Specialist.
Your objective is to rewrite, refine, or transform existing creator content while preserving its original meaning, factual claims, and creator identity.

${
  isConfirmed
    ? `CONFIRMED CREATOR PROFILE:
- Primary Niche: ${niche}
- Target Audience: ${audience}
- Brand Voice: ${effectiveTone}
- Language: ${effectiveLanguage}
- FORBIDDEN TOPICS (STRICT BOUNDARY): ${avoid ? avoid : "None declared"}`
    : `GENERAL CREATOR CONTEXT:
- Tone: ${effectiveTone}
- Target Language: ${effectiveLanguage}`
}

${buildLanguageScriptPromptDirectives(effectiveLanguage)}
- Desired Output Tone: ${effectiveTone}

${modeSpecificRules}

MANDATORY GENERATION SAFEGUARDS:
1. PRESERVE SOURCE MEANING & FACTUAL CLAIMS:
   - You MUST anchor all output directly to the concepts, arguments, and facts in the source content.
   - NEVER invent facts, personal anecdotes, fake statistics, unsupported case studies, or claims not present in the original text.
2. DO NOT FABRICATE MISSING SECTIONS:
   - Provide complete, high-quality responses strictly satisfying the schema.
   - For carousel decks: ALWAYS produce all 5 required slides.
   - For story sequences: ALWAYS produce all 3 required frames.
3. FORBIDDEN TOPICS (STRICT BOUNDARY):
   - If the source content touches any declared forbidden topic, immediately refuse to generate by returning an explanation stating the boundary.
4. ZERO FALSE PROMISES:
   - NEVER promise viral reach, algorithm hacks, or follower count guarantees.
5. REGIONAL LANGUAGE COMPLIANCE:
   - Accurately adopt requested regional languages (English, Hindi, Punjabi, Hinglish, Romanized Punjabi) with natural flow and culturally authentic phrasing.`;
}

/**
 * Returns explicit JSON format instructions and template for the user prompt.
 */
function getRequiredOutputPrompt(
  mode: RepurposeMode,
  goal?: RewriteGoal,
  targetFormat?: RepurposeTargetFormat
): string {
  if (mode === "rewrite") {
    if (goal === "hooks") {
      return `REQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "alternativeHooks": [
    "Hook 1: Direct curiosity or contrarian hook",
    "Hook 2: Question or problem-agitation hook",
    "Hook 3: Transformation or lesson hook"
  ],
  "explanation": "Brief explanation of the hook strategy"
}`;
    }

    return `REQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "rewrittenText": "The complete rewritten and polished content formatted with paragraph line breaks",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
  "explanation": "Brief explanation of changes made"
}`;
  }

  if (mode === "convert") {
    if (targetFormat === "reel") {
      return `REQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "reelScript": {
    "hook": "Opening 0-3s visual and verbal hook",
    "beats": "Core lesson and breakdown points (numbered or bulleted)",
    "callToAction": "Clear call to action asking viewers to save, share, or follow",
    "visualNotes": "Camera angles, b-roll ideas, or text overlay cues"
  },
  "explanation": "Brief explanation of how the script structure drives retention"
}`;
    }

    if (targetFormat === "carousel") {
      return `REQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "carouselOutline": {
    "title": "Working title for the carousel (under 100 characters)",
    "slides": [
      {
        "slideNumber": 1,
        "slideType": "cover",
        "headline": "Irresistible scroll-stopping hook headline",
        "bodyText": "Subtitle or context hook teaser",
        "visualSuggestion": "Visual layout description"
      },
      {
        "slideNumber": 2,
        "slideType": "value",
        "headline": "Step 1 or Key Insight",
        "bodyText": "Concise value breakdown (20-50 words)",
        "visualSuggestion": "Diagram or visual layout suggestion"
      },
      {
        "slideNumber": 3,
        "slideType": "value",
        "headline": "Step 2 or Key Insight",
        "bodyText": "Concise value breakdown (20-50 words)",
        "visualSuggestion": "Visual layout description"
      },
      {
        "slideNumber": 4,
        "slideType": "value",
        "headline": "Step 3 or Key Insight",
        "bodyText": "Concise value breakdown (20-50 words)",
        "visualSuggestion": "Visual layout description"
      },
      {
        "slideNumber": 5,
        "slideType": "cta",
        "headline": "Actionable closing summary",
        "bodyText": "Clear call to action asking viewers to save or comment",
        "visualSuggestion": "Outro card with bookmark prompt"
      }
    ]
  },
  "explanation": "Brief summary of the carousel structure"
}`;
    }

    if (targetFormat === "story") {
      return `REQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema:
{
  "storySequence": [
    {
      "frameNumber": 1,
      "frameType": "hook",
      "content": "Opening frame setting the context or asking an interactive question",
      "stickerSuggestion": "Poll sticker idea: Option A vs Option B"
    },
    {
      "frameNumber": 2,
      "frameType": "insight",
      "content": "Core insight or surprising breakdown point",
      "stickerSuggestion": "Slider sticker or emoji reaction"
    },
    {
      "frameNumber": 3,
      "frameType": "cta",
      "content": "Closing call to action directing viewers to post, bio, or link",
      "stickerSuggestion": "Link sticker or DM prompt"
    }
  ],
  "explanation": "Brief explanation of the story engagement flow"
}`;
    }
  }

  // mode === "multipack"
  return `REQUIRED OUTPUT FORMAT:
You MUST respond with a valid JSON object containing ALL 4 formats:
{
  "feedCaption": "Polished feed caption with paragraph line breaks",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "reelScript": {
    "hook": "Opening 0-3s hook",
    "beats": "Core lesson and breakdown points",
    "callToAction": "Clear call to action",
    "visualNotes": "Camera angles and visual notes"
  },
  "carouselOutline": {
    "title": "Carousel Title",
    "slides": [
      { "slideNumber": 1, "slideType": "cover", "headline": "Cover Hook", "bodyText": "Subtitle", "visualSuggestion": "Visual layout" },
      { "slideNumber": 2, "slideType": "value", "headline": "Point 1", "bodyText": "Details", "visualSuggestion": "Visual layout" },
      { "slideNumber": 3, "slideType": "value", "headline": "Point 2", "bodyText": "Details", "visualSuggestion": "Visual layout" },
      { "slideNumber": 4, "slideType": "value", "headline": "Point 3", "bodyText": "Details", "visualSuggestion": "Visual layout" },
      { "slideNumber": 5, "slideType": "cta", "headline": "Closing CTA", "bodyText": "Call to action", "visualSuggestion": "Visual layout" }
    ]
  },
  "storySequence": [
    { "frameNumber": 1, "frameType": "hook", "content": "Question or hook", "stickerSuggestion": "Poll sticker" },
    { "frameNumber": 2, "frameType": "insight", "content": "Core breakdown", "stickerSuggestion": "Reaction sticker" },
    { "frameNumber": 3, "frameType": "cta", "content": "Call to action", "stickerSuggestion": "Link sticker" }
  ],
  "explanation": "Brief summary of multi-pack alignment"
}`;
}

/**
 * Resiliently extracts rewritten text and hashtags from raw AI output.
 */
function extractRewriteOutput(data: unknown): {
  rewrittenText: string;
  hashtags: string[];
  explanation?: string;
} {
  if (!data || typeof data !== "object") {
    return { rewrittenText: "", hashtags: [] };
  }

  const obj = data as Record<string, unknown>;
  const target = (obj.rewrite && typeof obj.rewrite === "object" ? obj.rewrite : obj) as Record<string, unknown>;

  const textCandidates = [
    obj.rewrite,
    target.rewrite,
    target.rewrittenText,
    target.rewritten,
    target.improvedText,
    target.improved,
    target.caption,
    target.post,
    target.text,
    target.content,
    target.output,
    obj.rewrittenText,
    obj.rewritten,
    obj.text,
    obj.content,
    obj.caption,
  ];

  let rewrittenText = "";
  for (const c of textCandidates) {
    if (typeof c === "string" && c.trim()) {
      rewrittenText = c.trim();
      break;
    }
  }

  const rawTags = Array.isArray(target.hashtags)
    ? target.hashtags
    : Array.isArray(obj.hashtags)
    ? obj.hashtags
    : Array.isArray(target.tags)
    ? target.tags
    : Array.isArray(obj.tags)
    ? obj.tags
    : [];

  const hashtags = rawTags
    .map((h) => String(h || "").trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 10);

  const explanation =
    typeof target.explanation === "string"
      ? target.explanation.trim()
      : typeof obj.explanation === "string"
      ? obj.explanation.trim()
      : undefined;

  return { rewrittenText, hashtags, explanation };
}

/**
 * Resiliently extracts hook variations from raw AI output.
 */
function extractHookVariations(data: unknown): {
  hooks: string[];
  explanation?: string;
} {
  if (!data) return { hooks: [] };

  if (Array.isArray(data)) {
    return {
      hooks: data.map((h) => String(h || "").trim()).filter(Boolean).slice(0, 5),
    };
  }

  if (typeof data !== "object") return { hooks: [] };

  const obj = data as Record<string, unknown>;

  const rawList = Array.isArray(obj.alternativeHooks)
    ? obj.alternativeHooks
    : Array.isArray(obj.hooks)
    ? obj.hooks
    : Array.isArray(obj.variants)
    ? obj.variants
    : Array.isArray(obj.hookVariations)
    ? obj.hookVariations
    : Array.isArray(obj.items)
    ? obj.items
    : [];

  const hooks = rawList
    .map((h) => {
      if (typeof h === "string") return h.trim();
      if (typeof h === "object" && h && "hook" in h) {
        return String((h as Record<string, unknown>).hook).trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 5);

  const explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : undefined;

  return { hooks, explanation };
}

/**
 * Resiliently extracts Reel script structure from raw AI output.
 */
function extractReelScriptOutput(data: unknown): {
  reelScript: ReelScriptItem | null;
  explanation?: string;
} {
  if (!data || typeof data !== "object") return { reelScript: null };

  const obj = data as Record<string, unknown>;

  const rawReel = (
    obj.reelScript && typeof obj.reelScript === "object"
      ? obj.reelScript
      : obj.reel && typeof obj.reel === "object"
      ? obj.reel
      : obj.script && typeof obj.script === "object"
      ? obj.script
      : obj.video && typeof obj.video === "object"
      ? obj.video
      : obj.hook
      ? obj
      : null
  ) as Record<string, unknown> | null;

  if (!rawReel) return { reelScript: null };

  const hook =
    typeof rawReel.hook === "string"
      ? rawReel.hook.trim()
      : typeof rawReel.opening === "string"
      ? rawReel.opening.trim()
      : typeof rawReel.hookText === "string"
      ? rawReel.hookText.trim()
      : typeof rawReel.title === "string"
      ? rawReel.title.trim()
      : "";

  const beats =
    typeof rawReel.beats === "string"
      ? rawReel.beats.trim()
      : typeof rawReel.lesson === "string"
      ? rawReel.lesson.trim()
      : typeof rawReel.body === "string"
      ? rawReel.body.trim()
      : typeof rawReel.points === "string"
      ? rawReel.points.trim()
      : typeof rawReel.content === "string"
      ? rawReel.content.trim()
      : typeof rawReel.script === "string"
      ? rawReel.script.trim()
      : Array.isArray(rawReel.beats)
      ? (rawReel.beats as unknown[]).map((b) => String(b || "").trim()).filter(Boolean).join("\n")
      : Array.isArray(rawReel.points)
      ? (rawReel.points as unknown[]).map((b) => String(b || "").trim()).filter(Boolean).join("\n")
      : "";

  const callToAction =
    typeof rawReel.callToAction === "string"
      ? rawReel.callToAction.trim()
      : typeof rawReel.cta === "string"
      ? rawReel.cta.trim()
      : typeof rawReel.outro === "string"
      ? rawReel.outro.trim()
      : typeof rawReel.action === "string"
      ? rawReel.action.trim()
      : typeof rawReel.call_to_action === "string"
      ? rawReel.call_to_action.trim()
      : "";

  const visualNotes =
    typeof rawReel.visualNotes === "string"
      ? rawReel.visualNotes.trim()
      : typeof rawReel.visuals === "string"
      ? rawReel.visuals.trim()
      : typeof rawReel.notes === "string"
      ? rawReel.notes.trim()
      : typeof rawReel.visual === "string"
      ? rawReel.visual.trim()
      : typeof rawReel.camera === "string"
      ? rawReel.camera.trim()
      : undefined;

  const explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : undefined;

  if (!hook || !beats || !callToAction) {
    return { reelScript: null, explanation };
  }

  return {
    reelScript: { hook, beats, callToAction, visualNotes },
    explanation,
  };
}

/**
 * Resiliently extracts Carousel outline slides from raw AI output.
 */
function extractCarouselOutlineOutput(data: unknown): {
  title: string;
  slides: CarouselOutlineSlide[];
  explanation?: string;
} {
  if (!data) return { title: "Carousel Outline", slides: [] };

  let rawSlides: unknown[] = [];
  let title = "Carousel Outline";
  let explanation: string | undefined;

  if (Array.isArray(data)) {
    rawSlides = data;
  } else if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : undefined;

    const outline = (
      obj.carouselOutline && typeof obj.carouselOutline === "object"
        ? obj.carouselOutline
        : obj.carousel && typeof obj.carousel === "object"
        ? obj.carousel
        : obj.deck && typeof obj.deck === "object"
        ? obj.deck
        : obj
    ) as Record<string, unknown>;

    if (typeof outline.title === "string" && outline.title.trim()) {
      title = outline.title.trim();
    } else if (typeof obj.title === "string" && obj.title.trim()) {
      title = obj.title.trim();
    }

    if (Array.isArray(outline.slides)) {
      rawSlides = outline.slides;
    } else if (Array.isArray(obj.slides)) {
      rawSlides = obj.slides;
    } else if (Array.isArray(outline.cards)) {
      rawSlides = outline.cards;
    } else if (Array.isArray(obj.cards)) {
      rawSlides = obj.cards;
    } else if (Array.isArray(obj.deck)) {
      rawSlides = obj.deck;
    } else {
      for (const val of Object.values(obj)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
          rawSlides = val;
          break;
        }
      }
    }
  }

  const slides: CarouselOutlineSlide[] = [];
  for (let i = 0; i < rawSlides.length; i++) {
    const item = rawSlides[i] as Record<string, unknown>;
    if (!item || typeof item !== "object") continue;

    const slideNum = i + 1;
    const slideType: "cover" | "value" | "cta" =
      slideNum === 1 ? "cover" : slideNum === 5 ? "cta" : "value";

    const headline =
      typeof item.headline === "string" && item.headline.trim()
        ? item.headline.trim()
        : typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : typeof item.heading === "string" && item.heading.trim()
        ? item.heading.trim()
        : `Slide ${slideNum}`;

    const bodyText =
      typeof item.bodyText === "string" && item.bodyText.trim()
        ? item.bodyText.trim()
        : typeof item.body === "string" && item.body.trim()
        ? item.body.trim()
        : typeof item.content === "string" && item.content.trim()
        ? item.content.trim()
        : typeof item.text === "string" && item.text.trim()
        ? item.text.trim()
        : typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : "";

    const visualSuggestion =
      typeof item.visualSuggestion === "string" && item.visualSuggestion.trim()
        ? item.visualSuggestion.trim()
        : typeof item.visual === "string" && item.visual.trim()
        ? item.visual.trim()
        : typeof item.suggestion === "string" && item.suggestion.trim()
        ? item.suggestion.trim()
        : typeof item.layout === "string" && item.layout.trim()
        ? item.layout.trim()
        : undefined;

    if (!bodyText) continue;

    slides.push({
      slideNumber: slideNum,
      slideType,
      headline,
      bodyText,
      visualSuggestion,
    });

    if (slides.length === 5) break;
  }

  return { title, slides, explanation };
}

/**
 * Resiliently extracts Story sequence frames from raw AI output.
 */
function extractStorySequenceOutput(data: unknown): {
  frames: StoryFrameItem[];
  explanation?: string;
} {
  if (!data) return { frames: [] };

  let rawFrames: unknown[] = [];
  let explanation: string | undefined;

  if (Array.isArray(data)) {
    rawFrames = data;
  } else if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : undefined;

    if (Array.isArray(obj.storySequence)) {
      rawFrames = obj.storySequence;
    } else if (Array.isArray(obj.story)) {
      rawFrames = obj.story;
    } else if (Array.isArray(obj.stories)) {
      rawFrames = obj.stories;
    } else if (Array.isArray(obj.frames)) {
      rawFrames = obj.frames;
    } else if (Array.isArray(obj.sequence)) {
      rawFrames = obj.sequence;
    } else {
      for (const val of Object.values(obj)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
          rawFrames = val;
          break;
        }
      }
    }
  }

  const frames: StoryFrameItem[] = [];
  for (let i = 0; i < rawFrames.length; i++) {
    const item = rawFrames[i] as Record<string, unknown>;
    if (!item || typeof item !== "object") continue;

    const frameNum = i + 1;
    const frameType: "hook" | "insight" | "cta" =
      frameNum === 1 ? "hook" : frameNum === 3 ? "cta" : "insight";

    const content =
      typeof item.content === "string" && item.content.trim()
        ? item.content.trim()
        : typeof item.text === "string" && item.text.trim()
        ? item.text.trim()
        : typeof item.body === "string" && item.body.trim()
        ? item.body.trim()
        : typeof item.caption === "string" && item.caption.trim()
        ? item.caption.trim()
        : "";

    const stickerSuggestion =
      typeof item.stickerSuggestion === "string" && item.stickerSuggestion.trim()
        ? item.stickerSuggestion.trim()
        : typeof item.sticker === "string" && item.sticker.trim()
        ? item.sticker.trim()
        : typeof item.interactiveElement === "string" && item.interactiveElement.trim()
        ? item.interactiveElement.trim()
        : typeof item.engagementPrompt === "string" && item.engagementPrompt.trim()
        ? item.engagementPrompt.trim()
        : undefined;

    if (!content) continue;

    frames.push({
      frameNumber: frameNum,
      frameType,
      content,
      stickerSuggestion,
    });

    if (frames.length === 3) break;
  }

  return { frames, explanation };
}

/**
 * Resiliently extracts Multi-Pack output components from raw AI output.
 */
function extractMultiPackOutput(data: unknown): {
  multiPack: MultiPackRepurposeResult | null;
  error?: string;
  explanation?: string;
} {
  if (!data || typeof data !== "object") {
    return { multiPack: null, error: "AI output was not a valid object." };
  }

  const obj = data as Record<string, unknown>;
  const explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : undefined;

  // 1. Feed caption
  const captionCandidates = [
    obj.feedCaption,
    obj.caption,
    obj.post,
    obj.feed_caption,
    obj.feed,
    obj.text,
  ];
  let feedCaption = "";
  for (const c of captionCandidates) {
    if (typeof c === "string" && c.trim()) {
      feedCaption = c.trim();
      break;
    }
  }

  if (!feedCaption) {
    return {
      multiPack: null,
      error: "Multi-pack generation is missing the companion feed caption. Please retry.",
      explanation,
    };
  }

  const rawTags = Array.isArray(obj.hashtags)
    ? obj.hashtags
    : Array.isArray(obj.tags)
    ? obj.tags
    : [];

  const hashtags = rawTags
    .map((h) => String(h || "").trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 10);

  // 2. Reel script
  const reelResult = extractReelScriptOutput(obj.reelScript || obj.reel || obj.script || obj);
  if (!reelResult.reelScript) {
    return {
      multiPack: null,
      error: "Multi-pack generation produced an incomplete Reel script. Please retry.",
      explanation,
    };
  }

  // 3. Carousel outline
  const carouselResult = extractCarouselOutlineOutput(
    obj.carouselOutline || obj.carousel || obj.slides || obj.deck
  );
  if (carouselResult.slides.length < 5) {
    return {
      multiPack: null,
      error: `Multi-pack generation produced an incomplete carousel outline (${carouselResult.slides.length}/5 slides). Please retry.`,
      explanation,
    };
  }

  // 4. Story sequence
  const storyResult = extractStorySequenceOutput(
    obj.storySequence || obj.story || obj.stories || obj.frames
  );
  if (storyResult.frames.length < 3) {
    return {
      multiPack: null,
      error: `Multi-pack generation produced an incomplete Story sequence (${storyResult.frames.length}/3 frames). Please retry.`,
      explanation,
    };
  }

  return {
    multiPack: {
      feedCaption,
      hashtags,
      reelScript: reelResult.reelScript,
      carouselOutline: {
        title: carouselResult.title,
        slides: carouselResult.slides,
      },
      storySequence: storyResult.frames,
    },
    explanation,
  };
}

/**
 * Builds the JSON response schema for Gemini structured output based on the operation mode.
 */
function getResponseSchemaForMode(mode: RepurposeMode, goal?: RewriteGoal, targetFormat?: RepurposeTargetFormat) {
  if (mode === "rewrite") {
    if (goal === "hooks") {
      return {
        type: "object",
        properties: {
          alternativeHooks: {
            type: "array",
            items: { type: "string" },
            description: "Exactly 3 distinct opening hook variations",
          },
          explanation: { type: "string", description: "Brief explanation of how these hooks improve retention" },
        },
        required: ["alternativeHooks", "explanation"],
      };
    }

    return {
      type: "object",
      properties: {
        rewrittenText: { type: "string", description: "The transformed and polished content" },
        hashtags: {
          type: "array",
          items: { type: "string" },
          description: "5 to 10 relevant hashtags prefixed with #",
        },
        explanation: { type: "string", description: "Summary of changes made to enhance impact" },
      },
      required: ["rewrittenText", "hashtags", "explanation"],
    };
  }

  if (mode === "convert") {
    if (targetFormat === "reel") {
      return {
        type: "object",
        properties: {
          reelScript: {
            type: "object",
            properties: {
              hook: { type: "string", description: "Opening 3-second hook" },
              beats: { type: "string", description: "Core lesson points and narrative breakdown" },
              callToAction: { type: "string", description: "Clear closing call to action" },
              visualNotes: { type: "string", description: "Camera movement and visual b-roll suggestions" },
            },
            required: ["hook", "beats", "callToAction"],
          },
          explanation: { type: "string" },
        },
        required: ["reelScript", "explanation"],
      };
    }

    if (targetFormat === "carousel") {
      return {
        type: "object",
        properties: {
          carouselOutline: {
            type: "object",
            properties: {
              title: { type: "string" },
              slides: {
                type: "array",
                description: "Array of exactly 5 slides",
                items: {
                  type: "object",
                  properties: {
                    slideNumber: { type: "integer" },
                    slideType: { type: "string", enum: ["cover", "value", "cta"] },
                    headline: { type: "string" },
                    bodyText: { type: "string" },
                    visualSuggestion: { type: "string" },
                  },
                  required: ["slideNumber", "slideType", "headline", "bodyText"],
                },
              },
            },
            required: ["title", "slides"],
          },
          explanation: { type: "string" },
        },
        required: ["carouselOutline", "explanation"],
      };
    }

    if (targetFormat === "story") {
      return {
        type: "object",
        properties: {
          storySequence: {
            type: "array",
            description: "Array of exactly 3 interactive story frames",
            items: {
              type: "object",
              properties: {
                frameNumber: { type: "integer" },
                frameType: { type: "string", enum: ["hook", "insight", "cta"] },
                content: { type: "string" },
                stickerSuggestion: { type: "string" },
              },
              required: ["frameNumber", "frameType", "content"],
            },
          },
          explanation: { type: "string" },
        },
        required: ["storySequence", "explanation"],
      };
    }
  }

  // mode === "multipack"
  return {
    type: "object",
    properties: {
      feedCaption: { type: "string", description: "Polished feed caption" },
      hashtags: { type: "array", items: { type: "string" } },
      reelScript: {
        type: "object",
        properties: {
          hook: { type: "string" },
          beats: { type: "string" },
          callToAction: { type: "string" },
          visualNotes: { type: "string" },
        },
        required: ["hook", "beats", "callToAction"],
      },
      carouselOutline: {
        type: "object",
        properties: {
          title: { type: "string" },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slideNumber: { type: "integer" },
                slideType: { type: "string", enum: ["cover", "value", "cta"] },
                headline: { type: "string" },
                bodyText: { type: "string" },
                visualSuggestion: { type: "string" },
              },
              required: ["slideNumber", "slideType", "headline", "bodyText"],
            },
          },
        },
        required: ["title", "slides"],
      },
      storySequence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            frameNumber: { type: "integer" },
            frameType: { type: "string", enum: ["hook", "insight", "cta"] },
            content: { type: "string" },
            stickerSuggestion: { type: "string" },
          },
          required: ["frameNumber", "frameType", "content"],
        },
      },
      explanation: { type: "string" },
    },
    required: ["feedCaption", "hashtags", "reelScript", "carouselOutline", "storySequence", "explanation"],
  };
}

/**
 * Executes server-side Content Rewriting and Repurposing using Gemini.
 * Strictly adheres to ₹0 spend, session auth, factual preservation, and no silent padding.
 */
export async function repurposeContent(
  userId: string,
  input: GenerateRepurposeInput
): Promise<GenerateRepurposeActionResult> {
  const validation = validateRepurposeInput(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0] || "Invalid repurposing request.";
    return {
      success: false,
      error: firstError,
      fieldErrors: validation.errors,
    };
  }

  // Retrieve creator preferences for personalization & boundaries
  let preferences: CreatorPreferences | null = null;
  try {
    preferences = await getCreatorPreferences(userId);
  } catch {
    preferences = null;
  }

  const { sourceText, mode, goal, targetFormat, tone, language } = validation.sanitized;
  const originalWordCount = countWords(sourceText);

  // Determine effective language and tone
  const effectiveLanguage = normalizeLanguagePreset(language || preferences?.languages?.[0] || "English");
  const effectiveTone = tone || preferences?.brandVoice?.[0] || "Authentic";

  // Check forbidden topics boundary against source text
  if (preferences?.topicsToAvoid && preferences.topicsToAvoid.length > 0) {
    const lowerSource = sourceText.toLowerCase();
    for (const forbidden of preferences.topicsToAvoid) {
      if (forbidden && forbidden.trim() && lowerSource.includes(forbidden.toLowerCase().trim())) {
        return {
          success: false,
          error: `The content touches on "${forbidden}", which is registered in your Creator Profile as a forbidden topic. Generation was blocked to protect your brand boundaries.`,
        };
      }
    }
  }

  const systemInstruction = buildRepurposingSystemInstruction(
    preferences,
    mode,
    goal,
    targetFormat,
    effectiveTone,
    effectiveLanguage
  );

  const userPrompt = `ORIGINAL CREATOR CONTENT TO REPURPOSE:
"""
${sanitizePromptText(sourceText)}
"""

OPERATIONAL DIRECTIVES:
- Mode: ${mode}
${goal ? `- Rewrite Goal: ${goal}` : ""}
${targetFormat ? `- Target Format: ${targetFormat}` : ""}
- Desired Tone: ${sanitizePromptText(effectiveTone)}
- Language / Script: ${effectiveLanguage}

${buildLanguageScriptPromptDirectives(effectiveLanguage)}

${getRequiredOutputPrompt(mode, goal, targetFormat)}`;

  const structuredRequest: StructuredGenerationRequest = {
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.7,
    maxTokens: mode === "multipack" ? 3000 : 2000,
    schemaDescription: `Repurposed Instagram content (${mode})`,
    responseSchema: getResponseSchemaForMode(mode, goal, targetFormat),
  };

  try {
    const aiProvider = getAiProvider();
    const response = await aiProvider.generateStructured<Record<string, unknown>>(structuredRequest);
    const data = response.data;

    if (!data || typeof data !== "object") {
      return {
        success: false,
        error: "The AI generator produced an invalid response. Please try again with adjusted parameters.",
      };
    }

    // Server-side output validation and formatting
    const generatedResult: GeneratedRepurposeResult = {
      mode,
      goal,
      targetFormat,
      originalText: sourceText,
      originalWordCount,
      model: response.model || DEFAULT_GEMINI_MODEL,
      language: effectiveLanguage,
      tone: effectiveTone,
    };

    if (typeof data.explanation === "string") {
      generatedResult.explanation = data.explanation.trim();
    }

    // 1. REWRITE MODE VALIDATION
    if (mode === "rewrite") {
      if (goal === "hooks") {
        const { hooks, explanation } = extractHookVariations(data);
        if (hooks.length === 0) {
          return {
            success: false,
            error: "The AI generator was unable to produce hook variations for this text. Please try again.",
          };
        }
        generatedResult.alternativeHooks = hooks;
        if (explanation) generatedResult.explanation = explanation;
      } else {
        const { rewrittenText, hashtags, explanation } = extractRewriteOutput(data);
        if (!rewrittenText) {
          return {
            success: false,
            error: "The AI generator produced an empty rewrite. Please try again.",
          };
        }
        generatedResult.rewrittenText = rewrittenText;
        generatedResult.rewrittenWordCount = countWords(rewrittenText);
        generatedResult.hashtags = hashtags;
        if (explanation) generatedResult.explanation = explanation;
      }
    }

    // 2. CONVERT MODE VALIDATION
    else if (mode === "convert") {
      if (targetFormat === "reel") {
        const { reelScript, explanation } = extractReelScriptOutput(data);
        if (!reelScript) {
          return {
            success: false,
            error: "The AI generator was unable to produce a Reel script. Please try again.",
          };
        }
        generatedResult.reelScript = reelScript;
        if (explanation) generatedResult.explanation = explanation;
      } else if (targetFormat === "carousel") {
        const { title, slides, explanation } = extractCarouselOutlineOutput(data);
        // Safeguard: Do NOT silently pad missing slides
        if (slides.length < 5) {
          return {
            success: false,
            error: `The AI generator produced an incomplete carousel deck (${slides.length} of 5 slides). Please try again.`,
          };
        }
        generatedResult.carouselOutline = {
          title: title.slice(0, 150),
          slides,
        };
        if (explanation) generatedResult.explanation = explanation;
      } else if (targetFormat === "story") {
        const { frames, explanation } = extractStorySequenceOutput(data);
        // Safeguard: Do NOT silently pad missing frames
        if (frames.length < 3) {
          return {
            success: false,
            error: `The AI generator produced an incomplete Story sequence (${frames.length} of 3 frames). Please try again.`,
          };
        }
        generatedResult.storySequence = frames;
        if (explanation) generatedResult.explanation = explanation;
      }
    }

    // 3. MULTIPACK MODE VALIDATION
    else if (mode === "multipack") {
      const { multiPack, error, explanation } = extractMultiPackOutput(data);
      if (!multiPack || error) {
        return {
          success: false,
          error: error || "Multi-pack generation produced an incomplete response. Please retry.",
        };
      }
      generatedResult.multiPack = multiPack;
      if (explanation) generatedResult.explanation = explanation;
    }

    // Script consistency heuristic across generated content
    let sampleText = "";
    if (generatedResult.rewrittenText) {
      sampleText = generatedResult.rewrittenText;
    } else if (generatedResult.alternativeHooks && generatedResult.alternativeHooks.length > 0) {
      sampleText = generatedResult.alternativeHooks.join(" ");
    } else if (generatedResult.reelScript) {
      sampleText = `${generatedResult.reelScript.hook} ${generatedResult.reelScript.beats}`;
    } else if (generatedResult.carouselOutline) {
      sampleText = generatedResult.carouselOutline.slides
        .map((s) => `${s.headline} ${s.bodyText}`)
        .join(" ");
    } else if (generatedResult.storySequence) {
      sampleText = generatedResult.storySequence.map((s) => s.content).join(" ");
    } else if (generatedResult.multiPack) {
      sampleText = `${generatedResult.multiPack.feedCaption} ${generatedResult.multiPack.reelScript.hook} ${generatedResult.multiPack.carouselOutline.slides.map((s) => s.headline).join(" ")}`;
    }

    const scriptCheck = checkScriptConsistency(sampleText, effectiveLanguage);
    const scriptWarning = !scriptCheck.isConsistent ? scriptCheck.warning : undefined;
    generatedResult.scriptWarning = scriptWarning;

    return {
      success: true,
      result: generatedResult,
      model: response.model || DEFAULT_GEMINI_MODEL,
      scriptWarning,
    };
  } catch (err: unknown) {
    if (err instanceof AiRateLimitError) {
      return {
        success: false,
        isRateLimited: true,
        retryAfterMs: err.retryAfterMs,
        error:
          "Content repurposing is temporarily paused because the Google Gemini rate limit or quota has been reached. Please wait a few moments before trying again.",
        quotaDetails:
          "The quota reset interval is governed by Google AI Studio. You can check usage on the Google AI Studio rate limit dashboard and retry shortly.",
      };
    }

    if (err instanceof AiAuthenticationError) {
      return {
        success: false,
        error:
          "Unable to authenticate with Google Gemini. Please check your Google AI Studio configuration in .env.local.",
      };
    }

    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while repurposing content. Please try again.",
    };
  }
}
