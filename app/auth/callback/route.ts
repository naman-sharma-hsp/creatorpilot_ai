import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { validateSafeRedirect } from "../../lib/validation";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextRaw = requestUrl.searchParams.get("next");
  const next = validateSafeRedirect(nextRaw, "/");

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL(next, request.url));
      }
    } catch {
      // Failed exchange falls through to error redirect
    }
  }

  // Return user to login with an explicit error parameter if verification failed
  return NextResponse.redirect(
    new URL(`/login?error=Invalid+or+expired+verification+link`, request.url)
  );
}
