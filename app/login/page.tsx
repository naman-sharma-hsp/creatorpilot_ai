"use client";

import React, { useActionState, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction } from "../actions/auth";
import { InstagramIcon, AlertCircleIcon, ShieldCheckIcon, EyeIcon, EyeOffIcon } from "../../components/ui/icons";
import { Button } from "../../components/ui/button";
import { ThemeToggle } from "../../components/ui/theme-toggle";
import { CreatorPilotBrandMark } from "../../components/ui/creatorpilot-logo";
import type { ActionState } from "../lib/definitions";

const initialState: ActionState = {};

function LoginForm() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/";
  const urlError = searchParams.get("error");

  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-md space-y-6">
      {/* Brand Header */}
      <div className="text-center space-y-2">
        <CreatorPilotBrandMark size={52} className="mx-auto mb-3 shadow-xl ring-1 ring-white/10" />
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Sign in to CreatorPilot AI
        </h1>
        <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
          Enter your credentials to access your creator dashboard.
        </p>
      </div>

      {/* Surface Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-6 sm:p-8 shadow-xl backdrop-blur-md">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="returnTo" value={returnTo} />

          {/* Error Banner */}
          {(state.error || urlError) && (
            <div className="flex items-start gap-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 p-3 text-xs text-rose-800 dark:text-rose-300">
              <AlertCircleIcon size={16} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>{state.error || urlError}</span>
            </div>
          )}

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
              <p className="text-[11px] text-rose-600 dark:text-rose-400">{state.fieldErrors.email}</p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isPending}
            className="w-full justify-center shadow-md shadow-indigo-950/50 mt-2"
          >
            <span>Sign In</span>
          </Button>
        </form>

        {/* Security Footnote */}
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
          <ShieldCheckIcon size={14} className="text-zinc-400 dark:text-zinc-500" />
          <span>Encrypted Supabase Session Authentication</span>
        </div>
      </div>

      {/* Switch to Signup */}
      <p className="text-center text-xs text-zinc-600 dark:text-zinc-400">
        Don&apos;t have an account?{" "}
        <Link
          href={`/signup${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
          className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
        >
          Create one now
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
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
        <LoginForm />
      </Suspense>
    </div>
  );
}
