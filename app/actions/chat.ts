"use server";

import { verifySession } from "../lib/dal";
import { generateCreatorChatResponse } from "../lib/chat/service";
import type {
  CreatorChatInput,
  CreatorChatActionResult,
} from "../lib/definitions";

/**
 * Server Action: Generates a personalized conversational response for Creator AI Chat.
 * Strictly derives the authenticated user ID from the verified server session.
 * Employs gemini-3.5-flash-lite and enforces strict ₹0 budget constraints.
 */
export async function sendCreatorChatMessageAction(
  payload: unknown
): Promise<CreatorChatActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to interact with Creator AI Chat.",
    };
  }

  return generateCreatorChatResponse(session.user.id, payload as CreatorChatInput);
}
