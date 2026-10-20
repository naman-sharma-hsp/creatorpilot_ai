import { cache } from "react";
import { createClient, isSupabaseConfigured } from "./supabase/server";
import type { Profile } from "./definitions";

export interface SessionResult {
  isAuth: boolean;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  } | null;
  isConfigured: boolean;
}

/**
 * Authoritative session verification executed on the server.
 * Wrapped in React cache to memoize across a single server render pass.
 */
export const verifySession = cache(async (): Promise<SessionResult> => {
  if (!isSupabaseConfigured()) {
    return { isAuth: false, user: null, isConfigured: false };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { isAuth: false, user: null, isConfigured: true };
    }

    return {
      isAuth: true,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
      },
      isConfigured: true,
    };
  } catch {
    return { isAuth: false, user: null, isConfigured: true };
  }
});

import type { InstagramStatusData } from "./instagram/use-instagram-status";

/**
 * Authoritative profile data fetcher.
 * Retrieves verified profile record matching auth.uid() from public.profiles table.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return null;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (error || !data) {
      // Fallback: construct profile from auth metadata if table sync is pending
      const fallbackProfile: Profile = {
        id: session.user.id,
        email: session.user.email || "",
        full_name: (session.user.user_metadata?.full_name as string) || null,
        creator_handle: (session.user.user_metadata?.creator_handle as string) || null,
        avatar_url: (session.user.user_metadata?.avatar_url as string) || null,
        plan_tier: "creator",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      try {
        const { data: conn } = await supabase
          .from("connected_accounts")
          .select("username, metadata")
          .eq("user_id", session.user.id)
          .eq("platform", "instagram")
          .eq("status", "connected")
          .maybeSingle();
        if (conn?.username) {
          fallbackProfile.creator_handle = conn.username;
        }
        const connMeta = conn?.metadata as Record<string, unknown> | null;
        const pfp = (connMeta?.profile_picture_url as string) || (connMeta?.profilePictureUrl as string);
        if (pfp) {
          fallbackProfile.avatar_url = pfp;
        }
      } catch {
        // Safe fallback
      }

      return fallbackProfile;
    }

    const profileData = data as Profile;
    if (!profileData.creator_handle || !profileData.avatar_url) {
      try {
        const { data: conn } = await supabase
          .from("connected_accounts")
          .select("username, metadata")
          .eq("user_id", session.user.id)
          .eq("platform", "instagram")
          .eq("status", "connected")
          .maybeSingle();

        let updated = false;
        const updates: Record<string, unknown> = {};

        if (conn?.username && !profileData.creator_handle) {
          profileData.creator_handle = conn.username;
          updates.creator_handle = conn.username;
          updated = true;
        }

        const connMeta = conn?.metadata as Record<string, unknown> | null;
        const pfp = (connMeta?.profile_picture_url as string) || (connMeta?.profilePictureUrl as string);
        if (pfp && !profileData.avatar_url) {
          profileData.avatar_url = pfp;
          updates.avatar_url = pfp;
          updated = true;
        }

        if (updated) {
          // Asynchronously sync back to profiles table so subsequent lookups are fast
          void Promise.resolve(
            supabase
              .from("profiles")
              .update({ ...updates, updated_at: new Date().toISOString() })
              .eq("id", session.user.id)
          ).catch(() => {});
        }
      } catch {
        // Safe fallback
      }
    }

    return profileData;
  } catch {
    return null;
  }
});

/**
 * Authoritative Instagram connection fetcher on the server.
 * Pre-seeds dashboard state to eliminate flash-of-disconnected-content.
 */
export const getConnectedAccount = cache(async (): Promise<InstagramStatusData | null> => {
  const session = await verifySession();
  if (!session.isAuth || !session.user) {
    return null;
  }

  try {
    const supabase = await createClient();
    const { data: account, error: accountError } = await supabase
      .from("connected_accounts")
      .select("id, user_id, platform, platform_user_id, username, status, scopes, metadata, connected_at")
      .eq("user_id", session.user.id)
      .eq("platform", "instagram")
      .maybeSingle();

    if (accountError || !account || account.status === "disconnected") {
      return {
        connected: false,
        status: "disconnected",
      };
    }

    const { data: creds } = await supabase
      .from("account_credentials")
      .select("expires_at, scopes")
      .eq("account_id", account.id)
      .maybeSingle();

    const now = new Date();
    const expiresAtDate = creds?.expires_at ? new Date(creds.expires_at) : null;
    const isExpired = expiresAtDate ? expiresAtDate.getTime() <= now.getTime() : false;

    return {
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
  } catch {
    return null;
  }
});
