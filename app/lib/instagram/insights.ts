import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifySession } from "../dal";
import { createAdminClient } from "../supabase/admin";
import { decryptToken, encryptToken, validateEncryptionKey } from "./crypto";
import {
  refreshLongLivedToken,
  validateApiVersion,
} from "./client";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

const GRAPH_API_BASE_URL = "https://graph.instagram.com";
const DEFAULT_TIMEOUT_MS = 10000;
export const ANALYTICS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const JIT_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days before expiry
export const MIN_TOKEN_AGE_FOR_REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours per Meta rules
export const MAX_SNAPSHOT_RETENTION = 30; // Max 30 daily/weekly snapshots to prevent JSONB bloat
export const MIN_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000; // Minimum 24 hours between snapshots

export interface InstagramRecentMediaItem {
  id: string;
  caption?: string | null;
  mediaType: string;
  timestamp: string;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  likeCount?: number | null;
  commentsCount?: number | null;
}

export interface InstagramDailyMetricPoint {
  date: string;
  fullDate: string;
  reach: number | null;
  views: number | null;
}

export interface AnalyticsSnapshotItem {
  timestamp: string;
  followersCount: number | null;
  mediaCount: number | null;
  reach30d: number | null;
  views30d: number | null;
  totalRecentLikes: number | null;
  totalRecentComments: number | null;
}

export interface InstagramAccountProfileMetrics {
  followersCount: number | null;
  mediaCount: number | null;
  followsCount: number | null;
}

export interface InstagramAccountInsights {
  reach: number | null;
  views: number | null;
  period: "days_28";
}

export interface InstagramAnalyticsData {
  connected: boolean;
  status: "connected" | "disconnected" | "expired" | "insufficient_permissions";
  username: string | null;
  platformUserId: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  reach30d: number | null;
  views30d: number | null;
  totalInteractions: number | null;
  dailyMetrics: InstagramDailyMetricPoint[];
  followerHistory?: AnalyticsSnapshotItem[];
  period: "days_28";
  recentMedia: InstagramRecentMediaItem[];
  scopesGranted: string[];
  missingScopes: string[];
  lastSyncedAt: string;
  isCached?: boolean;
}

export interface AnalyticsCacheEntry {
  data: InstagramAnalyticsData;
  cachedAt: string;
}

export interface AnalyticsHandlerOptions {
  verifySessionFn?: typeof verifySession;
  adminClient?: SupabaseClient;
  fetchFn?: typeof fetch;
  nowMs?: number;
  forceRefresh?: boolean;
  encryptionKey?: string;
  apiVersion?: string;
}

export interface FetchProfileMetricsOptions {
  accessToken: string;
  platformUserId?: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
}

export interface FetchAccountInsightsOptions {
  accessToken: string;
  platformUserId: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
  period?: "days_28";
}

export interface FetchRecentMediaOptions {
  accessToken: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
  limit?: number;
}

