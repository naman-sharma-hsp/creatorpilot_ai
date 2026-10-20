import type { CreatorPreferences, DraftFormat } from "../definitions";

export const ALLOWED_FORMATS: readonly DraftFormat[] = [
  "reel",
  "carousel",
  "post",
  "story",
] as const;

export const STANDARD_LANGUAGES = [
  "English",
  "Hindi",
  "Punjabi",
  "Hinglish",
  "Romanized Punjabi",
] as const;

export const STANDARD_VOICE_TONES = [
  "Educational & Informative",
  "Casual & Relatable",
  "Authoritative & Expert",
  "Entertaining & Humorous",
  "Inspirational & Motivational",
  "Story-driven & Personal",
] as const;

export const STANDARD_CONTENT_GOALS = [
  "Audience Growth",
  "Community Building",
  "High Engagement & Discussions",
  "Brand Awareness & Authority",
  "Lead Generation & Inquiries",
  "Product / Course Sales",
] as const;

export const MAX_LENGTHS = {
  niche: 100,
  subNicheItem: 50,
  maxSubNiches: 10,
  targetAudience: 500,
  contentGoalItem: 50,
  maxContentGoals: 10,
  brandVoiceItem: 50,
  maxBrandVoice: 10,
  languageItem: 50,
  maxLanguages: 10,
  topicItem: 100,
  maxTopics: 20,
  otherNotes: 1000,
} as const;

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: CreatorPreferences;
}

/**
 * Returns default empty creator preferences.
 */
export function getDefaultCreatorPreferences(): CreatorPreferences {
  return {
    niche: "",
    subNiches: [],
    targetAudience: "",
    contentGoals: [],
    preferredFormats: ["reel", "carousel"],
    brandVoice: [],
    languages: ["English"],
    topicsToCover: [],
    topicsToAvoid: [],
    otherNotes: "",
    isConfirmed: false,
    confirmedAt: null,
    updatedAt: new Date().toISOString(),
    aiSuggestions: null,
  };
}

/**
 * Sanitizes an array of strings: trims, filters empty, deduplicates, and limits length and count.
 */
export function sanitizeStringList(
  items: unknown,
  maxItemLength: number,
  maxCount: number
): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      const trimmed = item.trim().slice(0, maxItemLength);
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        sanitized.push(trimmed);
        if (sanitized.length >= maxCount) {
          break;
        }
      }
    }
  }

  return sanitized;
}

/**
 * Validates and sanitizes creator preferences payload.
 * Enforces bounded limits, format enums, and structured consistency.
 */
export function validateCreatorPreferences(input: unknown): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== "object") {
    return {
      isValid: false,
      errors: { root: "Preferences payload must be a non-null object." },
      sanitized: getDefaultCreatorPreferences(),
    };
  }

  const raw = input as Record<string, unknown>;

  // Niche
  const rawNiche = typeof raw.niche === "string" ? raw.niche.trim() : "";
  if (rawNiche.length > MAX_LENGTHS.niche) {
    errors.niche = `Niche cannot exceed ${MAX_LENGTHS.niche} characters.`;
  }
  const niche = rawNiche.slice(0, MAX_LENGTHS.niche);

  // Sub-niches
  const subNiches = sanitizeStringList(
    raw.subNiches,
    MAX_LENGTHS.subNicheItem,
    MAX_LENGTHS.maxSubNiches
  );

  // Target audience
  const rawAudience = typeof raw.targetAudience === "string" ? raw.targetAudience.trim() : "";
  if (rawAudience.length > MAX_LENGTHS.targetAudience) {
    errors.targetAudience = `Target audience cannot exceed ${MAX_LENGTHS.targetAudience} characters.`;
  }
  const targetAudience = rawAudience.slice(0, MAX_LENGTHS.targetAudience);

  // Content goals
  const contentGoals = sanitizeStringList(
    raw.contentGoals,
    MAX_LENGTHS.contentGoalItem,
    MAX_LENGTHS.maxContentGoals
  );

  // Preferred formats
  const preferredFormats: DraftFormat[] = [];
  if (Array.isArray(raw.preferredFormats)) {
    for (const fmt of raw.preferredFormats) {
      if (ALLOWED_FORMATS.includes(fmt as DraftFormat) && !preferredFormats.includes(fmt as DraftFormat)) {
        preferredFormats.push(fmt as DraftFormat);
      }
    }
  }

  // Brand voice
  const brandVoice = sanitizeStringList(
    raw.brandVoice,
    MAX_LENGTHS.brandVoiceItem,
    MAX_LENGTHS.maxBrandVoice
  );

  // Languages
  const languages = sanitizeStringList(
    raw.languages,
    MAX_LENGTHS.languageItem,
    MAX_LENGTHS.maxLanguages
  );

  // Topics to cover
  const topicsToCover = sanitizeStringList(
    raw.topicsToCover,
    MAX_LENGTHS.topicItem,
    MAX_LENGTHS.maxTopics
  );

  // Topics to avoid
  const topicsToAvoid = sanitizeStringList(
    raw.topicsToAvoid,
    MAX_LENGTHS.topicItem,
    MAX_LENGTHS.maxTopics
  );

  // Other notes
  const rawNotes = typeof raw.otherNotes === "string" ? raw.otherNotes.trim() : "";
  if (rawNotes.length > MAX_LENGTHS.otherNotes) {
    errors.otherNotes = `Other notes cannot exceed ${MAX_LENGTHS.otherNotes} characters.`;
  }
  const otherNotes = rawNotes.slice(0, MAX_LENGTHS.otherNotes);

  // Confirmation flags
  const isConfirmed = Boolean(raw.isConfirmed);
  const confirmedAt = isConfirmed
    ? (typeof raw.confirmedAt === "string" && raw.confirmedAt ? raw.confirmedAt : new Date().toISOString())
    : null;

  // Preserve existing aiSuggestions if valid object
  const aiSuggestions = raw.aiSuggestions && typeof raw.aiSuggestions === "object"
    ? (raw.aiSuggestions as CreatorPreferences["aiSuggestions"])
    : null;

  const sanitized: CreatorPreferences = {
    niche,
    subNiches,
    targetAudience,
    contentGoals,
    preferredFormats,
    brandVoice,
    languages: languages.length > 0 ? languages : ["English"],
    topicsToCover,
    topicsToAvoid,
    otherNotes,
    isConfirmed,
    confirmedAt,
    updatedAt: new Date().toISOString(),
    aiSuggestions,
  };

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}
