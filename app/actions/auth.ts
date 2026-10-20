"use server";

import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "../lib/supabase/server";
import {
  validateEmail,
  validatePassword,
  validateCreatorHandle,
  validateFullName,
  validateSafeRedirect,
} from "../lib/validation";
import type { ActionState } from "../lib/definitions";

export async function loginAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = (formData.get("email") as string) || "";
  const password = (formData.get("password") as string) || "";
  const returnToRaw = formData.get("returnTo") as string | null;
  const returnTo = validateSafeRedirect(returnToRaw, "/");

  const emailError = validateEmail(email);
  const passwordError = !password ? "Password is required." : null;

  if (emailError || passwordError) {
    return {
      success: false,
      fieldErrors: {
        ...(emailError && { email: emailError }),
        ...(passwordError && { password: passwordError }),
      },
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error:
        "Supabase credentials are not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      if (
        error.message.includes("Invalid login credentials") ||
        error.message.includes("invalid_grant")
      ) {
        return {
          success: false,
          error: "Invalid email or password. Please verify your credentials.",
        };
      }
      return {
        success: false,
        error: error.message || "Failed to sign in. Please try again.",
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }

  redirect(returnTo);
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = (formData.get("email") as string) || "";
  const password = (formData.get("password") as string) || "";
  const fullName = (formData.get("fullName") as string) || "";
  const creatorHandle = (formData.get("creatorHandle") as string) || "";

  const fieldErrors: Record<string, string> = {};

  const emailError = validateEmail(email);
  if (emailError) fieldErrors.email = emailError;

  const passwordError = validatePassword(password);
  if (passwordError) fieldErrors.password = passwordError;

  const handleError = validateCreatorHandle(creatorHandle);
  if (handleError) fieldErrors.creatorHandle = handleError;

  const nameError = validateFullName(fullName);
  if (nameError) fieldErrors.fullName = nameError;

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      fieldErrors,
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error:
        "Supabase credentials are not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    };
  }

  let requiresEmailConfirmation = false;

  try {
    const supabase = await createClient();
    const cleanHandle = creatorHandle ? creatorHandle.trim().replace(/^@/, "").toLowerCase() : null;

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim() || null,
          creator_handle: cleanHandle,
        },
      },
    });

    if (error) {
      return {
        success: false,
        error: error.message || "Failed to create account. Please try again.",
      };
    }

    // If session is null but user exists, email confirmation is active in Supabase project
    if (data.user && !data.session) {
      requiresEmailConfirmation = true;
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }

  if (requiresEmailConfirmation) {
    return {
      success: true,
      message:
        "Account created! We sent a verification email. Please confirm your email address to log in.",
    };
  }

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // Ignore signOut errors and proceed to redirect
    }
  }

  redirect("/login");
}