export class MetaApiError extends Error {
  status: number;
  code?: number;
  subcode?: number;

  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

/**
 * Sanitizes Meta API errors and extracts error codes while guaranteeing tokens are never logged.
 */
function parseMetaApiError(status: number, data: unknown): MetaApiError {
  let message = `Meta API request failed with HTTP status ${status}.`;
  let code: number | undefined;
  let subcode: number | undefined;

  if (data && typeof data === "object") {
    const errorObj = (data as { error?: { message?: string; code?: number; error_subcode?: number } }).error;
    if (errorObj && typeof errorObj === "object") {
      code = typeof errorObj.code === "number" ? errorObj.code : undefined;
      subcode = typeof errorObj.error_subcode === "number" ? errorObj.error_subcode : undefined;
      const rawMessage = errorObj.message || message;
      // Redact parameter query values and token-like substrings
      const sanitized = rawMessage
        .replace(/(access_token|client_secret|code)=[^&\s]+/gi, "$1=[REDACTED]")
        .replace(/([a-zA-Z0-9_-]{20,})/g, "[REDACTED]");
      const codeStr = code !== undefined ? ` (code ${code})` : "";
      const subcodeStr = subcode !== undefined ? ` (subcode ${subcode})` : "";
      message = `Meta API error ${status}${codeStr}${subcodeStr}: ${sanitized}`;
    }
  }

  return new MetaApiError(message, status, code, subcode);
}

/**
 * Helper to safely extract integer metrics from Meta Insights objects.
 * Handles both metric_type=total_value ({ total_value: { value } })
 * and time-series arrays ({ values: [{ value }] }).
 * Returns null if missing or not a valid number. Never converts missing to 0.
 */
function extractMetricValue(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;

  if (obj.total_value && typeof obj.total_value === "object") {
    const tv = (obj.total_value as Record<string, unknown>).value;
    if (typeof tv === "number" && !isNaN(tv)) {
      return tv;
    }
  }

  if (Array.isArray(obj.values) && obj.values.length > 0) {
    const first = obj.values[0];
    if (first && typeof first === "object") {
      const val = (first as Record<string, unknown>).value;
      if (typeof val === "number" && !isNaN(val)) {
        return val;
      }
    }
  }

  return null;
}

/**
 * 1. Fetches real-time follower count and media count for the authenticated Instagram professional account.
 * Endpoint: GET https://graph.instagram.com/{version}/{platformUserId|me}?fields=id,username,followers_count,media_count
 * Permissions: instagram_business_basic
 *
 * NOTE: 'follows_count' is NOT supported on node type InstagramUser in the Instagram Platform API
 * and must never be requested to prevent Meta OAuthException Error #100.
 */
export async function fetchAccountProfileMetrics(
  options: FetchProfileMetricsOptions
): Promise<InstagramAccountProfileMetrics> {
  const { accessToken, apiVersion, fetchFn = fetch } = options;
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing or invalid access token for profile metrics.");
  }

  const version = validateApiVersion(apiVersion);
  // Supported fields under instagram_business_basic: id, username, followers_count, media_count
  // NOTE: 'follows_count' is NOT supported on node type InstagramUser and must never be requested.
  const fields = "id,username,followers_count,media_count";
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
    throw parseMetaApiError(res.status, json);
  }

  return {
    followersCount: typeof json.followers_count === "number" ? json.followers_count : null,
    mediaCount: typeof json.media_count === "number" ? json.media_count : null,
    followsCount: typeof json.follows_count === "number" ? json.follows_count : null,
  };
}

/**
 * 2. Fetches verified account-level reach and views over the past 28 days.
 * Endpoint:
 * - Reach: GET https://graph.instagram.com/{version}/{platformUserId}/insights?metric=reach&period=days_28
 * - Views: GET https://graph.instagram.com/{version}/{platformUserId}/insights?metric=views&period=days_28&metric_type=total_value
 * Permissions: instagram_business_manage_insights
 *
 * NOTE: Reach and Views are fetched independently via Promise.allSettled so that a failure or
 * unaggregated state in Views never compromises Reach telemetry.
 * Missing or unavailable data is returned as null, never converted to 0. Genuine 0 is preserved.
 */
