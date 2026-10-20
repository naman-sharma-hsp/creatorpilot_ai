import React from "react";

export type BadgeVariant =
  | "neutral"
  | "success"
  | "warning"
  | "info"
  | "purple"
  | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

export function Badge({
  children,
  className = "",
  variant = "neutral",
  dot = false,
  ...props
}: BadgeProps) {
  const baseStyles =
    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-tight";

  const variantStyles: Record<BadgeVariant, string> = {
    neutral:
      "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60",
    success:
      "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60",
    warning:
      "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60",
    info:
      "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60",
    purple:
      "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60",
    outline:
      "bg-transparent text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700/80",
  };

  const dotStyles: Record<BadgeVariant, string> = {
    neutral: "bg-zinc-500 dark:bg-zinc-400",
    success: "bg-emerald-600 dark:bg-emerald-400",
    warning: "bg-amber-600 dark:bg-amber-400",
    info: "bg-blue-600 dark:bg-blue-400",
    purple: "bg-indigo-600 dark:bg-indigo-400",
    outline: "bg-zinc-500 dark:bg-zinc-400",
  };

  return (
    <span className={`${baseStyles} ${variantStyles[variant]} ${className}`} {...props}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[variant]}`} />}
      {children}
    </span>
  );
}
