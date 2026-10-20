"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";

export type { ThemeMode, ResolvedTheme } from "./theme-utils";
export {
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  isValidThemeMode,
  resolveTheme,
  getNextToggledTheme,
  getSystemTheme,
  getStoredTheme,
  applyThemeToDocument,
} from "./theme-utils";

import {
  type ThemeMode,
  type ResolvedTheme,
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  isValidThemeMode,
  resolveTheme,
  getNextToggledTheme,
  getSystemTheme,
  getStoredTheme,
  applyThemeToDocument,
} from "./theme-utils";

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  isMounted: boolean;
}

const emptySubscribe = () => () => {};

function subscribeSystemTheme(callback: () => void) {
  try {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
  } catch {
    return () => {};
  }
}

let themeListeners: Array<() => void> = [];

function subscribeStoredTheme(callback: () => void) {
  themeListeners.push(callback);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      callback();
    }
  };
  try {
    window.addEventListener("storage", handleStorage);
    return () => {
      themeListeners = themeListeners.filter((l) => l !== callback);
      window.removeEventListener("storage", handleStorage);
    };
  } catch {
    return () => {
      themeListeners = themeListeners.filter((l) => l !== callback);
    };
  }
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isMounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    () => getSystemTheme(),
    () => "dark" as ResolvedTheme
  );
  const theme = useSyncExternalStore(
    subscribeStoredTheme,
    () => getStoredTheme(),
    () => DEFAULT_THEME
  );

  const resolvedTheme: ResolvedTheme = resolveTheme(theme, systemTheme);

  // Synchronize document classes on client whenever resolved theme changes or on mount
  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((newMode: ThemeMode) => {
    const validMode: ThemeMode = isValidThemeMode(newMode) ? newMode : DEFAULT_THEME;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, validMode);
    } catch {
      // Non-fatal if localStorage is restricted (private browsing / security policies)
    }

    themeListeners.forEach((l) => l());

    const currentSys = getSystemTheme();
    const resolved = resolveTheme(validMode, currentSys);
    applyThemeToDocument(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme = getNextToggledTheme(resolvedTheme);
    setTheme(nextTheme);
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        toggleTheme,
        isMounted,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    // Fallback safe value if rendered outside ThemeProvider
    return {
      theme: DEFAULT_THEME,
      resolvedTheme: "dark",
      setTheme: () => {},
      toggleTheme: () => {},
      isMounted: false,
    };
  }
  return context;
}
