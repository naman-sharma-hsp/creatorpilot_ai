import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const DEFAULT_STATE_TTL_MINUTES = 10;
export const CLEANUP_RETENTION_HOURS = 24;

export interface CreateOAuthStateOptions {
  userId: string;
  rawState?: string;
  ttlMinutes?: number;
  client?: SupabaseClient;
}

export interface CreateOAuthStateResult {
  rawState: string;
  stateHash: string;
  expiresAt: Date;
}

export interface ConsumeOAuthStateOptions {
  rawState: string;
  client?: SupabaseClient;
}

export interface ConsumeOAuthStateResult {
  userId: string;
}

export interface CleanupStatesOptions {
  olderThanHours?: number;
  client?: SupabaseClient;
}

export const MIN_STATE_LENGTH = 32;
export const MAX_STATE_LENGTH = 128;

/**
 * Validates the raw OAuth state string length and characters.
 * Rejects empty, too short, too long, or non-alphanumeric/unsupported characters.
 */
export function validateRawState(rawState: unknown): string {
  if (typeof rawState !== "string") {
    throw new Error("Invalid OAuth state: state must be a string.");
  }
  if (rawState.length < MIN_STATE_LENGTH || rawState.length > MAX_STATE_LENGTH) {
    throw new Error(
      `Invalid OAuth state: length must be between ${MIN_STATE_LENGTH} and ${MAX_STATE_LENGTH} characters.`
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(rawState)) {
    throw new Error("Invalid OAuth state: state contains invalid characters.");
  }
  return rawState;
}

/**
 * Generates a cryptographically secure 256-bit (32-byte) random hex string
 * for use as an OAuth state parameter.
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes a deterministic SHA-256 hash of a validated raw OAuth state string.
 * Only the hash is ever stored or queried in the database.
 */
export function hashOAuthState(rawState: string): string {
  const validatedState = validateRawState(rawState);
  return crypto.createHash("sha256").update(validatedState).digest("hex");
}

/**
 * Creates and stores a new OAuth state record in public.instagram_oauth_states.
 * - Stores only the SHA-256 hash, authenticated user_id, and 10-minute expiry.
 * - Opportunistically purges states expired more than 24 hours ago.
 * - Never logs or stores raw state values.
 */
export async function createOAuthStateRecord(
  options: CreateOAuthStateOptions
): Promise<CreateOAuthStateResult> {
  const { userId, rawState, ttlMinutes = DEFAULT_STATE_TTL_MINUTES, client } = options;

  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Cannot create OAuth state record: missing or invalid userId.");
  }

  const resolvedRawState = rawState ? validateRawState(rawState) : generateOAuthState();
  const stateHash = hashOAuthState(resolvedRawState);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const admin = client || createAdminClient();

  const { error } = await admin.from("instagram_oauth_states").insert({
    state_hash: stateHash,
    user_id: userId.trim(),
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error("Operational error: Database failed to record OAuth state.");
  }

  // Opportunistic cleanup: purge records expired more than 24 hours ago (non-blocking)
  cleanupExpiredOAuthStates({ client: admin }).catch(() => {
    // Non-critical background cleanup errors are safely swallowed
  });

  return {
    rawState: resolvedRawState,
    stateHash,
    expiresAt,
  };
}

/**
 * Atomically consumes an OAuth state record.
 * Requirements:
 * - Matching state_hash
 * - consumed_at IS NULL (never previously consumed)
 * - expires_at > now() (unexpired)
 *
 * This operation is strictly atomic (single-statement UPDATE ... RETURNING)
 * to eliminate race conditions and concurrent replay attacks.
 * Throws a sanitized error if the state is invalid, expired, unknown, or already consumed.
 * Distinguishes operational database outages from invalid state verification.
 * Never logs raw state or hash values.
 */
export async function consumeOAuthState(
  options: ConsumeOAuthStateOptions
): Promise<ConsumeOAuthStateResult> {
  const { rawState, client } = options;

  const validatedRawState = validateRawState(rawState);
  const stateHash = hashOAuthState(validatedRawState);
  const admin = client || createAdminClient();

  // 1. Attempt database RPC function for server-side atomic UPDATE ... RETURNING
  let isFunctionMissing = false;
  try {
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "consume_instagram_oauth_state",
      { p_state_hash: stateHash }
    );

    if (!rpcError) {
      if (Array.isArray(rpcData) && rpcData.length > 0) {
        const row = rpcData[0] as { user_id?: string };
        if (row?.user_id) {
          return { userId: row.user_id };
        }
      }
      // RPC executed successfully and returned 0 rows: state is invalid, expired, or consumed
      throw new Error("Invalid, expired, or already consumed OAuth state.");
    }

    // Inspect rpcError: only fall back if the function is missing in the database schema
    isFunctionMissing =
      rpcError.code === "PGRST202" ||
      rpcError.code === "42883" ||
      (typeof rpcError.message === "string" &&
        (rpcError.message.includes("could not find the function") ||
          (rpcError.message.includes("function") && rpcError.message.includes("does not exist"))));

    if (!isFunctionMissing) {
      // Genuine database or operational error (connection down, permission error, etc.)
      throw new Error("Operational error: Database unavailable for OAuth state verification.");
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (
        err.message === "Invalid, expired, or already consumed OAuth state." ||
        err.message.startsWith("Operational error:")
      ) {
        throw err;
      }
    }
    if (!isFunctionMissing) {
      throw new Error("Operational error: Database unavailable for OAuth state verification.");
    }
  }

  // 2. Direct atomic single-statement update fallback (if RPC function is not installed)
  const nowIso = new Date().toISOString();
  let updateResult;
  try {
    updateResult = await admin
      .from("instagram_oauth_states")
      .update({ consumed_at: nowIso })
      .eq("state_hash", stateHash)
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .select("user_id")
      .maybeSingle();
  } catch {
    throw new Error("Operational error: Database unavailable for OAuth state verification.");
  }

  const { data, error } = updateResult;

  if (error) {
    throw new Error("Operational error: Database unavailable for OAuth state verification.");
  }

  if (!data || !data.user_id) {
    throw new Error("Invalid, expired, or already consumed OAuth state.");
  }

  return { userId: data.user_id };
}

/**
 * Purges expired OAuth state records that passed their retention threshold.
 */
export async function cleanupExpiredOAuthStates(
  options: CleanupStatesOptions = {}
): Promise<number> {
  const { olderThanHours = CLEANUP_RETENTION_HOURS, client } = options;
  const admin = client || createAdminClient();

  const thresholdDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  // Attempt RPC cleanup if available
  try {
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "cleanup_expired_instagram_oauth_states"
    );
    if (!rpcError && typeof rpcData === "number") {
      return rpcData;
    }
  } catch {
    // Fall back to direct delete below
  }

  const { error } = await admin
    .from("instagram_oauth_states")
    .delete()
    .lt("expires_at", thresholdDate.toISOString());

  if (error) {
    return 0;
  }

  return 1;
}
