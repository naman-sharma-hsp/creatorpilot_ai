"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { InstagramAnalyticsData } from "./insights";

export interface UseInstagramAnalyticsReturn {
  data: InstagramAnalyticsData | null;
  isLoading: boolean;
  error: string | null;
  fetchAnalytics: (options?: { forceRefresh?: boolean }) => Promise<void>;
  resetError: () => void;
}

export interface UseInstagramAnalyticsOptions {
  fetchFn?: typeof fetch;
  autoFetch?: boolean;
  enabled?: boolean;
}

/**
 * Client hook for querying and refreshing Instagram analytics and telemetry.
 * Connects to /api/auth/instagram/analytics.
 * Handles concurrency, loading state, error states, and cache bypass.
 */
export function useInstagramAnalytics(
  options?: UseInstagramAnalyticsOptions
): UseInstagramAnalyticsReturn {
  const fetchFn = options?.fetchFn || (typeof fetch !== "undefined" ? fetch : undefined);
  const autoFetch = options?.autoFetch ?? true;
  const enabled = options?.enabled ?? true;

  const [data, setData] = useState<InstagramAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(autoFetch && enabled));
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  const fetchAnalytics = useCallback(
    async (fetchOptions?: { forceRefresh?: boolean }) => {
      if (!fetchFn || !enabled) return;
      if (isFetchingRef.current) return;

      isFetchingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const url = fetchOptions?.forceRefresh
          ? "/api/auth/instagram/analytics?refresh=true"
          : "/api/auth/instagram/analytics";

        const res = await fetchFn(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (res.status === 401) {
          setData(null);
          return;
        }

        if (res.status === 429) {
          throw new Error("Meta API rate limit reached. Please wait a few minutes before refreshing.");
        }

        if (!res.ok) {
          throw new Error(`Failed to retrieve analytics (HTTP ${res.status})`);
        }

        const json: InstagramAnalyticsData = await res.json();
        setData(json);
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to retrieve Instagram analytics."
        );
      } finally {
        setIsLoading(false);
        isFetchingRef.current = false;
      }
    },
    [fetchFn, enabled]
  );

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    if (!autoFetch || !enabled || !fetchFn) return;
    let ignore = false;

    fetchFn("/api/auth/instagram/analytics", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((res) => {
        if (res.status === 401) {
          if (!ignore) {
            setData(null);
            setIsLoading(false);
          }
          return null;
        }
        if (res.status === 429) {
          throw new Error("Meta API rate limit reached. Please wait a few minutes before refreshing.");
        }
        if (!res.ok) {
          throw new Error(`Failed to retrieve analytics (HTTP ${res.status})`);
        }
        return res.json() as Promise<InstagramAnalyticsData>;
      })
      .then((json) => {
        if (!ignore && json) {
          setData(json);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to retrieve Instagram analytics."
          );
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [autoFetch, enabled, fetchFn]);

  return {
    data,
    isLoading,
    error,
    fetchAnalytics,
    resetError,
  };
}
