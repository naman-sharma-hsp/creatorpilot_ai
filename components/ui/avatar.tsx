"use client";

import React, { useState } from "react";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  initials?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  shape?: "circle" | "rounded";
  ring?: boolean;
}

const SIZE_CLASSES: Record<string, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-12 w-12 text-base",
};

/**
 * Production-ready Creator Avatar component.
 * Displays synced Instagram profile picture with graceful fallback to styled initials.
 * Handles missing URLs and broken image links cleanly without throwing runtime layout shifts.
 */
export function Avatar({
  src,
  alt = "Creator Avatar",
  initials = "CR",
  size = "md",
  shape = "circle",
  ring = true,
  className = "",
  ...props
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  const roundedClass = shape === "circle" ? "rounded-full" : "rounded-xl";
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const ringClass = ring
    ? "border border-violet-700/50 shadow-xs ring-1 ring-white/10"
    : "border border-zinc-800";

  const showImage = Boolean(src && !imageError);

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none ${roundedClass} ${sizeClass} ${ringClass} bg-violet-950/80 text-violet-200 transition-all ${className}`}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt={alt}
          onError={() => setImageError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="uppercase tracking-wider font-semibold">
          {initials.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}
