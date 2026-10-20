import "server-only";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifySession } from "../dal";
import { createAdminClient } from "../supabase/admin";
import { consumeOAuthState, createOAuthStateRecord, validateRawState } from "./oauth-state";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
} from "./client";
import { encryptToken, validateEncryptionKey } from "./crypto";
import {
  getTrustedAppOrigin,
  getTrustedCallbackUri,
  INSTAGRAM_CALLBACK_PATH,
} from "./oauth-url";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const STATE_COOKIE_NAME = "ig_oauth_state";
export const STATE_COOKIE_PATH = INSTAGRAM_CALLBACK_PATH;
export const STATE_COOKIE_MAX_AGE = 600; // 10 minutes in seconds
export const INSTAGRAM_OAUTH_AUTHORIZE_URL = "https://api.instagram.com/oauth/authorize";
export const INSTAGRAM_OAUTH_SCOPE =
  "instagram_business_basic,instagram_business_manage_insights";

export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createCleanRedirect(
  targetUrl: string | URL,
  isProduction: boolean = process.env.NODE_ENV === "production"
): NextResponse {
  const res = NextResponse.redirect(targetUrl);
  res.cookies.set(STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: 0,
    expires: new Date(0),
    secure: isProduction,
  });
  return res;
}

// -----------------------------------------------------------------------------
// 1. INITIATION HANDLER
// -----------------------------------------------------------------------------

export interface InstagramAuthHandlerOptions {
  verifySessionFn?: typeof verifySession;
  createOAuthStateRecordFn?: typeof createOAuthStateRecord;
  appId?: string;
  appSecret?: string;
  encryptionKey?: string;
  serviceRoleKey?: string;
  appUrl?: string;
}

