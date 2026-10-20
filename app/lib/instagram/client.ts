import "server-only";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const DEFAULT_GRAPH_API_VERSION = "v26.0";
export const MINIMUM_SUPPORTED_GRAPH_API_MAJOR = 21;
export const SUPPORTED_GRAPH_API_VERSIONS = [
  "v21.0",
  "v22.0",
  "v23.0",
  "v24.0",
  "v25.0",
  "v26.0",
] as const;

export type SupportedGraphApiVersion = (typeof SUPPORTED_GRAPH_API_VERSIONS)[number];

const OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_API_BASE_URL = "https://graph.instagram.com";
const DEFAULT_TIMEOUT_MS = 10000;

export interface ShortLivedTokenResponse {
  accessToken: string;
  userId: string;
  permissions: string[];
}

export interface LongLivedTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: Date;
}

export interface RefreshedTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: Date;
}

export interface InstagramProfile {
  id: string; // App-scoped user ID
  userId?: string; // Instagram professional account ID (<IG_ID>)
  username: string; // Instagram username/handle
  name?: string; // User's name
  accountType?: string; // "BUSINESS" or "MEDIA_CREATOR"
  profilePictureUrl?: string; // Public avatar URL
}

export interface ExchangeCodeOptions {
  code: string;
  redirectUri: string;
  appId?: string;
  appSecret?: string;
  fetchFn?: typeof fetch;
}

export interface ExchangeLongLivedOptions {
  shortLivedToken: string;
  appSecret?: string;
  fetchFn?: typeof fetch;
}

export interface FetchProfileOptions {
  accessToken: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
}

export interface RefreshTokenOptions {
  longLivedToken: string;
  tokenIssuedAt?: Date | string | number;
  tokenExpiresAt?: Date | string | number;
  fetchFn?: typeof fetch;
}

/**
 * Validates and resolves the Meta Graph API version.
 * Checks explicit parameter, falls back to INSTAGRAM_GRAPH_API_VERSION env var if configured,
 * or DEFAULT_GRAPH_API_VERSION ("v26.0").
 * Fails securely if an explicit parameter or environment variable is missing (when required),
 * malformed, or references an outdated/sunset version (< v21.0). Never silently falls back.
 */
export function validateApiVersion(version?: string): string {
  let candidate: string;

  if (version !== undefined) {
    if (typeof version !== "string" || !version.trim()) {
      throw new Error(
        "Invalid Meta API version: version parameter cannot be empty."
      );
    }
    candidate = version.trim();
  } else if (
    process.env.INSTAGRAM_GRAPH_API_VERSION !== undefined &&
    process.env.INSTAGRAM_GRAPH_API_VERSION !== "undefined"
  ) {
    const envVersion = process.env.INSTAGRAM_GRAPH_API_VERSION;
    if (typeof envVersion !== "string" || !envVersion.trim()) {
      throw new Error(
        "Invalid Meta API version: INSTAGRAM_GRAPH_API_VERSION is configured but empty."
      );
    }
    candidate = envVersion.trim();
  } else {
    candidate = DEFAULT_GRAPH_API_VERSION;
  }

  const match = candidate.match(/^v(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(
      `Invalid Meta API version format: '${candidate}'. Expected format like 'v26.0'.`
    );
  }

  const major = parseInt(match[1], 10);
  if (major < MINIMUM_SUPPORTED_GRAPH_API_MAJOR) {
    throw new Error(
      `Unsupported Meta Graph API version '${candidate}'. Versions older than v${MINIMUM_SUPPORTED_GRAPH_API_MAJOR}.0 have been sunset by Meta.`
    );
  }

  return candidate;
}

/**
 * Sanitizes Meta API error responses so that raw tokens or secrets are never exposed in error messages.
 */
function parseSanitizedError(status: number, data: unknown): Error {
  if (data && typeof data === "object") {
    const errorObj = (data as { error?: { message?: string; type?: string; code?: number; error_subcode?: number } }).error;
    if (errorObj && typeof errorObj === "object") {
      const code = errorObj.code ? ` (code ${errorObj.code})` : "";
      const subcode = errorObj.error_subcode ? ` (subcode ${errorObj.error_subcode})` : "";
      const rawMessage = errorObj.message || "Meta API request failed";
      // Redact parameter query formats (e.g. access_token=..., client_secret=...) and long token-like strings
      const sanitizedMessage = rawMessage
        .replace(/(access_token|client_secret|code)=[^&\s]+/gi, "$1=[REDACTED]")
        .replace(/([a-zA-Z0-9_-]{20,})/g, "[REDACTED]");
      return new Error(`Meta API error ${status}${code}${subcode}: ${sanitizedMessage}`);
    }
  }
  return new Error(`Meta API request failed with HTTP status ${status}.`);
}

/**
 * 1. Exchanges an OAuth authorization code for a short-lived Instagram User Access Token.
 * Endpoint: POST https://api.instagram.com/oauth/access_token
 * Encoding: application/x-www-form-urlencoded
 */
export async function exchangeCodeForShortLivedToken(
  options: ExchangeCodeOptions
): Promise<ShortLivedTokenResponse> {
  const { code, redirectUri, fetchFn = fetch } = options;
  const appId = options.appId || process.env.INSTAGRAM_APP_ID;
  const appSecret = options.appSecret || process.env.INSTAGRAM_APP_SECRET;

  if (!code || typeof code !== "string") {
    throw new Error("Missing or invalid authorization code.");
  }
  if (!redirectUri || typeof redirectUri !== "string") {
    throw new Error("Missing or invalid redirect URI.");
  }
  if (!appId) {
    throw new Error("Missing Instagram App ID. Configure INSTAGRAM_APP_ID.");
  }
  if (!appSecret) {
    throw new Error("Missing Instagram App Secret. Configure INSTAGRAM_APP_SECRET.");
  }

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: code.trim(),
  });

  const res = await fetchFn(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Meta API returned invalid JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw parseSanitizedError(res.status, json);
  }

  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("Meta API response missing required 'access_token' string.");
  }
  if (json.user_id === undefined || json.user_id === null) {
    throw new Error("Meta API response missing required 'user_id' identifier.");
  }

  const permissions: string[] = Array.isArray(json.permissions)
    ? json.permissions.filter((p): p is string => typeof p === "string")
    : typeof json.permissions === "string"
      ? (json.permissions as string).split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    accessToken: json.access_token,
    userId: String(json.user_id),
    permissions,
  };
}