export async function fetchAccountInsights(
  options: FetchAccountInsightsOptions
): Promise<InstagramAccountInsights> {
  const { accessToken, platformUserId, apiVersion, fetchFn = fetch, period = "days_28" } = options;
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing or invalid access token for insights query.");
  }
  if (!platformUserId || typeof platformUserId !== "string") {
    throw new Error("Missing or invalid platformUserId for insights query.");
  }

  const version = validateApiVersion(apiVersion);
  const targetId = encodeURIComponent(platformUserId);

  // 1. Independent Reach Query
  const queryReach = async (): Promise<number | null> => {
    try {
      const url = new URL(`/${version}/${targetId}/insights`, GRAPH_API_BASE_URL);
      url.searchParams.set("metric", "reach");
      url.searchParams.set("period", period);
      url.searchParams.set("access_token", accessToken);

      const res = await fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        const err = parseMetaApiError(res.status, errorJson);
        if (err.code === 190 || err.code === 4 || err.code === 613 || err.status === 429) {
          throw err;
        }
        return null;
      }

      const json = await res.json();
      if (Array.isArray(json.data)) {
        const reachItem = json.data.find(
          (item: unknown) =>
            item && typeof item === "object" && (item as { name?: string }).name === "reach"
        );
        if (!reachItem) return null;
        return extractMetricValue(reachItem);
      }
      return null;
    } catch (err) {
      if (
        err instanceof MetaApiError &&
        (err.code === 190 || err.code === 4 || err.code === 613 || err.status === 429)
      ) {
        throw err;
      }
      return null;
    }
  };

  // 2. Independent Views Query
  const queryViews = async (): Promise<number | null> => {
    try {
      const url = new URL(`/${version}/${targetId}/insights`, GRAPH_API_BASE_URL);
      url.searchParams.set("metric", "views");
      url.searchParams.set("period", period);
      url.searchParams.set("metric_type", "total_value");
      url.searchParams.set("access_token", accessToken);

      let res = await fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      // If combination of period=days_28 + metric_type fails, try fallback without period
      if (!res.ok) {
        try {
          const fallbackUrl = new URL(`/${version}/${targetId}/insights`, GRAPH_API_BASE_URL);
          fallbackUrl.searchParams.set("metric", "views");
          fallbackUrl.searchParams.set("metric_type", "total_value");
          fallbackUrl.searchParams.set("access_token", accessToken);

          const fallbackRes = await fetchFn(fallbackUrl.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          });
          if (fallbackRes.ok) {
            res = fallbackRes;
          }
        } catch {
          // ignore fallback error
        }
      }

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        const err = parseMetaApiError(res.status, errorJson);
        if (err.code === 190 || err.code === 4 || err.code === 613 || err.status === 429) {
          throw err;
        }
        return null;
      }

      const json = await res.json();
      if (Array.isArray(json.data)) {
        const viewsItem = json.data.find(
          (item: unknown) =>
            item && typeof item === "object" && (item as { name?: string }).name === "views"
        );
        if (!viewsItem) return null;
        return extractMetricValue(viewsItem);
      }
      return null;
    } catch (err) {
      if (
        err instanceof MetaApiError &&
        (err.code === 190 || err.code === 4 || err.code === 613 || err.status === 429)
      ) {
        throw err;
      }
      return null;
    }
  };

  const [reachResult, viewsResult] = await Promise.allSettled([queryReach(), queryViews()]);

  if (reachResult.status === "rejected" && reachResult.reason instanceof MetaApiError) {
    throw reachResult.reason;
  }
  if (viewsResult.status === "rejected" && viewsResult.reason instanceof MetaApiError) {
    throw viewsResult.reason;
  }

  const reach = reachResult.status === "fulfilled" ? reachResult.value : null;
  const views = viewsResult.status === "fulfilled" ? viewsResult.value : null;

  return {
    reach,
    views,
    period,
  };
}

/**
 * 3. Fetches up to 5 recent media items published by the authenticated account.
 * Endpoint: GET https://graph.instagram.com/{version}/me/media?fields=id,caption,media_type,timestamp,permalink,thumbnail_url,media_url&limit=5
 * Permissions: instagram_business_basic
 */
export async function fetchRecentMedia(
  options: FetchRecentMediaOptions
): Promise<InstagramRecentMediaItem[]> {
  const { accessToken, apiVersion, fetchFn = fetch, limit = 5 } = options;
  if (!accessToken || typeof accessToken !== "string") {
    return [];
  }

  try {
    const version = validateApiVersion(apiVersion);
    const url = new URL(`/${version}/me/media`, GRAPH_API_BASE_URL);
    url.searchParams.set(
      "fields",
      "id,caption,media_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count"
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("access_token", accessToken);

    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      return [];
    }

    const json = await res.json();
    if (!Array.isArray(json.data)) {
      return [];
    }

    return json.data.map((item: Record<string, unknown>) => ({
      id: String(item.id || ""),
      caption: typeof item.caption === "string" ? item.caption : null,
      mediaType: typeof item.media_type === "string" ? item.media_type : "UNKNOWN",
      timestamp: typeof item.timestamp === "string" ? item.timestamp : "",
      permalink: typeof item.permalink === "string" ? item.permalink : null,
      thumbnailUrl:
        typeof item.thumbnail_url === "string"
          ? item.thumbnail_url
          : typeof item.media_url === "string"
            ? item.media_url
            : null,
      likeCount: typeof item.like_count === "number" ? item.like_count : null,
      commentsCount: typeof item.comments_count === "number" ? item.comments_count : null,
    }));
  } catch {
    return [];
  }
}

export interface FetchDailyInsightsOptions {
  accessToken: string;
  platformUserId: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
  since?: number;
  until?: number;
  now?: Date;
  days?: number;
}

