import "server-only";

import { createClient } from "../supabase/server";
import type {
  ContentDraft,
  CreateDraftInput,
  UpdateDraftInput,
  DraftFormat,
  DraftStatus,
  DraftListFilter,
} from "../definitions";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const VALID_DRAFT_FORMATS: readonly DraftFormat[] = [
  "reel",
  "carousel",
  "post",
  "story",
] as const;

export const VALID_DRAFT_STATUSES: readonly DraftStatus[] = [
  "draft",
  "review",
  "scheduled",
  "published",
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_TITLE_LENGTH = 200;
export const MAX_CAPTION_LENGTH = 5000;
export const MAX_METADATA_KEYS = 50;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 30;

/**
 * Validates that a string is a standard UUID.
 */
export function isValidUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_REGEX.test(id.trim());
}

/**
 * Validates and sanitizes draft input fields.
 * Prevents injection of invalid formats, statuses, or dangerous metadata keys.
 */
export function validateDraftInput(
  input: unknown,
  isUpdate = false
): {
  isValid: boolean;
  errors: Record<string, string>;
  sanitized: {
    title?: string;
    caption?: string | null;
    format?: DraftFormat;
    status?: DraftStatus;
    scheduled_for?: string | null;
    metadata?: Record<string, unknown>;
  };
} {
  const errors: Record<string, string> = {};
  const sanitized: {
    title?: string;
    caption?: string | null;
    format?: DraftFormat;
    status?: DraftStatus;
    scheduled_for?: string | null;
    metadata?: Record<string, unknown>;
  } = {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      isValid: false,
      errors: { _root: "Draft payload must be a non-null object." },
      sanitized: {},
    };
  }

  const raw = input as Record<string, unknown>;

  // Title validation
  if (!isUpdate || raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim()) {
      errors.title = "Draft title is required and cannot be empty.";
    } else if (raw.title.trim().length > MAX_TITLE_LENGTH) {
      errors.title = `Draft title cannot exceed ${MAX_TITLE_LENGTH} characters.`;
    } else {
      sanitized.title = raw.title.trim();
    }
  }

  // Caption validation
  if (raw.caption !== undefined) {
    if (raw.caption === null || raw.caption === "") {
      sanitized.caption = null;
    } else if (typeof raw.caption !== "string") {
      errors.caption = "Caption must be a string or null.";
    } else if (raw.caption.length > MAX_CAPTION_LENGTH) {
      errors.caption = `Caption cannot exceed ${MAX_CAPTION_LENGTH} characters.`;
    } else {
      sanitized.caption = raw.caption;
    }
  }

  // Format validation
  if (!isUpdate || raw.format !== undefined) {
    if (typeof raw.format !== "string" || !VALID_DRAFT_FORMATS.includes(raw.format as DraftFormat)) {
      errors.format = `Format must be one of: ${VALID_DRAFT_FORMATS.join(", ")}.`;
    } else {
      sanitized.format = raw.format as DraftFormat;
    }
  }

  // Status validation
  if (raw.status !== undefined) {
    if (typeof raw.status !== "string" || !VALID_DRAFT_STATUSES.includes(raw.status as DraftStatus)) {
      errors.status = `Status must be one of: ${VALID_DRAFT_STATUSES.join(", ")}.`;
    } else {
      sanitized.status = raw.status as DraftStatus;
    }
  } else if (!isUpdate) {
    sanitized.status = "draft";
  }

  // Scheduled date validation
  if (raw.scheduled_for !== undefined) {
    if (raw.scheduled_for === null || raw.scheduled_for === "") {
      sanitized.scheduled_for = null;
    } else if (typeof raw.scheduled_for === "string") {
      const parsedDate = new Date(raw.scheduled_for);
      if (isNaN(parsedDate.getTime())) {
        errors.scheduled_for = "Invalid scheduled date timestamp.";
      } else {
        sanitized.scheduled_for = parsedDate.toISOString();
      }
    } else {
      errors.scheduled_for = "Scheduled date must be an ISO string or null.";
    }
  }

  // Metadata validation: protect against field escalation and excessive nested payload
  if (raw.metadata !== undefined) {
    if (raw.metadata === null) {
      sanitized.metadata = {};
    } else if (typeof raw.metadata !== "object" || Array.isArray(raw.metadata)) {
      errors.metadata = "Metadata must be a plain JSON object.";
    } else {
      const metaObj = raw.metadata as Record<string, unknown>;
      const keys = Object.keys(metaObj);
      if (keys.length > MAX_METADATA_KEYS) {
        errors.metadata = `Metadata cannot exceed ${MAX_METADATA_KEYS} keys.`;
      } else {
        // Strip protected database keys from metadata to avoid ambiguity
        const cleanMeta: Record<string, unknown> = {};
        const forbiddenKeys = new Set(["id", "user_id", "created_at", "updated_at"]);
        for (const [k, v] of Object.entries(metaObj)) {
          if (!forbiddenKeys.has(k) && typeof k === "string" && k.length <= 60) {
            cleanMeta[k] = v;
          }
        }
        sanitized.metadata = cleanMeta;
      }
    }
  } else if (!isUpdate) {
    sanitized.metadata = {};
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}

/**
 * Lists the authenticated user's drafts with optional format/status filtering.
 * Enforces strict per-user ownership and RLS.
 */
