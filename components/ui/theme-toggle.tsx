"use client";

import React from "react";
import { SunIcon, MoonIcon, MonitorIcon } from "./icons";
import { useTheme, type ThemeMode } from "../../app/lib/theme/theme-context";

export interface ThemeToggleProps {
  variant?: "button" | "segmented" | "compact";
  className?: string;
  size?: "sm" | "md";
}

/**
 * Universal theme switcher for CreatorPilot AI.
 * Supports a compact header/sidebar toggle button and a full segmented radio selector for Settings.
 */
export function ThemeToggle({
  variant = "button",
  className = "",
  size = variant === "compact" ? "sm" : "md",
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme, isMounted } = useTheme();

  if (variant === "segmented") {
    const options: { mode: ThemeMode; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
      { mode: "dark", label: "Dark", icon: MoonIcon },
      { mode: "light", label: "Light", icon: SunIcon },
      { mode: "system", label: "System", icon: MonitorIcon },
    ];

    return (
      <div
        role="radiogroup"
        aria-label="Theme mode selection"
        className={`inline-flex rounded-xl p-1 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 ${className}`}
      >
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = isMounted ? theme === opt.mode : opt.mode === "dark";

          return (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setTheme(opt.mode)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all select-none ${
                isSelected
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs dark:shadow-none border border-zinc-200/80 dark:border-zinc-700/60 font-semibold"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent"
              }`}
            >
              <Icon size={14} className={isSelected ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400"} />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Default compact toggle button
  const isDark = isMounted ? resolvedTheme === "dark" : true;
  const buttonSizeClasses = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const iconSize = size === "sm" ? 15 : 17;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`relative flex ${buttonSizeClasses} items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
    >
      {isDark ? (
        <SunIcon size={iconSize} className="transition-transform duration-200 hover:rotate-12 text-amber-400" />
      ) : (
        <MoonIcon size={iconSize} className="transition-transform duration-200 -rotate-12 text-indigo-600" />
      )}
    </button>
  );
}
