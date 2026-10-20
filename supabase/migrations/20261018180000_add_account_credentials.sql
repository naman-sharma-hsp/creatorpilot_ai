-- ============================================================================
-- Insta Account Manager — Account Credentials & Security Hardening
-- Migration: 20261018180000_add_account_credentials.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRE-CHECK: VERIFY NO DUPLICATE PLATFORM ACCOUNTS EXIST BEFORE INDEXING
-- If duplicate platform accounts exist in historical data, abort with an
-- actionable error message rather than silently dropping or ignoring data.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  duplicate_count integer;
  sample_platform text;
  sample_platform_user_id text;
  sample_count integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT platform, platform_user_id
    FROM public.connected_accounts
    WHERE platform_user_id IS NOT NULL
    GROUP BY platform, platform_user_id
    HAVING COUNT(*) > 1
  ) dups;

  IF duplicate_count > 0 THEN
    SELECT platform, platform_user_id, COUNT(*)::integer
    INTO sample_platform, sample_platform_user_id, sample_count
    FROM public.connected_accounts
    WHERE platform_user_id IS NOT NULL
    GROUP BY platform, platform_user_id
    HAVING COUNT(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'Migration aborted: Found % duplicate platform account grouping(s) in public.connected_accounts. (Example: platform "%", platform_user_id "%" has % occurrences). Clean up duplicates before applying the uniqueness constraint.',
      duplicate_count, sample_platform, sample_platform_user_id, sample_count;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. ENFORCE CROSS-USER PLATFORM ACCOUNT UNIQUENESS
-- Prevents multiple users from linking the exact same Instagram account ID.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_platform_user_idx
  ON public.connected_accounts(platform, platform_user_id)
  WHERE platform_user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. SERVER-ONLY ACCOUNT CREDENTIALS TABLE
-- Stores encrypted long-lived tokens and token metadata.
-- Cascades on delete when connected_account is removed.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_credentials (
  account_id uuid PRIMARY KEY REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  encrypted_token text NOT NULL,
  token_type text NOT NULL DEFAULT 'bearer',
  expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Automated updated_at maintenance
CREATE OR REPLACE FUNCTION public.set_account_credentials_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_account_credentials_updated_at ON public.account_credentials;
CREATE TRIGGER tr_account_credentials_updated_at
  BEFORE UPDATE ON public.account_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_account_credentials_updated_at();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) FOR ACCOUNT_CREDENTIALS
-- Enable RLS and define ZERO policies for anon or authenticated users.
-- Browser-origin queries receive 0 rows by default.
-- ----------------------------------------------------------------------------
ALTER TABLE public.account_credentials ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke permissions from client roles to ensure no access reflection
REVOKE ALL ON public.account_credentials FROM PUBLIC;
REVOKE ALL ON public.account_credentials FROM anon;
REVOKE ALL ON public.account_credentials FROM authenticated;

-- Grant permissions strictly to trusted server roles
GRANT ALL ON public.account_credentials TO service_role;
GRANT ALL ON public.account_credentials TO postgres;

-- ----------------------------------------------------------------------------
-- 5. HARDEN CONNECTED_ACCOUNTS CLIENT MUTATION PERMISSIONS
-- Drop client INSERT and UPDATE permissions to prevent browser users from
-- forging 'connected' status or tampering with platform_user_id.
-- All connection inserts/updates must occur through server-verified OAuth handlers.
-- Retain SELECT and DELETE policies so users can inspect their own connection
-- status and trigger disconnection.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own connected accounts" ON public.connected_accounts;
DROP POLICY IF EXISTS "Users can update own connected accounts" ON public.connected_accounts;
