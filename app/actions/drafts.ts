"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "../lib/dal";
import {
  createDraft,
  updateDraft,
  deleteDraft,
  listDrafts,
  getDraftById,
} from "../lib/drafts/service";
import type {
  CreateDraftInput,
  UpdateDraftInput,
  DraftActionResult,
  DraftListFilter,
} from "../lib/definitions";

/**
 * Server Action: Lists drafts belonging to the authenticated user.
 */
export async function listDraftsAction(
  filter?: DraftListFilter
): Promise<DraftActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to view content drafts.",
      drafts: [],
    };
  }

  const result = await listDrafts(session.user.id, filter);
  if (!result.success) {
    return {
      success: false,
      error: result.error || "Failed to retrieve drafts.",
      drafts: [],
    };
  }

  return {
    success: true,
    drafts: result.drafts,
    total: result.total,
  };
}

/**
 * Server Action: Retrieves a single draft by ID for the authenticated user.
 */
export async function getDraftAction(
  draftId: string
): Promise<DraftActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to view content draft.",
    };
  }

  const result = await getDraftById(session.user.id, draftId);
  if (!result.success || !result.draft) {
    return {
      success: false,
      error: result.error || "Draft not found or access denied.",
    };
  }

  return {
    success: true,
    draft: result.draft,
  };
}

/**
 * Server Action: Creates a new content draft for the authenticated user.
 * Explicitly binds user_id from the verified session. Never trusts client-supplied owner ID.
 */
export async function createDraftAction(
  payload: CreateDraftInput
): Promise<DraftActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to create a content draft.",
    };
  }

  const result = await createDraft(session.user.id, payload);
  if (!result.success || !result.draft) {
    return {
      success: false,
      error: result.error || "Failed to create draft.",
      fieldErrors: result.fieldErrors,
    };
  }

  revalidatePath("/");
  return {
    success: true,
    message: "Draft saved successfully.",
    draft: result.draft,
  };
}

/**
 * Server Action: Updates an existing draft owned by the authenticated user.
 */
export async function updateDraftAction(
  draftId: string,
  payload: UpdateDraftInput
): Promise<DraftActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to update content draft.",
    };
  }

  const result = await updateDraft(session.user.id, draftId, payload);
  if (!result.success || !result.draft) {
    return {
      success: false,
      error: result.error || "Failed to update draft.",
      fieldErrors: result.fieldErrors,
    };
  }

  revalidatePath("/");
  return {
    success: true,
    message: "Draft updated successfully.",
    draft: result.draft,
  };
}

/**
 * Server Action: Deletes a draft owned by the authenticated user.
 */
export async function deleteDraftAction(
  draftId: string
): Promise<DraftActionResult> {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return {
      success: false,
      error: "Authentication required to delete content draft.",
    };
  }

  const result = await deleteDraft(session.user.id, draftId);
  if (!result.success) {
    return {
      success: false,
      error: result.error || "Failed to delete draft.",
    };
  }

  revalidatePath("/");
  return {
    success: true,
    message: "Draft deleted.",
  };
}
