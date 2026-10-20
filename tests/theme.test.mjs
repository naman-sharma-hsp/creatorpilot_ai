import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Register custom hook for Node test runner resolving .ts files
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        err &&
        err.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const {
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  isValidThemeMode,
  resolveTheme,
  getNextToggledTheme,
  getStoredTheme,
  getSystemTheme,
  applyThemeToDocument,
} = await import("../app/lib/theme/theme-utils.ts");

test("Theme System Constants: default is dark and storage key is preserved", () => {
  assert.equal(
    DEFAULT_THEME,
    "dark",
    "Default theme must be strictly 'dark' to prevent breaking changes"
  );
  assert.equal(
    THEME_STORAGE_KEY,
    "insta_theme",
    "Storage key must be exactly 'insta_theme'"
  );
});

test("Theme Validation: accurately distinguishes valid theme modes", () => {
  assert.equal(isValidThemeMode("dark"), true);
  assert.equal(isValidThemeMode("light"), true);
  assert.equal(isValidThemeMode("system"), true);

  assert.equal(isValidThemeMode(""), false);
  assert.equal(isValidThemeMode("auto"), false);
  assert.equal(isValidThemeMode("sepia"), false);
  assert.equal(isValidThemeMode(null), false);
  assert.equal(isValidThemeMode(undefined), false);
  assert.equal(isValidThemeMode(123), false);
  assert.equal(isValidThemeMode({}), false);
});

test("Theme Resolution: explicit modes override system preference", () => {
  // Dark mode always resolves to dark
  assert.equal(resolveTheme("dark", "light"), "dark");
  assert.equal(resolveTheme("dark", "dark"), "dark");

  // Light mode always resolves to light
  assert.equal(resolveTheme("light", "light"), "light");
  assert.equal(resolveTheme("light", "dark"), "light");
});

test("Theme Resolution: system mode delegates strictly to OS preference", () => {
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("system", "light"), "light");
});

test("Theme Resolution: invalid or empty modes fall back safely to dark", () => {
  assert.equal(resolveTheme(null, "light"), "dark");
  assert.equal(resolveTheme(undefined, "light"), "dark");
  assert.equal(resolveTheme("unknown", "light"), "dark");
  assert.equal(resolveTheme("", "light"), "dark");
});

test("Theme Toggling: toggles back and forth between dark and light", () => {
  assert.equal(getNextToggledTheme("dark"), "light");
  assert.equal(getNextToggledTheme("light"), "dark");
});

test("Theme Storage: reads valid stored values and falls back safely", () => {
  const createMockStorage = (val) => ({
    getItem: (key) => (key === THEME_STORAGE_KEY ? val : null),
  });

  assert.equal(getStoredTheme(createMockStorage("light")), "light");
  assert.equal(getStoredTheme(createMockStorage("dark")), "dark");
  assert.equal(getStoredTheme(createMockStorage("system")), "system");

  // Invalid or empty fallbacks
  assert.equal(getStoredTheme(createMockStorage("invalid")), "dark");
  assert.equal(getStoredTheme(createMockStorage(null)), "dark");
  assert.equal(getStoredTheme(null), "dark");

  // Throws during restricted private browsing
  const throwingStorage = {
    getItem: () => {
      throw new Error("QuotaExceeded / SecurityError");
    },
  };
  assert.equal(getStoredTheme(throwingStorage), "dark");
});

test("System Theme Detection: checks matchMedia query correctly", () => {
  const darkMatcher = (q) => ({
    matches: q.includes("prefers-color-scheme: dark"),
  });
  const lightMatcher = () => ({
    matches: false,
  });

  assert.equal(getSystemTheme(darkMatcher), "dark");
  assert.equal(getSystemTheme(lightMatcher), "light");
  assert.equal(getSystemTheme(null), "dark");

  const throwingMatcher = () => {
    throw new Error("matchMedia unsupported");
  };
  assert.equal(getSystemTheme(throwingMatcher), "dark");
});

test("DOM Application: correctly updates documentElement attributes and classes", () => {
  function createMockElement() {
    const classes = new Set();
    const attrs = new Map();
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: (k) => attrs.get(k),
      style: {
        colorScheme: "",
      },
      _classes: classes,
      _attrs: attrs,
    };
  }

  // Apply dark
  const elDark = createMockElement();
  applyThemeToDocument("dark", { documentElement: elDark });
  assert.equal(elDark.classList.contains("dark"), true);
  assert.equal(elDark.classList.contains("light"), false);
  assert.equal(elDark.getAttribute("data-theme"), "dark");
  assert.equal(elDark.style.colorScheme, "dark");

  // Apply light
  const elLight = createMockElement();
  applyThemeToDocument("light", { documentElement: elLight });
  assert.equal(elLight.classList.contains("light"), true);
  assert.equal(elLight.classList.contains("dark"), false);
  assert.equal(elLight.getAttribute("data-theme"), "light");
  assert.equal(elLight.style.colorScheme, "light");

  // Switch dark -> light on same element
  applyThemeToDocument("dark", { documentElement: elLight });
  assert.equal(elLight.classList.contains("dark"), true);
  assert.equal(elLight.classList.contains("light"), false);
  assert.equal(elLight.getAttribute("data-theme"), "dark");
  assert.equal(elLight.style.colorScheme, "dark");
});

test("Anti-FOUC Layout Contract: verify app/layout.tsx inline script matches theme specifications", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const layoutPath = path.resolve(__dirname, "../app/layout.tsx");
  const layoutContent = fs.readFileSync(layoutPath, "utf-8");

  // Verify key contract tokens in layout.tsx
  assert.ok(
    layoutContent.includes("themeInitScript"),
    "layout.tsx must contain themeInitScript"
  );
  assert.ok(
    layoutContent.includes("localStorage.getItem('insta_theme')"),
    "themeInitScript must inspect 'insta_theme' storage key"
  );
  assert.ok(
    layoutContent.includes("isDark = true; // Default to dark mode"),
    "themeInitScript must default to dark mode"
  );
  assert.ok(
    layoutContent.includes("prefers-color-scheme: dark"),
    "themeInitScript must support system preference"
  );
  assert.ok(
    layoutContent.includes("suppressHydrationWarning"),
    "html tag must have suppressHydrationWarning to prevent SSR mismatch warning"
  );
  assert.ok(
    layoutContent.includes("ThemeProvider"),
    "RootLayout must wrap content with ThemeProvider"
  );
});
