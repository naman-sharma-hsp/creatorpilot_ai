import "server-only";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

export const INSTAGRAM_CALLBACK_PATH = "/api/auth/instagram/callback";

export interface TrustedOriginOptions {
  appUrl?: string;
  isProduction?: boolean;
}

/**
 * Resolves and validates the trusted application origin.
 * Requires APP_URL as the trusted server configuration.
 * Does not fall back to Host, X-Forwarded-Host, X-Forwarded-Proto, or other request headers.
 * Throws a descriptive error if APP_URL is missing, invalid, or uses an insecure protocol in production.
 */
export function getTrustedAppOrigin(options?: TrustedOriginOptions): string {
  const rawUrl =
    options?.appUrl !== undefined ? options.appUrl : process.env.APP_URL;

  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error(
      "Missing required server configuration: APP_URL is not set. Please configure APP_URL (e.g. APP_URL=http://localhost:3000)."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `Invalid server configuration: APP_URL '${rawUrl}' is not a valid absolute URL.`
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Invalid server configuration: APP_URL protocol must be 'http:' or 'https:', received '${parsed.protocol}'.`
    );
  }

  const isProd =
    options?.isProduction ?? (process.env.NODE_ENV === "production");

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");

  if (isProd && parsed.protocol !== "https:" && !isLocalhost) {
    throw new Error(
      `Insecure server configuration: APP_URL must use 'https:' in production environments. Received: '${parsed.origin}'.`
    );
  }

  return parsed.origin;
}

/**
 * Constructs the canonical, trusted Instagram OAuth redirect URI.
 * Guaranteed to match identically across initiation and callback routes.
 */
export function getTrustedCallbackUri(options?: TrustedOriginOptions): string {
  const origin = getTrustedAppOrigin(options);
  return `${origin}${INSTAGRAM_CALLBACK_PATH}`;
}
