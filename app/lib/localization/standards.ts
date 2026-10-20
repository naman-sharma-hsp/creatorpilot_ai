/**
 * Shared Localization Standards
 * Phase 1C.4 - Canonical language/script presets, tone options, prompt directives,
 * and lightweight non-blocking script consistency verifiers.
 */

export interface LanguagePreset {
  id: string;
  label: string;
  nativeLabel?: string;
  script: "latin" | "devanagari" | "gurmukhi" | "custom";
  description: string;
}

export const CANONICAL_LANGUAGE_PRESETS: readonly LanguagePreset[] = [
  {
    id: "English",
    label: "English",
    script: "latin",
    description: "Standard English written in the Latin alphabet",
  },
  {
    id: "Hindi (Devanagari)",
    label: "Hindi (Devanagari)",
    nativeLabel: "हिन्दी",
    script: "devanagari",
    description: "Native Hindi vocabulary written in the Devanagari script (हिन्दी)",
  },
  {
    id: "Hinglish (Roman script)",
    label: "Hinglish (Roman script)",
    script: "latin",
    description: "Conversational Hindi written in the Latin alphabet with common English loanwords",
  },
  {
    id: "Punjabi (Gurmukhi)",
    label: "Punjabi (Gurmukhi)",
    nativeLabel: "ਪੰਜਾਬੀ",
    script: "gurmukhi",
    description: "Native Punjabi vocabulary written in the Gurmukhi script (ਪੰਜਾਬੀ)",
  },
  {
    id: "Romanized Punjabi",
    label: "Romanized Punjabi",
    script: "latin",
    description: "Conversational Punjabi written in the Latin alphabet (Romanized)",
  },
] as const;

export const CANONICAL_TONE_OPTIONS = [
  "Casual & Relatable",
  "Professional & Authoritative",
  "Entertaining & Humorous",
  "Educational & Informative",
  "Inspirational & Motivational",
  "Story-driven & Personal",
] as const;

export type CanonicalLanguageId =
  | "English"
  | "Hindi (Devanagari)"
  | "Hinglish (Roman script)"
  | "Punjabi (Gurmukhi)"
  | "Romanized Punjabi";

export type CanonicalTone = (typeof CANONICAL_TONE_OPTIONS)[number];

/**
 * Normalizes any legacy or shorthand language identifier to its canonical preset.
 * Preserves custom language strings cleanly.
 */
export function normalizeLanguagePreset(input?: string | null): string {
  if (!input || typeof input !== "string") {
    return "English";
  }

  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "english") return "English";
  if (lower === "hindi" || lower === "hindi (devanagari)" || lower === "devanagari hindi") {
    return "Hindi (Devanagari)";
  }
  if (
    lower === "hinglish" ||
    lower === "hinglish (roman script)" ||
    lower === "romanized hindi" ||
    lower === "hindi (roman)"
  ) {
    return "Hinglish (Roman script)";
  }
  if (lower === "punjabi" || lower === "punjabi (gurmukhi)" || lower === "gurmukhi punjabi") {
    return "Punjabi (Gurmukhi)";
  }
  if (
    lower === "romanized punjabi" ||
    lower === "punjabi (roman)" ||
    lower === "punjabi (roman script)" ||
    lower === "punjabi (romanized)"
  ) {
    return "Romanized Punjabi";
  }

  return trimmed;
}

/**
 * Builds unambiguous server-side prompt directives for the chosen language and script.
 * Injected into AI system instructions and operational parameters.
 */
export function buildLanguageScriptPromptDirectives(languageChoice?: string | null): string {
  const normalized = normalizeLanguagePreset(languageChoice);

  switch (normalized) {
    case "Hindi (Devanagari)":
      return `TARGET LANGUAGE & SCRIPT DIRECTIVE:
- Language: Hindi
- Script: Native Devanagari script (हिन्दी).
- Formatting: Write all primary headlines, body text, hooks, and call-to-actions in authentic Devanagari script.
- Exceptions: Common brand names (e.g. Instagram, Next.js), technical keywords, and discovery hashtags may use standard Latin letters where natural in creator content.
- Do NOT output Romanized / Latin phonetic transliteration for Hindi sentences.`;

    case "Hinglish (Roman script)":
      return `TARGET LANGUAGE & SCRIPT DIRECTIVE:
- Language: Hinglish (Conversational blend of Hindi and English widely used by Indian creators).
- Script: Strict Latin / Roman alphabet ONLY.
- Formatting: Write Hindi phrases, slang, and expressions phonetically using standard Latin characters (e.g., "Yeh galti bilkul mat karna", "Aapka engagement double ho sakta hai").
- CRITICAL BOUNDARY: Do NOT use Devanagari script characters (no हिन्दी script). Everything must remain readable in standard Latin characters.`;

    case "Punjabi (Gurmukhi)":
      return `TARGET LANGUAGE & SCRIPT DIRECTIVE:
- Language: Punjabi
- Script: Native Gurmukhi script (ਪੰਜਾਬੀ).
- Formatting: Write all core messages, hooks, insights, and CTAs in authentic Gurmukhi script.
- Exceptions: Universal hashtags, creator usernames, and global brand names may use standard Latin letters.
- Do NOT output Romanized / Latin transliteration for Punjabi sentences.`;

    case "Romanized Punjabi":
      return `TARGET LANGUAGE & SCRIPT DIRECTIVE:
- Language: Punjabi (Conversational, authentic idioms and vocabulary).
- Script: Strict Latin / Roman alphabet ONLY.
- Formatting: Write Punjabi words and idioms phonetically using standard Latin characters (e.g., "Kivein ho dosto", "Eh 3 galtiyan kade na karo").
- CRITICAL BOUNDARY: Do NOT use Gurmukhi script characters (no ਪੰਜਾਬੀ script). Everything must remain readable in standard Latin characters.`;

    case "English":
      return `TARGET LANGUAGE & SCRIPT DIRECTIVE:
- Language: English
- Script: Standard Latin alphabet.
- Formatting: Clear, natural, professional English suited for high-retention Instagram content.`;

    default:
      return `TARGET LANGUAGE & SCRIPT DIRECTIVE:
- Language: ${normalized}
- Formatting: Produce content authentically in ${normalized}, respecting its native phrasing, script norms, and creator tone.`;
  }
}

