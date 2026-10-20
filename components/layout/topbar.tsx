"use client";

import React, { useState } from "react";
import {
  MenuIcon,
  BellIcon,
  InstagramIcon,
  PlusIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Avatar } from "../ui/avatar";
import { ThemeToggle } from "../ui/theme-toggle";
import { CreatorPilotBrandMark } from "../ui/creatorpilot-logo";
import type { Profile } from "../../app/lib/definitions";
import type { InstagramStatusData } from "../../app/lib/instagram/use-instagram-status";

export interface TopbarProps {
  pageTitle?: string;
  onOpenMobileNav?: () => void;
  onOpenConnectModal?: () => void;
  onNavigateTab?: (tab: string) => void;
  profile?: Profile | null;
  instagramStatus?: InstagramStatusData | null;
  isInstagramLoading?: boolean;
}

export function Topbar({
  pageTitle = "Overview",
  onOpenMobileNav,
  onOpenConnectModal,
  onNavigateTab,
  profile,
  instagramStatus,
  isInstagramLoading = false,
}: TopbarProps) {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-950/80 px-4 sm:px-6 backdrop-blur-md">
      {/* Left: Mobile Toggle + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open mobile navigation"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white md:hidden"
        >
          <MenuIcon size={18} />
        </button>

        <div className="md:hidden flex items-center">
          <CreatorPilotBrandMark size={28} />
        </div>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400 dark:text-zinc-500 hidden sm:inline">Workspace</span>
          <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline">/</span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pageTitle}</span>
        </nav>
      </div>

      {/* Right: Status, Notification, Actions */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Instagram Link Status Pill */}
        <button
          type="button"
          onClick={onOpenConnectModal}
          aria-label={
            isInstagramLoading
              ? "Checking Instagram connection status"
              : instagramStatus?.status === "connected"
              ? `Connected to Instagram as @${instagramStatus.username || "creator"}`
              : instagramStatus?.status === "expired"
              ? "Instagram connection token expired"
              : "Instagram not connected"
          }
          className="hidden sm:flex items-center gap-2 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 transition-colors"
        >
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400">
            <InstagramIcon size={12} />
          </div>
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Meta Link:</span>
          {isInstagramLoading ? (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-pulse" />
              Checking...
            </span>
          ) : instagramStatus?.status === "connected" ? (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              {instagramStatus.username ? `@${instagramStatus.username}` : "Connected"}
            </span>
          ) : instagramStatus?.status === "expired" ? (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
              Expired
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
              Disconnected
            </span>
          )}
        </button>

        {/* Theme Mode Toggle Button */}
        <ThemeToggle />

        {/* Notifications Popover Toggle */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notifications"
            aria-expanded={showNotifications}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              showNotifications
                ? "border-indigo-500/50 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300"
                : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white"
            }`}
          >
            <BellIcon size={17} />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-zinc-950" />
          </button>

          {/* Notifications Dropdown Panel */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-xl z-50">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                  Notifications & Setup
                </span>
                <Badge variant={instagramStatus?.status === "connected" ? "success" : "purple"} className="text-[10px]">
                  {instagramStatus?.status === "connected" ? "Active" : "1 Pending"}
                </Badge>
              </div>

              <div className="mt-3 space-y-2.5">
                {instagramStatus?.status === "connected" ? (
                  <div className="flex items-start gap-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 p-2.5 border border-zinc-200 dark:border-zinc-800/80">
                    <CheckCircle2Icon size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                        Instagram API Connected
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                        Synced with @{instagramStatus.username || "creator"}. Real-time analytics and telemetry are active.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          if (onOpenConnectModal) onOpenConnectModal();
                        }}
                        className="mt-2 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline"
                      >
                        Manage Meta Connection →
                      </button>
                    </div>
                  </div>
                ) : instagramStatus?.status === "expired" ? (
                  <div className="flex items-start gap-2.5 rounded-lg bg-amber-50/50 dark:bg-zinc-950/60 p-2.5 border border-amber-300 dark:border-amber-800/80">
                    <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                        Instagram Token Expired
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                        The Meta access token for @{instagramStatus.username || "creator"} has expired. Please re-authenticate.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          if (onOpenConnectModal) onOpenConnectModal();
                        }}
                        className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline"
                      >
                        Reconnect Account →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 p-2.5 border border-zinc-200 dark:border-zinc-800/80">
                    <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                        Instagram API Not Connected
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                        Connect your Instagram Professional account to sync follower analytics and schedule posts.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          if (onOpenConnectModal) onOpenConnectModal();
                        }}
                        className="mt-2 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline"
                      >
                        Configure Meta Connection →
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 p-2.5 border border-zinc-200 dark:border-zinc-800/80">
                  <CheckCircle2Icon size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                      UI Foundation Milestone Ready
                    </p>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                      Production design tokens and component foundations are active.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Action: New Post Draft */}
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            if (onNavigateTab) {
              onNavigateTab("planner");
            } else if (onOpenConnectModal) {
              onOpenConnectModal();
            }
          }}
          className="hidden sm:inline-flex"
        >
          <PlusIcon size={14} />
          <span>New Content Draft</span>
        </Button>

        {/* Creator Identity / Sign-in */}
        {profile ? (
          <div className="hidden lg:flex items-center gap-2.5 pl-2 border-l border-zinc-200 dark:border-zinc-850">
            <Avatar
              src={instagramStatus?.profile?.profile_picture_url || profile.avatar_url}
              alt={instagramStatus?.username || profile.creator_handle || "Creator Avatar"}
              initials={
                (instagramStatus?.username || profile.creator_handle || profile.full_name || "CR")
                  .substring(0, 2)
                  .toUpperCase()
              }
              size="sm"
            />
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              @{instagramStatus?.username || profile.creator_handle || (profile.email ? profile.email.split("@")[0] : "creator")}
            </span>
          </div>
        ) : (
          <a
            href="/login"
            className="hidden sm:inline-flex items-center text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}
