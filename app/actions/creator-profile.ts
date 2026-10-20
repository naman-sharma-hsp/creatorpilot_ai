"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "../lib/dal";
import { createClient } from "../lib/supabase/server";
import {
  saveCreatorPreferences,
  analyzeCreatorIdentity,
  getCreativeIntelligence,
  getCreatorPreferences,
  type InstagramContextTelemetry,
} from "../lib/creator-profile/service";
import type {
  CreatorPreferences,
  ActionState,
  CreativeIntelligenceResult,
} from "../lib/definitions";

export interface SavePreferencesResult extends ActionState {
  preferences?: CreatorPreferences;
}

export interface AnalyzeIdentityActionResult extends ActionState {
  analysis?: CreatorPreferences["aiSuggestions"];
  isRateLimited?: boolean;
  retryAfterMs?: number;
}

/**
 * Server Action: Persists creator identity preferences.
 * Enforces authoritative server-side user verification via verifySession().
 */
export async function saveCreatorPreferencesAction(
  payload: unknown
): Promise<SavePreferencesResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to update creator preferences.",
    };
  }

  const result = await saveCreatorPreferences(session.user.id, payload);
  if (!result.success) {
    return {
      success: false,
      error: result.error || "Failed to persist creator preferences.",
    };
  }

  revalidatePath("/");
  return {
    success: true,
    message: result.data?.isConfirmed
      ? "Creator identity successfully confirmed."
      : "Creator preferences saved.",
    preferences: result.data,
  };
}

/**
 * Server Action: Executes AI analysis of creator identity and niche alignment.
 * Gathers genuinely available account signals while practicing data minimization.
 * Strictly adheres to ₹0 budget constraints.
 */
export async function analyzeCreatorIdentityAction(
  creatorAnswers: unknown
): Promise<AnalyzeIdentityActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to analyze creator identity.",
    };
  }

  let instagramContext: InstagramContextTelemetry | null = null;

  try {
    const supabase = await createClient();
    const { data: account } = await supabase
      .from("connected_accounts")
      .select("username, status, metadata")
      .eq("user_id", session.user.id)
      .eq("platform", "instagram")
      .maybeSingle();

    if (account && account.status === "connected") {
      const cache = account.metadata?.analytics_cache as Record<string, unknown> | undefined;
      const cachedData = cache?.data as Record<string, unknown> | undefined;

      const recentMedia = Array.isArray(cachedData?.recentMedia)
        ? (cachedData.recentMedia as Record<string, unknown>[])
            .map((m) => (typeof m.caption === "string" ? m.caption : ""))
            .filter(Boolean)
        : [];

      instagramContext = {
        username: account.username || (cachedData?.username as string) || null,
        followersCount: typeof cachedData?.followersCount === "number" ? cachedData.followersCount : null,
        mediaCount: typeof cachedData?.mediaCount === "number" ? cachedData.mediaCount : null,
        reach30d: typeof cachedData?.reach30d === "number" ? cachedData.reach30d : null,
        recentCaptions: recentMedia.slice(0, 5),
      };
    }
  } catch {
    // If telemetry lookup encounters an issue, proceed without Instagram context
    instagramContext = null;
  }

  const answersObj = (creatorAnswers && typeof creatorAnswers === "object" ? creatorAnswers : {}) as Partial<CreatorPreferences>;

  const result = await analyzeCreatorIdentity({
    creatorAnswers: answersObj,
    instagramContext,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || "AI identity analysis failed.",
      isRateLimited: result.isRateLimited,
      retryAfterMs: result.retryAfterMs,
    };
  }

  return {
    success: true,
    message: "Identity analysis generated successfully.",
    analysis: result.analysis,
  };
}

/**
 * Server Action: Generates or refreshes creative intelligence recommendations.
 * Tailors insights directly to the creator's confirmed preferences and authentic Instagram telemetry.
 * Strict ₹0 budget compliance.
 */
export async function getCreativeIntelligenceAction(
  clientPreferences?: Partial<CreatorPreferences>
): Promise<CreativeIntelligenceResult> {
  const session = await verifySession();
  let preferences: Partial<CreatorPreferences> = clientPreferences || {};
  let instagramContext: InstagramContextTelemetry | null = null;

  if (session.isAuth && session.user) {
    try {
      const storedPreferences = await getCreatorPreferences(session.user.id);
      preferences = {
        ...storedPreferences,
        ...clientPreferences,
      };

      const supabase = await createClient();
      const { data: account } = await supabase
        .from("connected_accounts")
        .select("username, status, metadata")
        .eq("user_id", session.user.id)
        .eq("platform", "instagram")
        .maybeSingle();

      if (account && account.status === "connected") {
        const cache = account.metadata?.analytics_cache as Record<string, unknown> | undefined;
        const cachedData = cache?.data as Record<string, unknown> | undefined;

        instagramContext = {
          username: account.username || (cachedData?.username as string) || null,
          followersCount: typeof cachedData?.followersCount === "number" ? cachedData.followersCount : null,
          mediaCount: typeof cachedData?.mediaCount === "number" ? cachedData.mediaCount : null,
          reach30d: typeof cachedData?.reach30d === "number" ? cachedData.reach30d : null,
          totalInteractions: typeof cachedData?.totalInteractions === "number" ? cachedData.totalInteractions : null,
        };
      }
    } catch {
      // Fallback gracefully without throwing
    }
  }

  const result = await getCreativeIntelligence({
    creatorAnswers: preferences,
    instagramContext,
  });

  return {
    success: true,
    recommendations: result.recommendations,
    model: result.model,
    isAiGenerated: result.isAiGenerated,
  };
}
