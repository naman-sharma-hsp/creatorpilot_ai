import React from "react";
import { Badge } from "./badge";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  badge?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  badge,
  title,
  description,
  action,
  secondaryAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 px-6 py-12 text-center ${className}`}
    >
      {badge && (
        <Badge variant="purple" className="mb-4">
          {badge}
        </Badge>
      )}

      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 shadow-xs dark:shadow-none">
          {icon}
        </div>
      )}

      <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {description}
      </p>

      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
