-- ============================================================================
-- Insta Account Manager — Initial Authentication & Schema Migration
-- Migration: 20261018000000_init_auth_and_profiles.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- Stores creator workspace profile data 1:1 linked with auth.users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  creator_handle text,
  avatar_url text,
  plan_tier text NOT NULL DEFAULT 'creator',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT profiles_plan_tier_check CHECK (plan_tier IN ('creator', 'pro', 'agency')),
  CONSTRAINT profiles_creator_handle_format CHECK (
    creator_handle IS NULL OR creator_handle ~ '^[a-zA-Z0-9._]{1,30}$'
  )
);

CREATE INDEX IF NOT EXISTS profiles_creator_handle_idx ON public.profiles(creator_handle);

-- ----------------------------------------------------------------------------
-- 2. CONNECTED_ACCOUNTS TABLE
-- Prepares schema for future Meta/Instagram integration (Milestones 3+)
-- Note: Sensitive OAuth tokens are intentionally excluded from metadata
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'instagram',
  platform_user_id text,
  username text,
  status text NOT NULL DEFAULT 'disconnected',
  scopes text[] DEFAULT '{}'::text[] NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  connected_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT connected_accounts_user_platform_unique UNIQUE (user_id, platform),
  CONSTRAINT connected_accounts_platform_check CHECK (platform IN ('instagram', 'facebook')),
  CONSTRAINT connected_accounts_status_check CHECK (status IN ('connected', 'disconnected', 'expired'))
);

CREATE INDEX IF NOT EXISTS connected_accounts_user_idx ON public.connected_accounts(user_id);

-- ----------------------------------------------------------------------------
-- 3. CONTENT_DRAFTS TABLE
-- Prepares schema for future AI Studio & Content Planner drafts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  caption text,
  format text NOT NULL DEFAULT 'reel',
  status text NOT NULL DEFAULT 'draft',
  scheduled_for timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT content_drafts_format_check CHECK (format IN ('reel', 'carousel', 'post', 'story')),
  CONSTRAINT content_drafts_status_check CHECK (status IN ('draft', 'review', 'scheduled', 'published'))
);

CREATE INDEX IF NOT EXISTS content_drafts_user_created_idx ON public.content_drafts(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- Strict isolation ensuring users can only interact with their own records
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_drafts ENABLE ROW LEVEL SECURITY;

-- Profiles: View own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Profiles: Update own profile (plan_tier and email protected by trigger below)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Connected Accounts: Full CRUD scoped strictly to auth.uid()
CREATE POLICY "Users can view own connected accounts"
  ON public.connected_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connected accounts"
  ON public.connected_accounts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connected accounts"
  ON public.connected_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own connected accounts"
  ON public.connected_accounts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Content Drafts: Full CRUD scoped strictly to auth.uid()
CREATE POLICY "Users can view own drafts"
  ON public.content_drafts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drafts"
  ON public.content_drafts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts"
  ON public.content_drafts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own drafts"
  ON public.content_drafts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 5. PROFILE INTEGRITY TRIGGER
-- Prevents users from escalating plan_tier or changing id/email via client updates
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Prevent user from changing their primary key
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Changing profile ID is strictly prohibited.';
  END IF;

  -- Prevent user from changing their email directly in profiles (must use auth.users flow)
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'Profile email must be updated via Supabase Auth email change flow.';
  END IF;

  -- Prevent non-service-role from escalating plan_tier
  IF NEW.plan_tier <> OLD.plan_tier AND (current_user = 'authenticated') THEN
    RAISE EXCEPTION 'Modifying plan_tier requires administrative entitlement.';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_profile_fields ON public.profiles;
CREATE TRIGGER tr_protect_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_fields();

-- ----------------------------------------------------------------------------
-- 6. AUTOMATED PROFILE PROVISIONING ON SIGNUP
-- Executes with SECURITY DEFINER and fixed search_path to securely provision profiles
-- Contains exception safety so signups cannot be bricked by edge-case errors
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    creator_handle,
    avatar_url,
    plan_tier
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(LOWER(TRIM(NEW.raw_user_meta_data->>'creator_handle')), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'avatar_url'), ''),
    'creator'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    creator_handle = COALESCE(EXCLUDED.creator_handle, public.profiles.creator_handle),
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log warning to PostgreSQL log and safely allow user signup to proceed
  RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Restrict trigger function execution privileges
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
