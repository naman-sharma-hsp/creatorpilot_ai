"use client";

import React from "react";
import {
  OverviewIcon,
  AnalyticsIcon,
  AiStudioIcon,
  CalendarIcon,
  LibraryIcon,
  SettingsIcon,
  InstagramIcon,
  ArrowUpRightIcon,
  XIcon,
  LogOutIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Avatar } from "../ui/avatar";
import { ThemeToggle } from "../ui/theme-toggle";
import { CreatorPilotBrandMark } from "../ui/creatorpilot-logo";
import type { Profile } from "../../app/lib/definitions";
import type { InstagramStatusData } from "../../app/lib/instagram/use-instagram-status";
import { logoutAction } from "../../app/actions/auth";

export interface NavItem {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  badge?: string;
  badgeVariant?: "neutral" | "purple" | "success" | "warning";
}

export const NAV_ITEMS: NavItem[] = [
  { id: "overview", name: "Overview", icon: OverviewIcon },
  { id: "analytics", name: "Analytics", icon: AnalyticsIcon },
  { id: "ai-studio", name: "AI Studio", icon: AiStudioIcon, badge: "AI", badgeVariant: "purple" },
  { id: "planner", name: "Content Planner", icon: CalendarIcon },
  { id: "library", name: "Content Library", icon: LibraryIcon },
  { id: "settings", name: "Settings & Connections", icon: SettingsIcon },
];

export interface SidebarProps {
  activeTab?: string;
  onSelectTab?: (id: string) => void;
  onCloseMobile?: () => void;
  onOpenConnectModal?: () => void;
  isMobile?: boolean;
  profile?: Profile | null;
  instagramStatus?: InstagramStatusData | null;
  isInstagramLoading?: boolean;
}

export function Sidebar({
  activeTab = "overview",
  onSelectTab,
  onCloseMobile,
  onOpenConnectModal,
  isMobile = false,
  profile,
  instagramStatus,
  isInstagramLoading = false,
}: SidebarProps) {
  const handleNavClick = (id: string) => {
    if (onSelectTab) {
      onSelectTab(id);
    }
    if (isMobile && onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <aside
      className={`flex h-full flex-col bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800/80 ${
        isMobile ? "w-72 p-5" : "w-64 p-4"
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between px-2 py-2 mb-6">
        <div className="flex items-center gap-3">
          <CreatorPilotBrandMark size={36} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight text-zinc-900 dark:text-white">
                CreatorPilot AI
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700/60">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">Creator Intelligence</p>
          </div>
        </div>

        {isMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          >
            <XIcon size={18} />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Platform
        </div>

        <nav aria-label="Main Navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-indigo-50 dark:bg-indigo-600/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/25 shadow-xs font-semibold"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    size={17}
                    className={`transition-colors ${
                      isActive
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300"
                    }`}
                  />
                  <span>{item.name}</span>
                </div>

                {item.badge && (
                  <Badge
                    variant={item.badgeVariant || "neutral"}
                    className="text-[10px] px-1.5 py-0.2"
                  >
                    {item.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Account Connection Status Footnote */}
      <div className="mt-auto pt-4 border-t border-zinc-200 dark:border-zinc-900 space-y-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/80 dark:bg-zinc-900/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Meta Graph API
            </span>
            {isInstagramLoading ? (
              <Badge variant="neutral" dot className="text-[10px] px-1.5 py-0">
                Checking...
              </Badge>
            ) : instagramStatus?.status === "connected" ? (
              <Badge variant="success" dot className="text-[10px] px-1.5 py-0">
                Connected
              </Badge>
            ) : instagramStatus?.status === "expired" ? (
              <Badge variant="warning" dot className="text-[10px] px-1.5 py-0">
                Expired
              </Badge>
            ) : (
              <Badge variant="warning" dot className="text-[10px] px-1.5 py-0">
                Not Connected
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed mb-3">
            {instagramStatus?.status === "connected"
              ? `Linked to @${instagramStatus.username || profile?.creator_handle || "creator"}. Live metrics and telemetry synchronization active.`
              : instagramStatus?.status === "expired"
              ? "Meta access token has expired. Re-authenticate to resume telemetry."
              : "Connect an Instagram Creator account to unlock real analytics and AI planning."}
          </p>
          <button
            type="button"
            onClick={onOpenConnectModal}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium py-1.5 transition-colors border border-zinc-200 dark:border-zinc-700/60 shadow-xs dark:shadow-none"
          >
            <span>
              {instagramStatus?.status === "connected"
                ? "Manage Connection"
                : instagramStatus?.status === "expired"
                ? "Reconnect Account"
                : "Connect Account"}
            </span>
            <ArrowUpRightIcon size={14} className="text-zinc-400" />
          </button>
        </div>

        {/* Creator Context Footer */}
        <div className="flex items-center justify-between gap-2 px-2 py-2 border-t border-zinc-200 dark:border-zinc-850 pt-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Avatar
              src={instagramStatus?.profile?.profile_picture_url || profile?.avatar_url}
              alt={instagramStatus?.username || profile?.creator_handle || "Creator Avatar"}
              initials={
                profile?.full_name
                  ? profile.full_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .substring(0, 2)
                      .toUpperCase()
                  : (instagramStatus?.username || profile?.creator_handle || "CR")
                      .substring(0, 2)
                      .toUpperCase()
              }
              size="md"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-200">
                {profile?.full_name || (instagramStatus?.username ? `@${instagramStatus.username}` : profile?.creator_handle ? `@${profile.creator_handle}` : "Creator Workspace")}
              </p>
              <p className="truncate text-[11px] text-zinc-500">
                {instagramStatus?.username || profile?.creator_handle
                  ? `@${instagramStatus?.username || profile?.creator_handle}`
                  : profile?.plan_tier
                  ? `${profile.plan_tier} plan`
                  : "Solo Creator Plan"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle size="sm" />
            {profile && (
              <form action={logoutAction}>
                <button
                  type="submit"
                  title="Sign out"
                  aria-label="Sign out"
                  className="p-1.5 text-zinc-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded-md transition-colors"
                >
                  <LogOutIcon size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
