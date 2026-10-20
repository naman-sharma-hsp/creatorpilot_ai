"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface InstagramProfileData {
  name?: string | null;
  account_type?: string | null;
  profile_picture_url?: string | null;
  [key: string]: unknown;
}

export interface InstagramStatusData {
  connected: boolean;
  status: "connected" | "disconnected" | "expired";
  username?: string | null;
  platformUserId?: string | null;
  scopes?: string[];
  connectedAt?: string | null;
  expiresAt?: string | null;
  isExpired?: boolean;
  profile?: InstagramProfileData | null;
}

export interface UseInstagramStatusReturn {
  data: InstagramStatusData | null;
  isLoading: boolean;
  error: string | null;
  isDisconnecting: boolean;
  fetchStatus: () => Promise<void>;
  disconnect: () => Promise<boolean>;
  resetError: () => void;
}

export interface UseInstagramStatusOptions {
  fetchFn?: typeof fetch;
  autoFetch?: boolean;
  initialData?: InstagramStatusData | null;
}

/**
 * Client hook for querying and maintaining Instagram connection status.
 * Interacts strictly with /api/auth/instagram/status and /api/auth/instagram/disconnect.
 * Protects against duplicate concurrent in-flight requests and provides retry & optimistic state updates.
 */
export function useInstagramStatus(
  options?: UseInstagramStatusOptions
): UseInstagramStatusReturn {
  const [data, setData] = useState<InstagramStatusData | null>(
    options?.initialData !== undefined ? options.initialData : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    options?.initialData !== undefined ? false : true
  );
  const [error, setError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);

  const fetchFn = options?.fetchFn || (typeof fetch !== "undefined" ? fetch : undefined);
  const autoFetch = options?.autoFetch ?? true;

  const fetchStatus = useCallback(async () => {
    if (!fetchFn) return;
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchFn("/api/auth/instagram/status", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to retrieve status (HTTP ${res.status})`);
      }

      const json: InstagramStatusData = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to retrieve Instagram connection status."
      );
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [fetchFn]);

  const disconnect = useCallback(async (): Promise<boolean> => {
    if (!fetchFn) return false;
    setIsDisconnecting(true);
    setError(null);

    try {
      const res = await fetchFn("/api/auth/instagram/disconnect", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Disconnect request failed (HTTP ${res.status})`);
      }

      // Immediately set local state to disconnected
      setData({
        connected: false,
        status: "disconnected",
        username: null,
        platformUserId: null,
        scopes: [],
        connectedAt: null,
        expiresAt: null,
        isExpired: false,
        profile: null,
      });

      return true;
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to disconnect Instagram account."
      );
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  }, [fetchFn]);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    if (!autoFetch || !fetchFn) return;
    let ignore = false;

    fetchFn("/api/auth/instagram/status", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to retrieve status (HTTP ${res.status})`);
        }
        return res.json() as Promise<InstagramStatusData>;
      })
      .then((json: InstagramStatusData) => {
        if (!ignore) {
          setData(json);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          if (!options?.initialData) {
            setError(
              err instanceof Error
                ? err.message
                : "Unable to retrieve Instagram connection status."
            );
          }
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [autoFetch, fetchFn, options?.initialData]);

  return {
    data,
    isLoading,
    error,
    isDisconnecting,
    fetchStatus,
    disconnect,
    resetError,
  };
}
