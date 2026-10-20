"use client";

import React, { useState, useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { Profile } from "../../app/lib/definitions";
import type { InstagramStatusData } from "../../app/lib/instagram/use-instagram-status";

export interface DashboardShellProps {
  children: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onOpenConnectModal?: () => void;
  profile?: Profile | null;
  instagramStatus?: InstagramStatusData | null;
  isInstagramLoading?: boolean;
}

const TAB_TITLES: Record<string, string> = {
  overview: "Overview",
  analytics: "Analytics & Telemetry",
  "ai-studio": "AI Studio & Creative Assistant",
  planner: "Content Calendar & Planner",
  library: "Content Library & Assets",
  settings: "Settings & Meta Connections",
};

export function DashboardShell({
  children,
  activeTab = "overview",
  onTabChange,
  onOpenConnectModal,
  profile,
  instagramStatus,
  isInstagramLoading = false,
}: DashboardShellProps) {
  const [internalTab, setInternalTab] = useState(activeTab);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const currentTab = onTabChange ? activeTab : internalTab;

  // Close mobile navigation on ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileNavOpen) {
        setIsMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileNavOpen]);

  const handleSelectTab = (tab: string) => {
    setInternalTab(tab);
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 antialiased font-sans selection:bg-indigo-500/20 dark:selection:bg-indigo-500/30 selection:text-indigo-700 dark:selection:text-indigo-200">
      {/* Desktop Sidebar (Fixed sticky desktop navigation) */}
      <div className="hidden md:flex md:w-64 md:shrink-0 md:flex-col fixed inset-y-0 z-30">
        <Sidebar
          activeTab={currentTab}
          onSelectTab={handleSelectTab}
          onOpenConnectModal={onOpenConnectModal}
          profile={profile}
          instagramStatus={instagramStatus}
          isInstagramLoading={isInstagramLoading}
        />
      </div>

      {/* Mobile Navigation Drawer Overlay */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-xs transition-opacity animate-in fade-in"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Pane */}
          <div className="fixed inset-y-0 left-0 z-50 flex shadow-2xl animate-in slide-in-from-left duration-200">
            <Sidebar
              isMobile
              activeTab={currentTab}
              onSelectTab={handleSelectTab}
              onCloseMobile={() => setIsMobileNavOpen(false)}
              onOpenConnectModal={onOpenConnectModal}
              profile={profile}
              instagramStatus={instagramStatus}
              isInstagramLoading={isInstagramLoading}
            />
          </div>
        </div>
      )}

      {/* Main App Container */}
      <div className="flex flex-1 flex-col md:pl-64 min-w-0">
        <Topbar
          pageTitle={TAB_TITLES[currentTab] || "Overview"}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onOpenConnectModal={onOpenConnectModal}
          onNavigateTab={handleSelectTab}
          profile={profile}
          instagramStatus={instagramStatus}
          isInstagramLoading={isInstagramLoading}
        />

        {/* Page Content Viewport */}
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
