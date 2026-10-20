export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "insta_theme";
export const DEFAULT_THEME: ThemeMode = "dark";

/**
 * Validates whether an arbitrary input is a recognized ThemeMode.
 */
export function isValidThemeMode(val: unknown): val is ThemeMode {
  return val === "dark" || val === "light" || val === "system";
}

/**
 * Deterministically resolves the active theme mode to either 'dark' or 'light'.
 * If the mode is 'system', it defers to the provided systemTheme ('dark' or 'light').
 * Defaults to 'dark' for safety and backward compatibility.
 */
export function resolveTheme(
  mode: ThemeMode | string | null | undefined,
  systemTheme: ResolvedTheme = "dark"
): ResolvedTheme {
  if (mode === "system") {
    return systemTheme === "light" ? "light" : "dark";
  }
  if (mode === "light") {
    return "light";
  }
  return "dark";
}

/**
 * Determines the next theme mode when the user clicks the quick toggle button.
 * Toggling 'dark' switches to 'light'.
 * Toggling 'light' switches to 'dark'.
 */
export function getNextToggledTheme(currentResolved: ResolvedTheme): ThemeMode {
  return currentResolved === "dark" ? "light" : "dark";
}

/**
 * Reads the stored theme preference from localStorage or an injected storage mock.
 * Returns DEFAULT_THEME ('dark') if unavailable, invalid, or during SSR.
 */
export function getStoredTheme(
  storage?: Pick<Storage, "getItem"> | null
): ThemeMode {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== "undefined"
        ? window.localStorage
        : null;

    if (!store) return DEFAULT_THEME;

    const stored = store.getItem(THEME_STORAGE_KEY);
    if (isValidThemeMode(stored)) {
      return stored;
    }
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Detects the OS color scheme preference.
 * Returns 'dark' by default when unresolvable or during SSR.
 */
export function getSystemTheme(
  matcher?: ((query: string) => { matches: boolean }) | null
): ResolvedTheme {
  try {
    const match =
      matcher !== undefined
        ? matcher
        : typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? (q: string) => window.matchMedia(q)
        : null;

    if (!match) return "dark";
    return match("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

/**
 * Applies the resolved theme to the DOM document element.
 * Updates classList ('dark' vs 'light'), data-theme attribute, and colorScheme.
 */
export function applyThemeToDocument(
  resolved: ResolvedTheme,
  doc?: { documentElement?: HTMLElement } | null
): void {
  try {
    const targetDoc =
      doc !== undefined
        ? doc
        : typeof document !== "undefined"
        ? document
        : null;

    if (!targetDoc || !targetDoc.documentElement) return;
    const root = targetDoc.documentElement;

    if (resolved === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
      root.setAttribute("data-theme", "dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
      root.setAttribute("data-theme", "light");
      root.style.colorScheme = "light";
    }
  } catch {
    // Non-fatal if DOM access is restricted
  }
}