/**
 * 4. Fetches real daily time-series reach and views from Meta Graph API.
 * Endpoint: GET https://graph.instagram.com/{version}/{platformUserId}/insights?metric=reach,views&period=day&since={since}&until={until}
 * Permissions: instagram_business_manage_insights
 *
 * NOTE: If Meta provides daily historical points, they are sorted chronologically.
 * If daily data is empty or unavailable (e.g. reporting delay or insufficient followers),
 * returns an empty array honestly without mathematical interpolation.
 */
export async function fetchDailyAccountInsights(
  options: FetchDailyInsightsOptions
): Promise<InstagramDailyMetricPoint[]> {
  const { accessToken, platformUserId, apiVersion, fetchFn = fetch } = options;
  if (!accessToken || !platformUserId) {
    return [];
  }

  try {
    const version = validateApiVersion(apiVersion);
    const now = options.now || new Date();
    const days = Math.min(Math.max(options.days ?? 30, 1), 30);
    const untilSec = typeof options.until === "number"
      ? Math.floor(options.until)
      : Math.floor(now.getTime() / 1000);
    const sinceSec = typeof options.since === "number"
      ? Math.floor(options.since)
      : untilSec - (days * 24 * 60 * 60);

    const pointsByDate = new Map<string, { reach: number | null; views: number | null }>();

    const processMetricItems = (items: unknown[]) => {
      for (const metric of items) {
        if (!metric || typeof metric !== "object") continue;
        const metricName = (metric as { name?: string }).name;
        const values = (metric as { values?: unknown[] }).values;
        if (!Array.isArray(values)) continue;

        for (const valItem of values) {
          if (!valItem || typeof valItem !== "object") continue;
          const endTime = (valItem as { end_time?: string }).end_time;
          const rawVal = (valItem as { value?: unknown }).value;
          const numVal = typeof rawVal === "number" && !isNaN(rawVal) ? rawVal : null;

          if (!endTime || typeof endTime !== "string") continue;
          const dateObj = new Date(endTime);
          if (isNaN(dateObj.getTime())) continue;
          const dateKey = dateObj.toISOString().slice(0, 10);

          const existing = pointsByDate.get(dateKey) || { reach: null, views: null };
          if (metricName === "reach") {
            existing.reach = numVal;
          } else if (metricName === "views") {
            existing.views = numVal;
          }
          pointsByDate.set(dateKey, existing);
        }
      }
    };

    // 1. Fetch Daily Reach independently
    const fetchReach = async () => {
      try {
        const url = new URL(
          `/${version}/${encodeURIComponent(platformUserId)}/insights`,
          GRAPH_API_BASE_URL
        );
        url.searchParams.set("metric", "reach");
        url.searchParams.set("period", "day");
        url.searchParams.set("since", String(sinceSec));
        url.searchParams.set("until", String(untilSec));
        url.searchParams.set("access_token", accessToken);

        const res = await fetchFn(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            processMetricItems(json.data);
          }
        }
      } catch {
        // Non-fatal reach query error
      }
    };

    // 2. Fetch Daily Views independently
    const fetchViews = async () => {
      try {
        const url = new URL(
          `/${version}/${encodeURIComponent(platformUserId)}/insights`,
          GRAPH_API_BASE_URL
        );
        url.searchParams.set("metric", "views");
        url.searchParams.set("period", "day");
        url.searchParams.set("since", String(sinceSec));
        url.searchParams.set("until", String(untilSec));
        url.searchParams.set("access_token", accessToken);

        let res = await fetchFn(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        // Fallback with metric_type=total_value if required by Meta version
        if (!res.ok) {
          try {
            const fallbackUrl = new URL(
              `/${version}/${encodeURIComponent(platformUserId)}/insights`,
              GRAPH_API_BASE_URL
            );
            fallbackUrl.searchParams.set("metric", "views");
            fallbackUrl.searchParams.set("period", "day");
            fallbackUrl.searchParams.set("metric_type", "total_value");
            fallbackUrl.searchParams.set("since", String(sinceSec));
            fallbackUrl.searchParams.set("until", String(untilSec));
            fallbackUrl.searchParams.set("access_token", accessToken);

            const fallbackRes = await fetchFn(fallbackUrl.toString(), {
              method: "GET",
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
            });
            if (fallbackRes.ok) {
              res = fallbackRes;
            }
          } catch {
            // Ignore fallback error
          }
        }

        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            processMetricItems(json.data);
          }
        }
      } catch {
        // Non-fatal views query error
      }
    };

    await Promise.allSettled([fetchReach(), fetchViews()]);

    const sortedKeys = Array.from(pointsByDate.keys()).sort();
    return sortedKeys.map((key) => {
      const entry = pointsByDate.get(key)!;
      const d = new Date(key);
      const fullDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        date: key,
        fullDate,
        reach: entry.reach,
        views: entry.views,
      };
    });
  } catch {
    return [];
  }
}

