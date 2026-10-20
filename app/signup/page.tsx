"use client";

import React, { useActionState, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signupAction } from "../actions/auth";
import {
  InstagramIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  ShieldCheckIcon,
  EyeIcon,
  EyeOffIcon,
} from "../../components/ui/icons";
import { Button } from "../../components/ui/button";
import { ThemeToggle } from "../../components/ui/theme-toggle";
import { CreatorPilotBrandMark } from "../../components/ui/creatorpilot-logo";
import type { ActionState } from "../lib/definitions";

const initialState: ActionState = {};

function SignupForm() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/";

  const [state, formAction, isPending] = useActionState(signupAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-md space-y-6">
      {/* Brand Header */}
      <div className="text-center space-y-2">
        <CreatorPilotBrandMark size={52} className="mx-auto mb-3 shadow-xl ring-1 ring-white/10" />
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Create your CreatorPilot AI Account
        </h1>
        <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
          Start tracking verified audience telemetry and AI creative planning with CreatorPilot AI.
        </p>
      </div>

      {/* Surface Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-6 sm:p-8 shadow-xl backdrop-blur-md">
        {state.success && state.message ? (
          /* Email Confirmation Sent Notification */
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon size={24} />
            </div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
              Check Your Email
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-sm mx-auto">
              {state.message}
            </p>
            <div className="pt-4">
              <Link
                href={`/login${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                className="inline-flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium px-4 py-2 border border-zinc-300 dark:border-zinc-700/60 transition-colors"
              >
                Proceed to Sign In
              </Link>
            </div>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {/* Global Error Banner */}
            {state.error && (
              <div className="flex items-start gap-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 p-3 text-xs text-rose-800 dark:text-rose-300">
                <AlertCircleIcon size={16} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <span>{state.error}</span>
              </div>
            )}

            {/* Full Name Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="fullName"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Full Name
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="Alex Morgan"
                className={`w-full rounded-lg border bg-zinc-50 dark:bg-zinc-950/80 px-3.5 py-2.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
                  state.fieldErrors?.fullName
                    ? "border-rose-500/80 ring-1 ring-rose-500/50"
                    : "border-zinc-300 dark:border-zinc-800 focus:border-indigo-500"
                }`}
              />
              {state.fieldErrors?.fullName && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {state.fieldErrors.fullName}
                </p>
              )}
            </div>

            {/* Creator Handle Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="creatorHandle"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Creator Handle (optional)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-xs text-zinc-400 dark:text-zinc-500 pointer-events-none">
                  @
                </span>
                <input
                  id="creatorHandle"
                  name="creatorHandle"
                  type="text"
                  autoComplete="username"
                  placeholder="creatorname"
                  className={`w-full rounded-lg border bg-zinc-50 dark:bg-zinc-950/80 pl-8 pr-3.5 py-2.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
                    state.fieldErrors?.creatorHandle
                      ? "border-rose-500/80 ring-1 ring-rose-500/50"
                      : "border-zinc-300 dark:border-zinc-800 focus:border-indigo-500"
                  }`}
                />
              </div>
              {state.fieldErrors?.creatorHandle && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {state.fieldErrors.creatorHandle}
                </p>
              )}
            </div>

            {/* Email Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="creator@domain.com"
                className={`w-full rounded-lg border bg-zinc-50 dark:bg-zinc-950/80 px-3.5 py-2.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
                  state.fieldErrors?.email
                    ? "border-rose-500/80 ring-1 ring-rose-500/50"
                    : "border-zinc-300 dark:border-zinc-800 focus:border-indigo-500"
                }`}
              />
              {state.fieldErrors?.email && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {state.fieldErrors.email}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  placeholder="••••••••••••"
                  className={`w-full rounded-lg border bg-zinc-50 dark:bg-zinc-950/80 pl-3.5 pr-10 py-2.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
                    state.fieldErrors?.password
                      ? "border-rose-500/80 ring-1 ring-rose-500/50"
                      : "border-zinc-300 dark:border-zinc-800 focus:border-indigo-500"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 focus:outline-none focus-visible:text-indigo-500 transition-colors"
                >
                  {showPassword ? (
                    <EyeOffIcon size={16} className="transition-transform duration-150 active:scale-95" />
                  ) : (
                    <EyeIcon size={16} className="transition-transform duration-150 active:scale-95" />
                  )}
                </button>
              </div>
              {state.fieldErrors?.password && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {state.fieldErrors.password}
                </p>
              )}
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Minimum 8 characters with at least one letter and one number.
              </p>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isPending}
              className="w-full justify-center shadow-md shadow-indigo-950/50 mt-2"
            >
              <span>Create Account</span>
            </Button>
          </form>
        )}

        {/* Security Footnote */}
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
          <ShieldCheckIcon size={14} className="text-zinc-400 dark:text-zinc-500" />
          <span>PostgreSQL Row Level Security Guarded</span>
        </div>
      </div>

      {/* Switch to Login */}
      <p className="text-center text-xs text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link
          href={`/login${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
          className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 selection:bg-indigo-500/30 selection:text-indigo-900 dark:selection:text-indigo-200 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="compact" />
      </div>
      <Suspense
        fallback={
          <div className="text-xs text-zinc-500 animate-pulse">Loading...</div>
        }
      >
        <SignupForm />
      </Suspense>
    </div>
  );
}