export async function handleInstagramAuth(
  request: NextRequest,
  options?: InstagramAuthHandlerOptions
): Promise<NextResponse> {
  // 1. Resolve trusted server origin and exact callback URI from APP_URL
  let origin: string;
  let redirectUri: string;
  try {
    origin = getTrustedAppOrigin({ appUrl: options?.appUrl });
    redirectUri = getTrustedCallbackUri({ appUrl: options?.appUrl });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "APP_URL server configuration error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // 2. Require an authenticated Supabase user
  const verifyFn = options?.verifySessionFn || verifySession;
  const session = await verifyFn();

  if (!session.isAuth || !session.user || !session.user.id) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  // 3. Validate required server environment variables
  const appId = options?.appId || process.env.INSTAGRAM_APP_ID;
  const appSecret = options?.appSecret || process.env.INSTAGRAM_APP_SECRET;
  const encryptionKey = options?.encryptionKey || process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  const serviceRoleKey = options?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!appId || !appSecret || !encryptionKey || !serviceRoleKey) {
    return NextResponse.redirect(new URL("/dashboard?error=instagram_config_error", origin));
  }

  try {
    validateEncryptionKey(encryptionKey);
  } catch {
    return NextResponse.redirect(new URL("/dashboard?error=instagram_config_error", origin));
  }

  // 4. Generate state and persist record in public.instagram_oauth_states
  const createStateFn = options?.createOAuthStateRecordFn || createOAuthStateRecord;
  let rawState: string;
  try {
    const stateRecord = await createStateFn({ userId: session.user.id });
    rawState = stateRecord.rawState;
  } catch {
    return NextResponse.redirect(new URL("/dashboard?error=instagram_database_error", origin));
  }

  // 5. Construct the official Meta authorization URL
  const authUrl = new URL(INSTAGRAM_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", INSTAGRAM_OAUTH_SCOPE);
  authUrl.searchParams.set("state", rawState);

  // 6. Set HttpOnly, SameSite=Lax, Path=/api/auth/instagram/callback, Max-Age=600 state cookie
  const isProduction = process.env.NODE_ENV === "production";
  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(STATE_COOKIE_NAME, rawState, {
    httpOnly: true,
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_COOKIE_MAX_AGE,
    secure: isProduction,
  });

  return response;
}

// -----------------------------------------------------------------------------
// 2. CALLBACK HANDLER
// -----------------------------------------------------------------------------

export interface InstagramCallbackHandlerOptions {
  verifySessionFn?: typeof verifySession;
  consumeOAuthStateFn?: typeof consumeOAuthState;
  exchangeCodeFn?: typeof exchangeCodeForShortLivedToken;
  exchangeLongLivedFn?: typeof exchangeForLongLivedToken;
  fetchProfileFn?: typeof fetchInstagramProfile;
  encryptTokenFn?: typeof encryptToken;
  adminClient?: SupabaseClient;
  appId?: string;
  appSecret?: string;
  encryptionKey?: string;
  appUrl?: string;
  fetchFn?: typeof fetch;
  isProduction?: boolean;
}

export async function handleInstagramCallback(
  request: NextRequest,
  options?: InstagramCallbackHandlerOptions
): Promise<NextResponse> {
  const isProduction = options?.isProduction ?? (process.env.NODE_ENV === "production");

  // 1. Resolve trusted server origin and exact callback URI from APP_URL
  let origin: string;
  let redirectUri: string;
  try {
    origin = getTrustedAppOrigin({
      appUrl: options?.appUrl,
      isProduction,
    });
    redirectUri = getTrustedCallbackUri({
      appUrl: options?.appUrl,
      isProduction,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "APP_URL server configuration error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const cleanRedirect = (url: URL) => createCleanRedirect(url, isProduction);

  // 2. Read callback state from query and HttpOnly cookie
  const searchParams = request.nextUrl.searchParams;
  const queryState = searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE_NAME)?.value;

  // 3. Reject missing or malformed values and verify constant-time match
  if (!queryState || !cookieState) {
    return cleanRedirect(new URL("/dashboard?error=instagram_invalid_state", origin));
  }

  try {
    validateRawState(queryState);
    validateRawState(cookieState);
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_invalid_state", origin));
  }

  if (!timingSafeEqualString(queryState, cookieState)) {
    return cleanRedirect(new URL("/dashboard?error=instagram_state_mismatch", origin));
  }

  // 4. Atomically consume OAuth state in database
  const consumeFn = options?.consumeOAuthStateFn || consumeOAuthState;
  let stateUserId: string;
  try {
    const result = await consumeFn({ rawState: queryState, client: options?.adminClient });
    stateUserId = result.userId;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Operational error:")) {
      return cleanRedirect(new URL("/dashboard?error=instagram_database_error", origin));
    }
    return cleanRedirect(new URL("/dashboard?error=instagram_state_expired", origin));
  }

  // 5. Require currently authenticated Supabase user & verify session user matches state user
  const verifyFn = options?.verifySessionFn || verifySession;
  const session = await verifyFn();

  if (!session || !session.isAuth || !session.user || !session.user.id) {
    return cleanRedirect(new URL("/login?error=session_expired", origin));
  }

  if (session.user.id !== stateUserId) {
    return cleanRedirect(new URL("/dashboard?error=instagram_session_mismatch", origin));
  }

  // 6. Only after state and session validation, process authorization denial or exchange code
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");
  if (error || errorReason) {
    if (error === "access_denied" || errorReason === "user_denied") {
      return cleanRedirect(new URL("/dashboard?error=instagram_cancelled", origin));
    }
    return cleanRedirect(new URL("/dashboard?error=instagram_denied", origin));
  }

  const rawCode = searchParams.get("code");
  if (!rawCode || !rawCode.trim()) {
    return cleanRedirect(new URL("/dashboard?error=instagram_missing_code", origin));
  }
  const code = rawCode.replace(/#_$/, "").trim();

  // Validate server configuration before token exchange
  const appId = options?.appId || process.env.INSTAGRAM_APP_ID;
  const appSecret = options?.appSecret || process.env.INSTAGRAM_APP_SECRET;
  const encryptionKey = options?.encryptionKey || process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;

  if (!appId || !appSecret || !encryptionKey) {
    return cleanRedirect(new URL("/dashboard?error=instagram_config_error", origin));
  }

  try {
    validateEncryptionKey(encryptionKey);
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_config_error", origin));
  }

  // Token exchange: short-lived -> long-lived -> profile
  const exchangeCodeFn = options?.exchangeCodeFn || exchangeCodeForShortLivedToken;
  let shortLived;
  try {
    shortLived = await exchangeCodeFn({
      code,
      redirectUri,
      appId,
      appSecret,
      fetchFn: options?.fetchFn,
    });
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_exchange_failed", origin));
  }

  const exchangeLongLivedFn = options?.exchangeLongLivedFn || exchangeForLongLivedToken;
  let longLived;
  try {
    longLived = await exchangeLongLivedFn({
      shortLivedToken: shortLived.accessToken,
      appSecret,
      fetchFn: options?.fetchFn,
    });
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_exchange_failed", origin));
  }

  const fetchProfileFn = options?.fetchProfileFn || fetchInstagramProfile;
  let profile;
  try {
    profile = await fetchProfileFn({
      accessToken: longLived.accessToken,
      fetchFn: options?.fetchFn,
    });
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_invalid_profile", origin));
  }

  if (!profile.id || !profile.username) {
    return cleanRedirect(new URL("/dashboard?error=instagram_invalid_profile", origin));
  }

  const platformUserId = profile.userId || profile.id;

  // Encrypt long-lived token
  const encryptFn = options?.encryptTokenFn || encryptToken;
  let encryptedToken: string;
  try {
    encryptedToken = encryptFn(longLived.accessToken, encryptionKey);
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_encryption_error", origin));
  }

  // Database persistence with conflict isolation
  let admin: SupabaseClient;
  try {
    admin = options?.adminClient || createAdminClient();
  } catch {
    return cleanRedirect(new URL("/dashboard?error=instagram_database_error", origin));
  }

  // Step A: Check for cross-user platform account conflict
  const { data: conflictRow, error: checkError } = await admin
    .from("connected_accounts")
    .select("id, user_id")
    .eq("platform", "instagram")
    .eq("platform_user_id", platformUserId)
    .maybeSingle();

  if (checkError) {
    return cleanRedirect(new URL("/dashboard?error=instagram_database_error", origin));
  }

  if (conflictRow && conflictRow.user_id !== session.user.id) {
    return cleanRedirect(new URL("/dashboard?error=instagram_account_conflict", origin));
  }

  // Step B: Check if current user already has an Instagram connection
  const { data: existingUserAccount, error: userAccountError } = await admin
    .from("connected_accounts")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("platform", "instagram")
    .maybeSingle();

  if (userAccountError) {
    return cleanRedirect(new URL("/dashboard?error=instagram_database_error", origin));
  }

  const nowIso = new Date().toISOString();
  const scopes =
    shortLived.permissions && shortLived.permissions.length > 0
      ? shortLived.permissions
      : ["instagram_business_basic", "instagram_business_manage_insights"];

  const metadata = {
    name: profile.name || null,
    account_type: profile.accountType || null,
    profile_picture_url: profile.profilePictureUrl || null,
  };

  let accountId: string;
  let isNewAccount = false;

  if (existingUserAccount) {
    accountId = existingUserAccount.id;
    const { error: updateError } = await admin
      .from("connected_accounts")
      .update({
        platform_user_id: platformUserId,
        username: profile.username,
        status: "connected",
        scopes,
        metadata,
        connected_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", accountId);

    if (updateError) {
      if (updateError.code === "23505") {
        return cleanRedirect(new URL("/dashboard?error=instagram_account_conflict", origin));
      }
      return cleanRedirect(new URL("/dashboard?error=instagram_database_error", origin));
    }
  } else {
    isNewAccount = true;
    const { data: newAccount, error: insertError } = await admin
      .from("connected_accounts")
      .insert({
        user_id: session.user.id,
        platform: "instagram",
        platform_user_id: platformUserId,
        username: profile.username,
        status: "connected",
        scopes,
        metadata,
        connected_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (insertError || !newAccount) {
      if (insertError?.code === "23505") {
        return cleanRedirect(new URL("/dashboard?error=instagram_account_conflict", origin));
      }
      return cleanRedirect(new URL("/dashboard?error=instagram_database_error", origin));
    }
    accountId = newAccount.id;
  }

  // Step C: Persist encrypted credentials
  const { error: credError } = await admin.from("account_credentials").upsert({
    account_id: accountId,
    encrypted_token: encryptedToken,
    token_type: longLived.tokenType || "bearer",
    expires_at: longLived.expiresAt.toISOString(),
    scopes,
    updated_at: nowIso,
  });

  if (credError) {
    // Isolate failure: do not leave a phantom 'connected' status without credentials
    if (isNewAccount) {
      try {
        await admin.from("connected_accounts").delete().eq("id", accountId);
      } catch {
        // Safe fallback
      }
    } else {
      try {
        await admin
          .from("connected_accounts")
          .update({ status: "disconnected", updated_at: new Date().toISOString() })
          .eq("id", accountId);
      } catch {
        // Safe fallback
      }
    }
    return cleanRedirect(new URL("/dashboard?error=instagram_storage_error", origin));
  }

  // Step D: Synchronize verified Instagram username and profile picture into public.profiles
  try {
    const profileUpdates: Record<string, unknown> = {
      creator_handle: profile.username,
      updated_at: nowIso,
    };
    if (profile.profilePictureUrl) {
      profileUpdates.avatar_url = profile.profilePictureUrl;
    }
    await admin
      .from("profiles")
      .update(profileUpdates)
      .eq("id", session.user.id);
  } catch {
    // Non-fatal if profile sync encounters transient error
  }

  return cleanRedirect(new URL("/dashboard?success=instagram_connected", origin));
}

// -----------------------------------------------------------------------------
// 3. STATUS HANDLER
// -----------------------------------------------------------------------------

export interface InstagramStatusHandlerOptions {
  verifySessionFn?: typeof verifySession;
  adminClient?: SupabaseClient;
  nowMs?: number;
}

export interface InstagramStatusResponse {
  connected: boolean;
  status: "connected" | "disconnected" | "expired";
  username?: string | null;
  platformUserId?: string | null;
  scopes?: string[];
  connectedAt?: string | null;
  expiresAt?: string | null;
  isExpired?: boolean;
  profile?: Record<string, unknown>;
}

export async function handleInstagramStatus(
  request: NextRequest,
  options?: InstagramStatusHandlerOptions
): Promise<NextResponse> {
  // 1. Enforce authenticated user session
  const verifyFn = options?.verifySessionFn || verifySession;
  const session = await verifyFn();

  if (!session || !session.isAuth || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve server-only administrative client
  let admin: SupabaseClient;
  try {
    admin = options?.adminClient || createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Failed to retrieve Instagram connection status." },
      { status: 500 }
    );
  }

  // 3. Query user's connected account metadata strictly scoped to session.user.id
  const { data: account, error: accountError } = await admin
    .from("connected_accounts")
    .select("id, user_id, platform, platform_user_id, username, status, scopes, metadata, connected_at")
    .eq("user_id", session.user.id)
    .eq("platform", "instagram")
    .maybeSingle();

  if (accountError) {
    return NextResponse.json(
      { error: "Failed to retrieve Instagram connection status." },
      { status: 500 }
    );
  }

  if (!account || account.status === "disconnected") {
    return NextResponse.json({
      connected: false,
      status: "disconnected",
    });
  }

  // 4. Retrieve credential expiration date (NEVER returning the encrypted_token)
  const { data: creds, error: credsError } = await admin
    .from("account_credentials")
    .select("expires_at, scopes")
    .eq("account_id", account.id)
    .maybeSingle();

  if (credsError) {
    return NextResponse.json(
      { error: "Failed to retrieve Instagram connection status." },
      { status: 500 }
    );
  }

  const now = options?.nowMs ? new Date(options.nowMs) : new Date();
  const expiresAtDate = creds?.expires_at ? new Date(creds.expires_at) : null;
  const isExpired = expiresAtDate ? expiresAtDate.getTime() <= now.getTime() : false;

  if (isExpired && account.status !== "expired") {
    try {
      await admin
        .from("connected_accounts")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", account.id);
    } catch {
      // Safe fallback
    }
  }

  const responsePayload: InstagramStatusResponse = {
    connected: !isExpired,
    status: isExpired ? "expired" : "connected",
    username: account.username,
    platformUserId: account.platform_user_id,
    scopes: account.scopes || creds?.scopes || [],
    connectedAt: account.connected_at,
    expiresAt: creds?.expires_at || null,
    isExpired,
    profile: (account.metadata as Record<string, unknown>) || {},
  };

  return NextResponse.json(responsePayload, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}

// -----------------------------------------------------------------------------
// 4. DISCONNECT HANDLER
// -----------------------------------------------------------------------------

export interface InstagramDisconnectHandlerOptions {
  verifySessionFn?: typeof verifySession;
  adminClient?: SupabaseClient;
}

export interface InstagramDisconnectResponse {
  success: boolean;
  status: "disconnected";
  message: string;
}

export async function handleInstagramDisconnect(
  request: NextRequest,
  options?: InstagramDisconnectHandlerOptions
): Promise<NextResponse> {
  const isProduction = process.env.NODE_ENV === "production";

  // 1. Enforce authenticated user session
  const verifyFn = options?.verifySessionFn || verifySession;
  const session = await verifyFn();

  if (!session || !session.isAuth || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve server-only administrative client
  let admin: SupabaseClient;
  try {
    admin = options?.adminClient || createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Failed to disconnect Instagram account." },
      { status: 500 }
    );
  }

  // 3. Find user's connected account strictly scoped to session.user.id
  const { data: account, error: accountError } = await admin
    .from("connected_accounts")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("platform", "instagram")
    .maybeSingle();

  if (accountError) {
    return NextResponse.json(
      { error: "Failed to disconnect Instagram account." },
      { status: 500 }
    );
  }

  if (!account) {
    const response = NextResponse.json<InstagramDisconnectResponse>({
      success: true,
      status: "disconnected",
      message: "No connected Instagram account found.",
    });

    response.cookies.set(STATE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      path: STATE_COOKIE_PATH,
      maxAge: 0,
      expires: new Date(0),
      secure: isProduction,
    });

    return response;
  }

  // 4. Purge stored encrypted credentials
  const { error: deleteCredsError } = await admin
    .from("account_credentials")
    .delete()
    .eq("account_id", account.id);

  if (deleteCredsError) {
    return NextResponse.json(
      { error: "Failed to revoke account credentials." },
      { status: 500 }
    );
  }

  // 5. Delete connected_accounts record
  const { error: deleteAccountError } = await admin
    .from("connected_accounts")
    .delete()
    .eq("id", account.id)
    .eq("user_id", session.user.id);

  if (deleteAccountError) {
    return NextResponse.json(
      { error: "Failed to remove connected account record." },
      { status: 500 }
    );
  }

  // 6. Return response and ensure any residual state cookie is invalidated
  const response = NextResponse.json<InstagramDisconnectResponse>({
    success: true,
    status: "disconnected",
    message: "Instagram account disconnected successfully.",
  });

  response.cookies.set(STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: 0,
    expires: new Date(0),
    secure: isProduction,
  });

  return response;
}