/**
 * 2. Exchanges a valid short-lived token for a long-lived token (valid for 60 days).
 * Endpoint: GET https://graph.instagram.com/access_token
 */
export async function exchangeForLongLivedToken(
  options: ExchangeLongLivedOptions
): Promise<LongLivedTokenResponse> {
  const { shortLivedToken, fetchFn = fetch } = options;
  const appSecret = options.appSecret || process.env.INSTAGRAM_APP_SECRET;

  if (!shortLivedToken || typeof shortLivedToken !== "string") {
    throw new Error("Missing or invalid short-lived access token.");
  }
  if (!appSecret) {
    throw new Error("Missing Instagram App Secret. Configure INSTAGRAM_APP_SECRET.");
  }

  const url = new URL("/access_token", GRAPH_API_BASE_URL);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const res = await fetchFn(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Meta API returned invalid JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw parseSanitizedError(res.status, json);
  }

  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("Meta API response missing required long-lived 'access_token'.");
  }
  if (typeof json.expires_in !== "number" || json.expires_in <= 0) {
    throw new Error("Meta API response missing valid 'expires_in' duration.");
  }

  const expiresIn = json.expires_in;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return {
    accessToken: json.access_token,
    tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
    expiresIn,
    expiresAt,
  };
}

/**
 * 3. Fetches authorized Instagram Professional Account profile information.
 * Endpoint: GET https://graph.instagram.com/{version}/me
 * Supported fields under instagram_business_basic: id, user_id, username, name, account_type, profile_picture_url
 */
export async function fetchInstagramProfile(
  options: FetchProfileOptions
): Promise<InstagramProfile> {
  const { accessToken, apiVersion, fetchFn = fetch } = options;

  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing or invalid access token for profile query.");
  }

  const version = validateApiVersion(apiVersion);
  const fields = "id,user_id,username,name,account_type,profile_picture_url";

  const url = new URL(`/${version}/me`, GRAPH_API_BASE_URL);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);

  const res = await fetchFn(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Meta API returned invalid JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw parseSanitizedError(res.status, json);
  }

  if (typeof json.id !== "string" || !json.id) {
    throw new Error("Meta API profile response missing required 'id'.");
  }
  if (typeof json.username !== "string" || !json.username) {
    throw new Error("Meta API profile response missing required 'username'.");
  }

  return {
    id: json.id,
    userId: json.user_id ? String(json.user_id) : undefined,
    username: json.username,
    name: typeof json.name === "string" ? json.name : undefined,
    accountType: typeof json.account_type === "string" ? json.account_type : undefined,
    profilePictureUrl: typeof json.profile_picture_url === "string" ? json.profile_picture_url : undefined,
  };
}

/**
 * 4. Refreshes an eligible long-lived access token for another 60 days.
 * Meta rules:
 * - Token must be at least 24 hours old.
 * - Token must not be expired.
 * Endpoint: GET https://graph.instagram.com/refresh_access_token
 */
export async function refreshLongLivedToken(
  options: RefreshTokenOptions
): Promise<RefreshedTokenResponse> {
  const { longLivedToken, tokenIssuedAt, tokenExpiresAt, fetchFn = fetch } = options;

  if (!longLivedToken || typeof longLivedToken !== "string") {
    throw new Error("Missing or invalid long-lived access token for refresh.");
  }

  const now = Date.now();

  // Enforce Meta eligibility rule 1: Token must not be expired
  if (tokenExpiresAt !== undefined && tokenExpiresAt !== null) {
    const expiresMs = new Date(tokenExpiresAt).getTime();
    if (isNaN(expiresMs) || expiresMs <= now) {
      throw new Error(
        "Token has expired and cannot be refreshed. Creator must re-authorize via Instagram Login."
      );
    }
  }

  // Enforce Meta eligibility rule 2: Token must be at least 24 hours old
  if (tokenIssuedAt !== undefined && tokenIssuedAt !== null) {
    const issuedMs = new Date(tokenIssuedAt).getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    if (!isNaN(issuedMs) && now - issuedMs < twentyFourHoursMs) {
      throw new Error(
        "Token is less than 24 hours old and cannot be refreshed yet per Meta API policy."
      );
    }
  }

  const url = new URL("/refresh_access_token", GRAPH_API_BASE_URL);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", longLivedToken);

  const res = await fetchFn(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Meta API returned invalid JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw parseSanitizedError(res.status, json);
  }

  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("Meta API response missing refreshed 'access_token'.");
  }
  if (typeof json.expires_in !== "number" || json.expires_in <= 0) {
    throw new Error("Meta API response missing valid 'expires_in' duration.");
  }

  const expiresIn = json.expires_in;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return {
    accessToken: json.access_token,
    tokenType: typeof json.token_type === "string" ? json.token_type : "bearer",
    expiresIn,
    expiresAt,
  };
}
