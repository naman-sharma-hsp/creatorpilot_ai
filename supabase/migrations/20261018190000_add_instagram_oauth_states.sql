-- ============================================================================
-- Insta Account Manager — Instagram OAuth State Infrastructure
-- Migration: 20261018190000_add_instagram_oauth_states.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SERVER-ONLY INSTAGRAM OAUTH STATES TABLE
-- Stores SHA-256 hashed state tokens linked to authenticated user profiles.
-- The raw state token is NEVER stored in the database.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instagram_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  consumed_at timestamptz NULL
);

-- Performance indices for lookups and expired state cleanup
CREATE INDEX IF NOT EXISTS instagram_oauth_states_user_idx
  ON public.instagram_oauth_states(user_id);

CREATE INDEX IF NOT EXISTS instagram_oauth_states_expires_idx
  ON public.instagram_oauth_states(expires_at);

-- ----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS) FOR INSTAGRAM_OAUTH_STATES
-- Enable RLS and define ZERO policies for anon or authenticated client roles.
-- Browser-origin queries receive 0 rows by default.
-- ----------------------------------------------------------------------------
ALTER TABLE public.instagram_oauth_states ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all privileges from client roles
REVOKE ALL ON public.instagram_oauth_states FROM PUBLIC;
REVOKE ALL ON public.instagram_oauth_states FROM anon;
REVOKE ALL ON public.instagram_oauth_states FROM authenticated;

-- Grant least-privilege operations strictly to trusted administrative server roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_oauth_states TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_oauth_states TO postgres;

-- ----------------------------------------------------------------------------
-- 3. ATOMIC OAUTH STATE CONSUMPTION FUNCTION
-- Atomically validates and consumes a state record in a single operation.
-- Prevents race conditions and concurrent replay attacks where multiple
-- callbacks might attempt to exchange the same authorization state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_instagram_oauth_state(p_state_hash text)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict input validation: must be a 64-character lowercase hex SHA-256 digest
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.instagram_oauth_states
  SET consumed_at = now()
  WHERE state_hash = p_state_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING instagram_oauth_states.user_id;
END;
$$;

-- Restrict function execution strictly to service_role and postgres
REVOKE ALL ON FUNCTION public.consume_instagram_oauth_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_instagram_oauth_state(text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_instagram_oauth_state(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_instagram_oauth_state(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_instagram_oauth_state(text) TO postgres;

-- ----------------------------------------------------------------------------
-- 4. EXPIRED STATE CLEANUP FUNCTION
-- Safely purges stale states expired more than 24 hours ago.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_instagram_oauth_states()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.instagram_oauth_states
  WHERE expires_at < (now() - INTERVAL '1 day');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Restrict cleanup function execution strictly to service_role and postgres
REVOKE ALL ON FUNCTION public.cleanup_expired_instagram_oauth_states() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_instagram_oauth_states() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_expired_instagram_oauth_states() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_instagram_oauth_states() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_instagram_oauth_states() TO postgres;
