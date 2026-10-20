"use server";

import { verifySession } from "../lib/dal";
import { getCreatorPreferences } from "../lib/creator-profile/service";
import { fetchCreatorTrends } from "../lib/trends/service";
import type { TrendResearchResult } from "../lib/trends/types";

export interface GetNicheTrendsActionResult {
  success: boolean;
  result?: TrendResearchResult;
  error?: string;
}

/**
 * Server Action: Fetches personalized, real-time trend research for the authenticated creator.
 * Strictly verifies authenticated user session and ownership.
 * Operates at ₹0 budget via public, verifiable RSS and news sources.
 */
export async function getNicheTrendsAction(options?: {
  refresh?: boolean;
}): Promise<GetNicheTrendsActionResult> {
  const session = await verifySession();

  if (!session || !session.isAuth || !session.user || !session.user.id) {
    return {
      success: false,
      error: "Unauthorized. Please log in to access trend research.",
    };
  }

  try {
    const preferences = await getCreatorPreferences(session.user.id);

    const trendResult = await fetchCreatorTrends({
      niche: preferences.niche || "Content Creation",
      subNiches: preferences.subNiches,
      preferredFormats: preferences.preferredFormats,
      languages: preferences.languages,
    });

    return {
      success: true,
      result: trendResult,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve trend research.";
    return {
      success: false,
      error: `Trend research service error: ${message}`,
    };
  }
}