/**
 * Lightweight, best-effort server-side script check.
 * Identifies obvious script mismatches without blocking usable content or triggering false alarms
 * on borrowed words, brand names, code symbols, or discovery hashtags.
 *
 * NOTE: This is a best-effort heuristic for UI feedback and does NOT guarantee grammatical or linguistic perfection.
 */
export function checkScriptConsistency(
  text: string,
  languageChoice?: string | null
): {
  isConsistent: boolean;
  warning?: string;
  detectedNativeCount?: number;
  detectedLatinCount?: number;
} {
  if (!text || typeof text !== "string") {
    return { isConsistent: true };
  }

  const normalized = normalizeLanguagePreset(languageChoice);

  // Strip discovery hashtags, URLs, and code blocks to avoid counting English tags against native scripts
  const cleaned = text
    .replace(/#\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();

  // Unicode matches
  const devanagariMatches = cleaned.match(/[\u0900-\u097F]/g) || [];
  const gurmukhiMatches = cleaned.match(/[\u0A00-\u0A7F]/g) || [];
  const latinMatches = cleaned.match(/[a-zA-Z]/g) || [];

  const devanagariCount = devanagariMatches.length;
  const gurmukhiCount = gurmukhiMatches.length;
  const latinCount = latinMatches.length;

  // 1. Hindi (Devanagari) expected: requires detectable Devanagari text
  if (normalized === "Hindi (Devanagari)") {
    if (devanagariCount < 6 && latinCount > 35) {
      return {
        isConsistent: false,
        warning:
          "Notice: The generated content appears to use Romanized text instead of native Devanagari script (हिन्दी). You can edit the text directly or retry generation.",
        detectedNativeCount: devanagariCount,
        detectedLatinCount: latinCount,
      };
    }
  }

  // 2. Punjabi (Gurmukhi) expected: requires detectable Gurmukhi text
  if (normalized === "Punjabi (Gurmukhi)") {
    if (gurmukhiCount < 6 && latinCount > 35) {
      return {
        isConsistent: false,
        warning:
          "Notice: The generated content appears to use Romanized text instead of native Gurmukhi script (ਪੰਜਾਬੀ). You can edit the text directly or retry generation.",
        detectedNativeCount: gurmukhiCount,
        detectedLatinCount: latinCount,
      };
    }
  }

  // 3. Hinglish expected: must NOT contain substantial Devanagari characters
  if (normalized === "Hinglish (Roman script)") {
    if (devanagariCount >= 20) {
      return {
        isConsistent: false,
        warning:
          "Notice: The generated content contains native Devanagari script characters, though Hinglish (Roman script) was selected.",
        detectedNativeCount: devanagariCount,
        detectedLatinCount: latinCount,
      };
    }
  }

  // 4. Romanized Punjabi expected: must NOT contain substantial Gurmukhi characters
  if (normalized === "Romanized Punjabi") {
    if (gurmukhiCount >= 20) {
      return {
        isConsistent: false,
        warning:
          "Notice: The generated content contains native Gurmukhi script characters, though Romanized Punjabi was selected.",
        detectedNativeCount: gurmukhiCount,
        detectedLatinCount: latinCount,
      };
    }
  }

  // 5. English expected: should not contain substantial foreign scripts
  if (normalized === "English") {
    if (devanagariCount >= 25 || gurmukhiCount >= 25) {
      return {
        isConsistent: false,
        warning:
          "Notice: The generated content contains regional script characters, though English was selected.",
        detectedNativeCount: devanagariCount + gurmukhiCount,
        detectedLatinCount: latinCount,
      };
    }
  }

  return {
    isConsistent: true,
    detectedNativeCount: devanagariCount + gurmukhiCount,
    detectedLatinCount: latinCount,
  };
}
