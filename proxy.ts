import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "./app/lib/supabase/proxy";
import { validateSafeRedirect } from "./app/lib/validation";

const PUBLIC_AUTH_ROUTES = ["/login", "/signup", "/auth/callback"];

export async function proxy(request: NextRequest) {
  const { response, user, isConfigured } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  const isPublicAuthRoute = PUBLIC_AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // If Supabase credentials are not configured, allow navigation with in-app notice
  if (!isConfigured) {
    return response;
  }

  // If unauthenticated and attempting to visit a protected route, redirect to /login
  if (!user && !isPublicAuthRoute) {
    const returnTo = encodeURIComponent(pathname);
    const loginUrl = new URL(`/login?returnTo=${returnTo}`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated and visiting login or signup, redirect to dashboard or safe returnTo
  if (user && isPublicAuthRoute && pathname !== "/auth/callback") {
    const searchParams = request.nextUrl.searchParams;
    const returnToParam = searchParams.get("returnTo");
    const target = validateSafeRedirect(returnToParam, "/");
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}

export default proxy;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