/**
 * 4. Main Server-Side Authenticated Analytics Handler.
 * Executes:
 * - Session authentication (verifySession)
 * - User account lookup strictly scoped to session.user.id
 * - Cache lookup (15-min TTL) with metadata preservation
 * - Permission scope inspection
 * - Credential decryption (AES-256-GCM)
 * - JIT opportunistic token refresh with concurrency safety
 * - Telemetry retrieval (followers, reach, views, recent media)
 * - Error discrimination (expired token, rate limits, permissions)
 */
export async function handleInstagramAnalytics(
  request: NextRequest,
  options?: AnalyticsHandlerOptions
): Promise<NextResponse> {
  const now = options?.nowMs ? new Date(options.nowMs) : new Date();
  const nowIso = now.toISOString();

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
      { error: "Failed to initialize server administrative client." },
      { status: 500 }
    );
  }

  // 3. Query user's connected account strictly scoped to session.user.id
  const { data: account, error: accountError } = await admin
    .from("connected_accounts")
    .select("id, user_id, platform, platform_user_id, username, status, scopes, metadata, connected_at")
    .eq("user_id", session.user.id)
    .eq("platform", "instagram")
    .maybeSingle();

  if (accountError) {
    return NextResponse.json(
      { error: "Failed to retrieve connected Instagram account." },
      { status: 500 }
    );
  }

  if (!account || account.status === "disconnected") {
    return NextResponse.json<InstagramAnalyticsData>({
      connected: false,
      status: "disconnected",
      username: null,
      platformUserId: null,
      followersCount: null,
      mediaCount: null,
      reach30d: null,
      views30d: null,
      totalInteractions: null,
      dailyMetrics: [],
      period: "days_28",
      recentMedia: [],
      scopesGranted: [],
      missingScopes: [],
      lastSyncedAt: nowIso,
      isCached: false,
    });
  }

  const grantedScopes = new Set<string>(account.scopes || []);
  const hasInsightsScope = grantedScopes.has("instagram_business_manage_insights");

  // 4. Enforce account validity: expired or non-connected status
  if (account.status === "expired") {
    return NextResponse.json<InstagramAnalyticsData>({
      connected: false,
      status: "expired",
      username: account.username,
      platformUserId: account.platform_user_id,
      followersCount: null,
      mediaCount: null,
      reach30d: null,
      views30d: null,
      totalInteractions: null,
      dailyMetrics: [],
      period: "days_28",
      recentMedia: [],
      scopesGranted: Array.from(grantedScopes),
      missingScopes: [],
      lastSyncedAt: nowIso,
      isCached: false,
    });
  }

  if (account.status !== "connected") {
    return NextResponse.json<InstagramAnalyticsData>({
      connected: false,
      status: account.status,
      username: account.username,
      platformUserId: account.platform_user_id,
      followersCount: null,
      mediaCount: null,
      reach30d: null,
      views30d: null,
      totalInteractions: null,
      dailyMetrics: [],
      period: "days_28",
      recentMedia: [],
      scopesGranted: Array.from(grantedScopes),
      missingScopes: [],
      lastSyncedAt: nowIso,
      isCached: false,
    });
  }

  // 5. Enforce required scopes: verify instagram_business_manage_insights is granted
  if (!hasInsightsScope) {
    const responsePayload: InstagramAnalyticsData = {
      connected: true,
      status: "insufficient_permissions",
      username: account.username,
      platformUserId: account.platform_user_id,
      followersCount: null,
      mediaCount: null,
      reach30d: null,
      views30d: null,
      totalInteractions: null,
      dailyMetrics: [],
      period: "days_28",
      recentMedia: [],
      scopesGranted: Array.from(grantedScopes),
      missingScopes: ["instagram_business_manage_insights"],
      lastSyncedAt: nowIso,
      isCached: false,
    };

    return NextResponse.json<InstagramAnalyticsData>(responsePayload, {
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  }

  // 6. Check cache if not forcing refresh (only after authorization, ownership, validity, and scope checks pass)
  const urlSearch = request.nextUrl?.searchParams;
  const forceRefresh =
    options?.forceRefresh ??
    (urlSearch ? urlSearch.get("refresh") === "true" : false);

  const metadata = (account.metadata as Record<string, unknown>) || {};
  const cacheEntry = metadata.analytics_cache as AnalyticsCacheEntry | undefined;

  if (!forceRefresh && cacheEntry && cacheEntry.cachedAt && cacheEntry.data) {
    const cachedAtMs = new Date(cacheEntry.cachedAt).getTime();
    const ageMs = now.getTime() - cachedAtMs;
    if (!isNaN(ageMs) && ageMs >= 0 && ageMs < ANALYTICS_CACHE_TTL_MS) {
      return NextResponse.json<InstagramAnalyticsData>(
        {
          ...cacheEntry.data,
          followerHistory: cacheEntry.data.followerHistory || (metadata.analytics_history as AnalyticsSnapshotItem[]) || [],
          isCached: true,
        },
        {
          headers: {
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
          },
        }
      );
    }
  }

  // 7. Retrieve credentials from server-only table
  const { data: creds, error: credsError } = await admin
    .from("account_credentials")
    .select("encrypted_token, expires_at, updated_at, scopes")
    .eq("account_id", account.id)
    .maybeSingle();

  if (credsError || !creds || !creds.encrypted_token) {
    return NextResponse.json(
      { error: "Failed to retrieve account credentials." },
      { status: 500 }
    );
  }

  // Check if token is already expired
  const expiresAtDate = creds.expires_at ? new Date(creds.expires_at) : null;
  const isExpired = expiresAtDate ? expiresAtDate.getTime() <= now.getTime() : false;

  if (isExpired) {
    if (account.status !== "expired") {
      try {
        await admin
          .from("connected_accounts")
          .update({ status: "expired", updated_at: nowIso })
          .eq("id", account.id);
      } catch {
        // Safe fallback
      }
    }

    return NextResponse.json<InstagramAnalyticsData>({
      connected: false,
      status: "expired",
      username: account.username,
      platformUserId: account.platform_user_id,
      followersCount: null,
      mediaCount: null,
      reach30d: null,
      views30d: null,
      totalInteractions: null,
      dailyMetrics: [],
      period: "days_28",
      recentMedia: [],
      scopesGranted: Array.from(grantedScopes),
      missingScopes: [],
      lastSyncedAt: nowIso,
      isCached: false,
    });
  }

  // 7. Decrypt token on the server
  const encryptionKey = options?.encryptionKey || process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  let activeToken: string;
  try {
    validateEncryptionKey(encryptionKey);
    activeToken = decryptToken(creds.encrypted_token, encryptionKey);
  } catch {
    return NextResponse.json(
      { error: "Credential decryption error." },
      { status: 500 }
    );
  }

  // 8. JIT Opportunistic Token Refresh with Concurrency Protection
  // If token is within 14 days of expiry and at least 24 hours old, refresh it
  const expiresAtMs = expiresAtDate ? expiresAtDate.getTime() : 0;
  const updatedAtDate = creds.updated_at ? new Date(creds.updated_at) : new Date(0);
  const updatedAtMs = updatedAtDate.getTime();
  const remainingLifetimeMs = expiresAtMs - now.getTime();
  const tokenAgeMs = now.getTime() - updatedAtMs;

  if (
    remainingLifetimeMs > 0 &&
    remainingLifetimeMs < JIT_REFRESH_WINDOW_MS &&
    tokenAgeMs >= MIN_TOKEN_AGE_FOR_REFRESH_MS
  ) {
    try {
      const refreshed = await refreshLongLivedToken({
        longLivedToken: activeToken,
        tokenIssuedAt: creds.updated_at,
        tokenExpiresAt: creds.expires_at,
        fetchFn: options?.fetchFn,
      });

      const reEncrypted = encryptToken(refreshed.accessToken, encryptionKey);
      // Optimistic concurrency update: only update if expires_at hasn't been changed by a concurrent request
      const { data: updatedCreds, error: updateError } = await admin
        .from("account_credentials")
        .update({
          encrypted_token: reEncrypted,
          expires_at: refreshed.expiresAt.toISOString(),
          updated_at: nowIso,
        })
        .eq("account_id", account.id)
        .eq("expires_at", creds.expires_at)
        .select("expires_at")
        .maybeSingle();

      if (!updateError && updatedCreds) {
        activeToken = refreshed.accessToken;
      }
    } catch {
      // Safe fallback: If refresh fails but existing token is still valid, continue using existing token
    }
  }

  // 9. Query Meta API for verified profile metrics, reach, views, and recent media
  const platformUserId = account.platform_user_id || "";
  let profileMetrics: InstagramAccountProfileMetrics = {
    followersCount: null,
    mediaCount: null,
    followsCount: null,
  };
  let insights: InstagramAccountInsights = {
    reach: null,
    views: null,
    period: "days_28",
  };
  let recentMedia: InstagramRecentMediaItem[] = [];

  try {
    profileMetrics = await fetchAccountProfileMetrics({
      accessToken: activeToken,
      platformUserId,
      apiVersion: options?.apiVersion,
      fetchFn: options?.fetchFn,
    });
  } catch (err: unknown) {
    if (err instanceof MetaApiError) {
      if (err.code === 190) {
        // Token has been revoked or expired on Meta's side
        try {
          await admin
            .from("connected_accounts")
            .update({ status: "expired", updated_at: nowIso })
            .eq("id", account.id);
        } catch {
          // Safe fallback
        }
        return NextResponse.json<InstagramAnalyticsData>({
          connected: false,
          status: "expired",
          username: account.username,
          platformUserId: account.platform_user_id,
          followersCount: null,
          mediaCount: null,
          reach30d: null,
          views30d: null,
          totalInteractions: null,
          dailyMetrics: [],
          period: "days_28",
          recentMedia: [],
          scopesGranted: Array.from(grantedScopes),
          missingScopes: [],
          lastSyncedAt: nowIso,
        });
      }

      if (err.code === 4 || err.code === 613 || err.status === 429) {
        return NextResponse.json(
          { error: "Meta API rate limit reached. Please try again shortly." },
          { status: 429, headers: { "Retry-After": "300" } }
        );
      }
    }
    // For non-fatal profile metrics error, proceed with partial data
  }

  try {
    insights = await fetchAccountInsights({
      accessToken: activeToken,
      platformUserId,
      apiVersion: options?.apiVersion,
      fetchFn: options?.fetchFn,
      period: "days_28",
    });
  } catch (err: unknown) {
    if (err instanceof MetaApiError) {
      if (err.code === 190) {
        try {
          await admin
            .from("connected_accounts")
            .update({ status: "expired", updated_at: nowIso })
            .eq("id", account.id);
        } catch {
          // Safe fallback
        }
        return NextResponse.json<InstagramAnalyticsData>({
          connected: false,
          status: "expired",
          username: account.username,
          platformUserId: account.platform_user_id,
          followersCount: null,
          mediaCount: null,
          reach30d: null,
          views30d: null,
          totalInteractions: null,
          dailyMetrics: [],
          period: "days_28",
          recentMedia: [],
          scopesGranted: Array.from(grantedScopes),
          missingScopes: [],
          lastSyncedAt: nowIso,
        });
      }

      if (err.code === 4 || err.code === 613 || err.status === 429) {
        return NextResponse.json(
          { error: "Meta API rate limit reached. Please try again shortly." },
          { status: 429, headers: { "Retry-After": "300" } }
        );
      }

      if (err.code === 10 || (err.code !== undefined && err.code >= 200 && err.code <= 299)) {
        return NextResponse.json<InstagramAnalyticsData>({
          connected: true,
          status: "insufficient_permissions",
          username: account.username,
          platformUserId: account.platform_user_id,
          followersCount: profileMetrics.followersCount,
          mediaCount: profileMetrics.mediaCount,
          reach30d: null,
          views30d: null,
          totalInteractions: null,
          dailyMetrics: [],
          period: "days_28",
          recentMedia: [],
          scopesGranted: Array.from(grantedScopes),
          missingScopes: ["instagram_business_manage_insights"],
          lastSyncedAt: nowIso,
        });
      }
    }
    // For non-fatal insights error, proceed with partial data (insights fields remain null)
  }

  try {
    recentMedia = await fetchRecentMedia({
      accessToken: activeToken,
      apiVersion: options?.apiVersion,
      fetchFn: options?.fetchFn,
      limit: 5,
    });
  } catch {
    recentMedia = [];
  }

  // 10. Query daily insights (period=day) for real reach & views trajectories
  let dailyMetrics: InstagramDailyMetricPoint[] = [];
  try {
    dailyMetrics = await fetchDailyAccountInsights({
      accessToken: activeToken,
      platformUserId,
      apiVersion: options?.apiVersion,
      fetchFn: options?.fetchFn,
      now,
    });
  } catch {
    dailyMetrics = [];
  }

  // 11. Calculate total recent interactions from real like_count and comments_count
  let totalInteractions: number | null = null;
  let totalLikes = 0;
  let totalComments = 0;
  let hasInteractionData = false;

  for (const m of recentMedia) {
    if (typeof m.likeCount === "number") {
      totalLikes += m.likeCount;
      hasInteractionData = true;
    }
    if (typeof m.commentsCount === "number") {
      totalComments += m.commentsCount;
      hasInteractionData = true;
    }
  }
  if (hasInteractionData) {
    totalInteractions = totalLikes + totalComments;
  }

  // 12. Manage zero-migration historical snapshots in connected_accounts.metadata.analytics_history
  // Cap at MAX_SNAPSHOT_RETENTION (30) with MIN_SNAPSHOT_INTERVAL_MS (24h) throttling
  const existingHistory: AnalyticsSnapshotItem[] = Array.isArray(metadata.analytics_history)
    ? (metadata.analytics_history as AnalyticsSnapshotItem[])
    : [];

  let updatedHistory = [...existingHistory];
  const lastSnapshot = updatedHistory[updatedHistory.length - 1];
  const lastSnapshotTime = lastSnapshot?.timestamp ? new Date(lastSnapshot.timestamp).getTime() : 0;

  if (!lastSnapshotTime || isNaN(lastSnapshotTime) || (now.getTime() - lastSnapshotTime) >= MIN_SNAPSHOT_INTERVAL_MS) {
    const newSnapshot: AnalyticsSnapshotItem = {
      timestamp: nowIso,
      followersCount: profileMetrics.followersCount,
      mediaCount: profileMetrics.mediaCount,
      reach30d: insights.reach,
      views30d: insights.views,
      totalRecentLikes: hasInteractionData ? totalLikes : null,
      totalRecentComments: hasInteractionData ? totalComments : null,
    };
    updatedHistory.push(newSnapshot);
    if (updatedHistory.length > MAX_SNAPSHOT_RETENTION) {
      updatedHistory = updatedHistory.slice(updatedHistory.length - MAX_SNAPSHOT_RETENTION);
    }
  }

  // 13. Construct typed analytics response
  const responseData: InstagramAnalyticsData = {
    connected: true,
    status: "connected",
    username: account.username,
    platformUserId: account.platform_user_id,
    followersCount: profileMetrics.followersCount,
    mediaCount: profileMetrics.mediaCount,
    reach30d: insights.reach,
    views30d: insights.views,
    totalInteractions,
    dailyMetrics,
    followerHistory: updatedHistory,
    period: "days_28",
    recentMedia,
    scopesGranted: Array.from(grantedScopes),
    missingScopes: [],
    lastSyncedAt: nowIso,
    isCached: false,
  };

  // 14. Persist cache and snapshots in connected_accounts.metadata preserving all existing metadata fields
  try {
    await admin
      .from("connected_accounts")
      .update({
        metadata: {
          ...metadata,
          analytics_cache: {
            data: responseData,
            cachedAt: nowIso,
          },
          analytics_history: updatedHistory,
        },
        updated_at: nowIso,
      })
      .eq("id", account.id);
  } catch {
    // Non-fatal: caching failure should not break response delivery
  }

  return NextResponse.json<InstagramAnalyticsData>(responseData, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
