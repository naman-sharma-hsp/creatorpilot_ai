"use server";

import { verifySession } from "../lib/dal";
import { generatePersonalizedCaption } from "../lib/ai-studio/service";
import { generateContentIdeas } from "../lib/ideas/service";
import { generateCarouselDeck } from "../lib/carousels/service";
import { repurposeContent } from "../lib/repurposing/service";
import type {
  GenerateCaptionInput,
  GenerateCaptionActionResult,
  GenerateIdeasInput,
  GenerateIdeasActionResult,
  GenerateCarouselInput,
  GenerateCarouselActionResult,
  GenerateRepurposeInput,
  GenerateRepurposeActionResult,
} from "../lib/definitions";

/**
 * Server Action: Generates a personalized Instagram caption using Gemini.
 * Strictly derives the authenticated user ID from the verified server session.
 * Enforces ₹0 budget safeguards and truthful quota messaging.
 */
export async function generateCaptionAction(
  payload: unknown
): Promise<GenerateCaptionActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to generate personalized captions.",
    };
  }

  return generatePersonalizedCaption(session.user.id, payload as GenerateCaptionInput);
}

/**
 * Server Action: Generates 3 personalized post/Reel concepts with hooks and script outlines.
 * Strictly derives the authenticated user ID from the verified server session.
 * Enforces ₹0 budget safeguards and truthful quota messaging.
 */
export async function generateIdeasAction(
  payload?: unknown
): Promise<GenerateIdeasActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to generate content ideas.",
    };
  }

  return generateContentIdeas(session.user.id, (payload || {}) as GenerateIdeasInput);
}

/**
 * Server Action: Generates a structured 5, 7, or 10-slide Instagram carousel deck with companion caption.
 * Strictly derives the authenticated user ID from the verified server session.
 * Enforces ₹0 budget safeguards and truthful quota messaging.
 */
export async function generateCarouselAction(
  payload: unknown
): Promise<GenerateCarouselActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to generate carousel decks.",
    };
  }

  return generateCarouselDeck(session.user.id, payload as GenerateCarouselInput);
}

/**
 * Server Action: Rewrites, refines, or transforms existing content into multi-format Instagram assets.
 * Strictly derives the authenticated user ID from the verified server session.
 * Enforces ₹0 budget safeguards and truthful quota messaging.
 */
export async function repurposeContentAction(
  payload: unknown
): Promise<GenerateRepurposeActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to repurpose content.",
    };
  }

  return repurposeContent(session.user.id, payload as GenerateRepurposeInput);
}