export async function listDrafts(
  userId: string,
  filter: DraftListFilter = {}
): Promise<{ success: boolean; drafts: ContentDraft[]; total?: number; error?: string }> {
  if (!isValidUuid(userId)) {
    return { success: false, drafts: [], error: "Unauthorized: Invalid user identifier." };
  }

  try {
    const supabase = await createClient();
    let query = supabase
      .from("content_drafts")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (filter.format && VALID_DRAFT_FORMATS.includes(filter.format)) {
      query = query.eq("format", filter.format);
    }

    if (filter.status && VALID_DRAFT_STATUSES.includes(filter.status)) {
      query = query.eq("status", filter.status);
    }

    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const offset = Math.max(filter.offset ?? 0, 0);

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return { success: false, drafts: [], error: "Unable to retrieve drafts at this time." };
    }

    return {
      success: true,
      drafts: (data as ContentDraft[]) || [],
      total: count ?? undefined,
    };
  } catch {
    return { success: false, drafts: [], error: "Database error while fetching drafts." };
  }
}

/**
 * Fetches a single draft by ID, ensuring it belongs to the authenticated user.
 */
export async function getDraftById(
  userId: string,
  draftId: string
): Promise<{ success: boolean; draft?: ContentDraft; error?: string }> {
  if (!isValidUuid(userId)) {
    return { success: false, error: "Unauthorized: Invalid user identifier." };
  }
  if (!isValidUuid(draftId)) {
    return { success: false, error: "Invalid draft identifier." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("content_drafts")
      .select("*")
      .eq("id", draftId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return { success: false, error: "Unable to retrieve draft." };
    }

    if (!data) {
      return { success: false, error: "Draft not found or access denied." };
    }

    return { success: true, draft: data as ContentDraft };
  } catch {
    return { success: false, error: "Database error while fetching draft." };
  }
}

/**
 * Creates a new draft for the authenticated user.
 * Explicitly binds user_id on the server.
 */
export async function createDraft(
  userId: string,
  input: CreateDraftInput
): Promise<{ success: boolean; draft?: ContentDraft; error?: string; fieldErrors?: Record<string, string> }> {
  if (!isValidUuid(userId)) {
    return { success: false, error: "Unauthorized: Invalid user identifier." };
  }

  const { isValid, errors, sanitized } = validateDraftInput(input, false);
  if (!isValid || !sanitized.title || !sanitized.format) {
    return {
      success: false,
      error: Object.values(errors)[0] || "Invalid draft input.",
      fieldErrors: errors,
    };
  }

  try {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();

    const insertPayload = {
      user_id: userId,
      title: sanitized.title,
      caption: sanitized.caption ?? null,
      format: sanitized.format,
      status: sanitized.status ?? "draft",
      scheduled_for: sanitized.scheduled_for ?? null,
      metadata: sanitized.metadata ?? {},
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from("content_drafts")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error || !data) {
      return { success: false, error: "Failed to persist draft to database." };
    }

    return { success: true, draft: data as ContentDraft };
  } catch {
    return { success: false, error: "Database error while creating draft." };
  }
}

/**
 * Updates an existing draft for the authenticated user.
 * Constrains the update strictly by both draftId and user_id.
 * Safely handles zero affected rows.
 */
export async function updateDraft(
  userId: string,
  draftId: string,
  input: UpdateDraftInput
): Promise<{ success: boolean; draft?: ContentDraft; error?: string; fieldErrors?: Record<string, string> }> {
  if (!isValidUuid(userId)) {
    return { success: false, error: "Unauthorized: Invalid user identifier." };
  }
  if (!isValidUuid(draftId)) {
    return { success: false, error: "Invalid draft identifier." };
  }

  const { isValid, errors, sanitized } = validateDraftInput(input, true);
  if (!isValid) {
    return {
      success: false,
      error: Object.values(errors)[0] || "Invalid draft update payload.",
      fieldErrors: errors,
    };
  }

  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (sanitized.title !== undefined) updateFields.title = sanitized.title;
  if (sanitized.caption !== undefined) updateFields.caption = sanitized.caption;
  if (sanitized.format !== undefined) updateFields.format = sanitized.format;
  if (sanitized.status !== undefined) updateFields.status = sanitized.status;
  if (sanitized.scheduled_for !== undefined) updateFields.scheduled_for = sanitized.scheduled_for;
  if (sanitized.metadata !== undefined) updateFields.metadata = sanitized.metadata;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("content_drafts")
      .update(updateFields)
      .eq("id", draftId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      return { success: false, error: "Failed to update draft." };
    }

    if (!data) {
      return { success: false, error: "Draft not found or you do not have permission to modify it." };
    }

    return { success: true, draft: data as ContentDraft };
  } catch {
    return { success: false, error: "Database error while updating draft." };
  }
}

/**
 * Deletes a draft owned by the authenticated user.
 * Constrains delete strictly by draftId and user_id.
 * Detects zero affected rows.
 */
export async function deleteDraft(
  userId: string,
  draftId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isValidUuid(userId)) {
    return { success: false, error: "Unauthorized: Invalid user identifier." };
  }
  if (!isValidUuid(draftId)) {
    return { success: false, error: "Invalid draft identifier." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("content_drafts")
      .delete()
      .eq("id", draftId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      return { success: false, error: "Failed to delete draft." };
    }

    if (!data) {
      return { success: false, error: "Draft not found or you do not have permission to delete it." };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Database error while deleting draft." };
  }
}
