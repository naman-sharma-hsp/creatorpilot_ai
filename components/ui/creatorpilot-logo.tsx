"use client";

import React from "react";
import Image from "next/image";

export interface CreatorPilotLogoProps {
  variant?: "horizontal" | "icon" | "stacked";
  size?: number;
  className?: string;
  priority?: boolean;
}

/**
 * Official brand asset component for CreatorPilot AI.
 * Automatically handles theme adaptation (Light & Dark modes) with zero FOUC.
 */
export function CreatorPilotLogo({
  variant = "horizontal",
  size,
  className = "",
  priority = true,
}: CreatorPilotLogoProps) {
  if (variant === "icon") {
    const dim = size || 32;
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ width: dim, height: dim }}
      >
        <Image
          src="/brand/logo-icon.png"
          alt="CreatorPilot AI Icon"
          width={dim * 2}
          height={dim * 2}
          priority={priority}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  if (variant === "stacked") {
    const width = size ? size * 2 : 280;
    const height = Math.round(width * 0.67);

    return (
      <div className={`relative inline-block ${className}`}>
        {/* Dark theme logo (shown in dark mode) */}
        <Image
          src="/brand/logo-stacked-dark.png"
          alt="CreatorPilot AI Logo"
          width={width}
          height={height}
          priority={priority}
          className="hidden dark:block w-auto h-auto max-w-full"
        />
        {/* Light theme logo (shown in light mode) */}
        <Image
          src="/brand/logo-stacked-light.png"
          alt="CreatorPilot AI Logo"
          width={width}
          height={height}
          priority={priority}
          className="block dark:hidden w-auto h-auto max-w-full"
        />
      </div>
    );
  }

  // Default: Horizontal Lockup (Icon on left + "CreatorPilot AI" on right)
  // Aspect ratio is 960x180 (5.33 : 1)
  const height = size || 36;
  const width = Math.round(height * 5.33);

  return (
    <div
      className={`relative inline-flex items-center shrink-0 ${className}`}
      style={{ height }}
    >
      {/* Dark theme horizontal lockup */}
      <Image
        src="/brand/logo-horizontal-dark.png"
        alt="CreatorPilot AI"
        width={width * 2}
        height={height * 2}
        priority={priority}
        className="hidden dark:block h-full w-auto object-contain"
      />
      {/* Light theme horizontal lockup */}
      <Image
        src="/brand/logo-horizontal-light.png"
        alt="CreatorPilot AI"
        width={width * 2}
        height={height * 2}
        priority={priority}
        className="block dark:hidden h-full w-auto object-contain"
      />
    </div>
  );
}

/**
 * Dedicated Brand Icon Mark inside a stylized luxury container.
 * Perfect for Sidebar header, avatar fallbacks, and quick action buttons.
 */
export function CreatorPilotBrandMark({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-xl bg-gradient-to-br from-zinc-900 to-black dark:from-zinc-950 dark:to-black border border-zinc-200/80 dark:border-zinc-800 shadow-md shadow-indigo-950/20 overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 bg-radial from-indigo-500/10 via-transparent to-transparent pointer-events-none" />
      <Image
        src="/brand/logo-icon.png"
        alt="CreatorPilot AI"
        width={size * 2}
        height={size * 2}
        className="w-[82%] h-[82%] object-contain"
      />
    </div>
  );
}
