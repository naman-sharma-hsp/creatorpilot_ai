-- ============================================================================
-- Insta Account Manager — Add Creator Preferences to Profiles
-- Migration: 20261019000000_add_profile_preferences.sql
-- ============================================================================

-- Minimal additive schema migration for Milestone 5, Phase 2.
-- Adds a JSONB column to store creator identity preferences, niche configurations,
-- and confirmation status without breaking existing profiles or requiring extra tables.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS preferences jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Note: Existing RLS policies on public.profiles:
--   "Users can view own profile" (SELECT using auth.uid() = id)
--   "Users can update own profile" (UPDATE using auth.uid() = id)
-- automatically govern this column with strict per-user isolation.
-- The protect_profile_fields trigger permits updates to preferences.
