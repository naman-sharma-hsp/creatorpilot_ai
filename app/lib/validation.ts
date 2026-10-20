/**
 * Strict server-side validation functions
 * Provides robust validation without external dependencies
 */

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return "Email address is required.";
  }
  // Standard RFC 5322 compatible email pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return "Please enter a valid email address.";
  }
  if (trimmed.length > 255) {
    return "Email address must not exceed 255 characters.";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) {
    return "Password is required.";
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (password.length > 128) {
    return "Password must not exceed 128 characters.";
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

export function validateCreatorHandle(handle: string): string | null {
  const trimmed = handle.trim().replace(/^@/, "");
  if (!trimmed) {
    return null; // Optional on signup
  }
  if (trimmed.length > 30) {
    return "Creator handle must not exceed 30 characters.";
  }
  // Standard Instagram handle pattern: alphanumeric, underscores, periods
  const handleRegex = /^[a-zA-Z0-9._]{1,30}$/;
  if (!handleRegex.test(trimmed)) {
    return "Handle can only contain letters, numbers, underscores, and periods.";
  }
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    return "Handle cannot start or end with a period.";
  }
  if (trimmed.includes("..")) {
    return "Handle cannot contain consecutive periods.";
  }
  return null;
}

export function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null; // Optional on signup
  }
  if (trimmed.length > 100) {
    return "Full name must not exceed 100 characters.";
  }
  return null;
}

/**
 * Validates a redirect URL to prevent open-redirect vulnerabilities.
 * Ensures the target is strictly an internal relative path on the same origin.
 */
export function validateSafeRedirect(targetUrl: string | null | undefined, fallback: string = "/"): string {
  if (!targetUrl || typeof targetUrl !== "string") {
    return fallback;
  }

  const trimmed = targetUrl.trim();

  // Must begin with a single slash, not double slash or backslash
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  // Reject dangerous protocols
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Reject control characters or newlines
  if (/[\r\n\t]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
