"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { DashboardShell } from "../components/layout/dashboard-shell";
import { ConnectionBanner } from "../components/overview/connection-banner";
import { AnalyticsSummary } from "../components/overview/analytics-summary";
import { PerformanceChartCard } from "../components/overview/performance-chart-card";
import { AiRecommendationsCard } from "../components/overview/ai-recommendations-card";
import { ContentPreviewSection } from "../components/overview/content-preview-section";
import { TrendResearchCard } from "../components/overview/trend-research-card";
import { CreatorIdentityFlow } from "../components/ai-studio/creator-identity-flow";
import { CaptionGenerator } from "../components/ai-studio/caption-generator";
import { DraftsManager } from "../components/ai-studio/drafts-manager";
import { CreatorAiChat } from "../components/ai-studio/creator-ai-chat";
import { IdeaLab } from "../components/ai-studio/idea-lab";
import { CarouselGenerator } from "../components/ai-studio/carousel-generator";
import { RepurposingStudio } from "../components/ai-studio/repurposing-studio";
import {
  InstagramIcon,
  CalendarIcon,
  BarChart3Icon,
  LibraryIcon,
  ShieldCheckIcon,
  SparklesIcon,
  FileTextIcon,
  BookmarkIcon,
  MessageCircleIcon,
  LayersIcon,
  RefreshCwIcon,
} from "../components/ui/icons";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Avatar } from "../components/ui/avatar";
import { EmptyState } from "../components/ui/empty-state";
import { ThemeToggle } from "../components/ui/theme-toggle";
import { useInstagramStatus, type InstagramStatusData } from "./lib/instagram/use-instagram-status";
import { useInstagramAnalytics } from "./lib/instagram/use-instagram-analytics";
import type { Profile, CreatorPreferences } from "./lib/definitions";

type StudioSubTab = "chat" | "ideas" | "carousel" | "caption" | "repurpose" | "identity" | "drafts";
const VALID_STUDIO_TABS: readonly StudioSubTab[] = ["chat", "ideas", "carousel", "caption", "repurpose", "identity", "drafts"];

function isStudioSubTab(val: unknown): val is StudioSubTab {
  return typeof val === "string" && (VALID_STUDIO_TABS as readonly string[]).includes(val);
}

export interface DashboardViewProps {
  profile?: Profile | null;
  initialInstagramStatus?: InstagramStatusData | null;
  isSupabaseConfigured?: boolean;
  searchParams?: Record<string, string | string[] | undefined>;
}

export function DashboardView({
  profile = null,
  initialInstagramStatus = null,
  isSupabaseConfigured = false,
  searchParams,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [studioSubTab, setStudioSubTab] = useState<StudioSubTab>("chat");
  const [currentPreferences, setCurrentPreferences] = useState<CreatorPreferences | null>(
    profile?.preferences || null
  );
  const isInitiallyConnected = initialInstagramStatus?.status === "connected";
  const [showSampleData, setShowSampleData] = useState(!isInitiallyConnected);
  const hasUserManuallyToggledSample = useRef(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const instagram = useInstagramStatus({
    initialData: initialInstagramStatus,
  });
  const analytics = useInstagramAnalytics({
    enabled: instagram.data?.status === "connected",
  });
  const [isNotificationDismissed, setIsNotificationDismissed] = useState(false);

  // If connection was resolved client-side and user hasn't explicitly chosen sample mode, default to Live mode
  useEffect(() => {
    if (
      !hasUserManuallyToggledSample.current &&
      instagram.data?.status === "connected" &&
      !isInitiallyConnected
    ) {
      setShowSampleData(false);
    }
  }, [instagram.data?.status, isInitiallyConnected]);

  const displayUsername =
    instagram.data?.username ||
    profile?.creator_handle ||
    (profile?.email ? profile.email.split("@")[0] : null) ||
    "creator";

  const isConnected =
    instagram.data?.status === "connected" ||
    (instagram.isLoading && initialInstagramStatus?.status === "connected");

  const avatarUrl =
    instagram.data?.profile?.profile_picture_url ||
    profile?.avatar_url ||
    null;

  const navigateToInstagramAuth = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.assign(new URL("/api/auth/instagram", window.location.origin).href);
    }
  }, []);

  const handleNavigateWithContext = useCallback((tab: string, context?: Record<string, unknown>) => {
    setActiveTab(tab);
    if (tab === "ai-studio" && isStudioSubTab(context?.studioTab)) {
      setStudioSubTab(context.studioTab);
    }
  }, []);

  const notification = React.useMemo(() => {
    if (isNotificationDismissed) return null;
    const successParam = searchParams?.success;
    const errorParam = searchParams?.error;

    if (successParam === "instagram_connected") {
      return {
        type: "success" as const,
        message:
          "Instagram Professional account connected successfully! Your creator telemetry is now active.",
      };
    }
    if (typeof errorParam === "string") {
      const errorMessages: Record<string, string> = {
        instagram_cancelled:
          "Instagram connection was cancelled. No account changes were made.",
        instagram_account_conflict:
          "This Instagram account is already connected to another user. If you own this account, disconnect it from the other workspace first.",
        instagram_invalid_state:
          "The authorization session was invalid or expired. Please try connecting again.",
        instagram_state_expired:
          "The authorization request timed out. Please try connecting again.",
        instagram_config_error:
          "Instagram API server configuration is incomplete in .env.local.",
        instagram_database_error:
          "A database error occurred while verifying the connection request.",
        instagram_exchange_failed:
          "Failed to exchange authorization tokens with Meta. Please verify your Meta App credentials.",
        instagram_invalid_profile:
          "Unable to retrieve Instagram professional profile. Ensure your account is a Creator or Business account.",
        instagram_storage_error:
          "Failed to securely store credentials in the database.",
      };
      return {
        type: "error" as const,
        message:
          errorMessages[errorParam] ||
          "An error occurred while connecting your Instagram account.",
      };
    }
    return null;
  }, [searchParams, isNotificationDismissed]);

  const handleDismissNotification = useCallback(() => {
    setIsNotificationDismissed(true);
    if (typeof window !== "undefined" && window.location.search) {
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname);
    }
  }, []);

  const { fetchStatus } = instagram;
  const { fetchAnalytics } = analytics;

  useEffect(() => {
    if (searchParams?.success === "instagram_connected") {
      fetchStatus();
      fetchAnalytics({ forceRefresh: true });
    }
  }, [searchParams?.success, fetchStatus, fetchAnalytics]);

  return (
    <DashboardShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onOpenConnectModal={() => setIsConnectModalOpen(true)}
      profile={profile}
      instagramStatus={instagram.data}
      isInstagramLoading={instagram.isLoading}
    >
      {/* Dev Configuration Banner if Supabase is unconfigured */}
      {!isSupabaseConfigured && (
        <div className="mb-6 rounded-xl border border-violet-800/40 bg-violet-950/30 p-4 text-xs text-violet-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-900/60 text-violet-300 font-semibold text-[11px] mt-0.5">
              i
            </span>
            <div>
              <p className="font-semibold text-violet-200">
                Supabase Environment Setup Available
              </p>
              <p className="text-violet-300/80 text-[11px] mt-0.5">
                Authentication and database schema are implemented. Copy <code className="bg-violet-900/40 px-1 py-0.5 rounded text-violet-200">.env.example</code> to <code className="bg-violet-900/40 px-1 py-0.5 rounded text-violet-200">.env.local</code> and provide your Supabase project keys to enable live account sign-ins and RLS session persistence.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/login"
              className="px-2.5 py-1 text-[11px] font-medium bg-violet-900/60 hover:bg-violet-800 text-violet-100 rounded-md border border-violet-700/50 transition-colors"
            >
              Sign In Preview
            </Link>
            <Link
              href="/signup"
              className="px-2.5 py-1 text-[11px] font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors"
            >
              Sign Up Preview
            </Link>
          </div>
        </div>
      )}

      {activeTab === "overview" && (
        <div className="space-y-8 animate-in fade-in duration-150">
          {/* Welcome Header */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-900">
            <div className="flex items-start gap-4">
              {avatarUrl && (
                <div className="relative shrink-0 hidden sm:block">
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername || "Creator Avatar"}
                    initials={(displayUsername || profile?.full_name || "CR").substring(0, 2).toUpperCase()}
                    size="xl"
                    shape="rounded"
                    className="shadow-md shadow-indigo-950/40"
                  />
                  {isConnected && (
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 ring-2 ring-white dark:ring-zinc-950 text-[10px] text-white font-bold">
                      ✓
                    </span>
                  )}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Creator Intelligence
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-600">•</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Meta Graph v21.0</span>
                  {profile && (
                    <>
                      <span className="text-zinc-300 dark:text-zinc-600">•</span>
                      <Badge variant="purple" className="text-[10px]">
                        {profile.plan_tier} tier
                      </Badge>
                    </>
                  )}
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  {profile?.full_name ? `Welcome back, ${profile.full_name}` : "Creator Overview"}
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed">
                  Monitor cross-channel reach, evaluate audience retention patterns, and explore
                  AI-driven recommendations calibrated to your format strengths.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 rounded-lg bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 p-1 text-xs shadow-2xs dark:shadow-none">
                <button
                  type="button"
                  onClick={() => {
                    hasUserManuallyToggledSample.current = true;
                    setShowSampleData(true);
                  }}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    showSampleData
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  Sample Preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hasUserManuallyToggledSample.current = true;
                    setShowSampleData(false);
                  }}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    !showSampleData
                      ? isConnected
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  }`}
                >
                  {isConnected ? "Live Account" : "Live State"}
                </button>
              </div>
            </div>
          </div>

          {/* 1. Instagram Connection Status & CTA Banner */}
          <ConnectionBanner
            statusData={instagram.data}
            isLoading={instagram.isLoading}
            error={instagram.error}
            isDisconnecting={instagram.isDisconnecting}
            onRefresh={instagram.fetchStatus}
            onDisconnect={instagram.disconnect}
            onConnectClick={navigateToInstagramAuth}
            notification={notification}
            onDismissNotification={handleDismissNotification}
          />

          {/* 2. Analytics Summary Metrics */}
          <AnalyticsSummary
            showSampleData={showSampleData}
            onToggleSample={() => {
              hasUserManuallyToggledSample.current = true;
              setShowSampleData(!showSampleData);
            }}
            analyticsData={analytics.data}
            isLoading={analytics.isLoading}
            error={analytics.error}
            onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
            onReconnect={navigateToInstagramAuth}
          />

          {/* 3. Performance Over Time Graph */}
          <PerformanceChartCard
            showSampleData={showSampleData}
            onOpenConnectModal={() => setIsConnectModalOpen(true)}
            isConnected={isConnected}
            username={displayUsername}
            reach30d={analytics.data?.reach30d}
            views30d={analytics.data?.views30d}
            followersCount={analytics.data?.followersCount}
            mediaCount={analytics.data?.mediaCount}
            dailyMetrics={analytics.data?.dailyMetrics}
            followerHistory={analytics.data?.followerHistory}
            onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
          />

          {/* 4. AI Recommendation Preview */}
          <AiRecommendationsCard
            showSampleData={showSampleData}
            onOpenConnectModal={() => setIsConnectModalOpen(true)}
            onNavigateTab={setActiveTab}
            isConnected={isConnected}
            username={displayUsername}
            preferences={profile?.preferences}
            onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
          />

          {/* 5. Recent Content & Upcoming Planning Preview */}
          <ContentPreviewSection
            showSampleData={showSampleData}
            onOpenConnectModal={() => setIsConnectModalOpen(true)}
            onNavigateTab={setActiveTab}
            isConnected={isConnected}
            username={displayUsername}
            recentMedia={analytics.data?.recentMedia}
            onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
          />

          {/* 6. Live Internet Trend Research */}
          <TrendResearchCard
            onNavigateTab={handleNavigateWithContext}
            creatorNiche={profile?.preferences?.niche}
          />
        </div>
      )}

      {/* Analytics Dedicated Tab View */}
      {activeTab === "analytics" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
            <div>
              <div className="flex items-center gap-2.5">
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername}
                    initials={displayUsername.substring(0, 2).toUpperCase()}
                    size="md"
                    className="hidden sm:inline-flex"
                  />
                )}
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  Audience Analytics & Telemetry
                </h1>
                {instagram.isLoading && !instagram.data ? (
                  <Badge variant="neutral" dot className="text-xs">Checking...</Badge>
                ) : isConnected ? (
                  <Badge variant="success" dot className="text-xs">
                    @{displayUsername}
                  </Badge>
                ) : instagram.data?.status === "expired" ? (
                  <Badge variant="warning" dot className="text-xs">Token Expired</Badge>
                ) : (
                  <Badge variant="outline" dot className="text-xs">Not Connected</Badge>
                )}
              </div>
              <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
                In-depth cohort engagement, follower demographic distribution, and post velocity metrics.
              </p>
            </div>

            {isConnected && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => analytics.fetchAnalytics({ forceRefresh: true })}
                  isLoading={analytics.isLoading}
                >
                  <span>Refresh Telemetry</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsConnectModalOpen(true)}
                >
                  <span>Manage Connection</span>
                </Button>
              </div>
            )}
          </div>

          {isConnected ? (
            <div className="space-y-6">
              <AnalyticsSummary
                showSampleData={showSampleData}
                onToggleSample={() => {
                  hasUserManuallyToggledSample.current = true;
                  setShowSampleData(!showSampleData);
                }}
                analyticsData={analytics.data}
                isLoading={analytics.isLoading}
                error={analytics.error}
                onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
                onReconnect={navigateToInstagramAuth}
              />

              <PerformanceChartCard
                showSampleData={showSampleData}
                onOpenConnectModal={() => setIsConnectModalOpen(true)}
                isConnected={true}
                username={displayUsername}
                reach30d={analytics.data?.reach30d}
                views30d={analytics.data?.views30d}
                followersCount={analytics.data?.followersCount}
                mediaCount={analytics.data?.mediaCount}
                dailyMetrics={analytics.data?.dailyMetrics}
                followerHistory={analytics.data?.followerHistory}
                onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
              />

              <ContentPreviewSection
                showSampleData={showSampleData}
                onOpenConnectModal={() => setIsConnectModalOpen(true)}
                onNavigateTab={setActiveTab}
                isConnected={true}
                username={displayUsername}
                recentMedia={analytics.data?.recentMedia}
                onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
              />

              <TrendResearchCard
                onNavigateTab={handleNavigateWithContext}
                creatorNiche={profile?.preferences?.niche}
              />
            </div>
          ) : instagram.isLoading ? (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-12 flex flex-col items-center justify-center space-y-3 shadow-xs dark:shadow-none">
              <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading Instagram connection and telemetry...</p>
            </div>
          ) : (
            <EmptyState
              icon={<BarChart3Icon size={24} />}
              badge={instagram.data?.status === "expired" ? "Token Expired" : "Telemetry Pipeline"}
              title={
                instagram.data?.status === "expired"
                  ? "Instagram Connection Expired"
                  : "Awaiting Meta Insights Authorization"
              }
              description={
                instagram.data?.status === "expired"
                  ? "Your Meta access token has expired. Please re-authenticate your Instagram Professional account to resume live telemetry."
                  : "Detailed analytics will automatically aggregate once your Instagram Professional account is authenticated through the Meta Graph API."
              }
              action={
                <Button
                  variant="primary"
                  onClick={navigateToInstagramAuth}
                >
                  <InstagramIcon size={16} />
                  <span>
                    {instagram.data?.status === "expired"
                      ? "Reconnect Instagram Account"
                      : "Connect Instagram Account"}
                  </span>
                </Button>
              }
              secondaryAction={
                <Button variant="outline" onClick={() => setActiveTab("overview")}>
                  <span>Back to Overview</span>
                </Button>
              }
            />
          )}
        </div>
      )}

      {/* AI Studio Dedicated Tab View */}
      {activeTab === "ai-studio" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
            <div>
              <div className="flex items-center gap-2.5">
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername}
                    initials={displayUsername.substring(0, 2).toUpperCase()}
                    size="md"
                    className="hidden sm:inline-flex"
                  />
                )}
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  AI Creative Studio
                </h1>
                {isConnected ? (
                  <Badge variant="success" dot className="text-xs">
                    @{displayUsername}
                  </Badge>
                ) : (
                  <Badge variant="purple" className="text-xs">Creative Assistant</Badge>
                )}
              </div>
              <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
                Brainstorm hooks and scripts with Creator AI Chat, generate tailored captions, and manage your private draft vault.
              </p>
            </div>
          </div>

          {/* AI Studio Sub Navigation Pills */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg w-fit shadow-2xs dark:shadow-none">
            <button
              type="button"
              onClick={() => setStudioSubTab("chat")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "chat"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <MessageCircleIcon size={14} />
              <span>Creator AI Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioSubTab("ideas")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "ideas"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <SparklesIcon size={14} />
              <span>Idea & Hook Lab</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioSubTab("carousel")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "carousel"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <LayersIcon size={14} />
              <span>Carousel Studio</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioSubTab("caption")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "caption"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <FileTextIcon size={14} />
              <span>Caption Studio</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioSubTab("repurpose")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "repurpose"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <RefreshCwIcon size={14} />
              <span>Repurposing Studio</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioSubTab("identity")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "identity"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <ShieldCheckIcon size={14} />
              <span>Identity & Niche</span>
            </button>
            <button
              type="button"
              onClick={() => setStudioSubTab("drafts")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                studioSubTab === "drafts"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <BookmarkIcon size={14} />
              <span>Drafts Vault</span>
            </button>
          </div>

          {/* Sub Tab: Creator AI Chat */}
          {studioSubTab === "chat" && (
            <div className="space-y-6">
              <CreatorAiChat
                creatorPreferences={currentPreferences}
                isInstagramConnected={isConnected}
                username={displayUsername}
                avatarUrl={avatarUrl}
                onDraftSaved={() => {
                  // Draft saved successfully
                }}
                onNavigateToDrafts={() => setStudioSubTab("drafts")}
              />
            </div>
          )}

          {/* Sub Tab: Hook & Reel Idea Lab */}
          {studioSubTab === "ideas" && (
            <div className="space-y-6">
              <IdeaLab
                creatorPreferences={currentPreferences}
                onDraftSaved={() => {
                  // Draft saved successfully
                }}
                onNavigateToDrafts={() => setStudioSubTab("drafts")}
              />
            </div>
          )}

          {/* Sub Tab: Carousel Studio */}
          {studioSubTab === "carousel" && (
            <div className="space-y-6">
              <CarouselGenerator
                creatorPreferences={currentPreferences}
                onDraftSaved={() => {
                  // Draft saved successfully
                }}
                onNavigateToDrafts={() => setStudioSubTab("drafts")}
              />
            </div>
          )}

          {/* Sub Tab: Caption Studio */}
          {studioSubTab === "caption" && (
            <div className="space-y-6">
              <CaptionGenerator
                creatorPreferences={currentPreferences}
                isInstagramConnected={isConnected}
                username={displayUsername}
                onDraftSaved={() => {
                  // Draft saved successfully
                }}
              />
            </div>
          )}

          {/* Sub Tab: Repurposing Studio */}
          {studioSubTab === "repurpose" && (
            <div className="space-y-6">
              <RepurposingStudio
                creatorPreferences={currentPreferences}
                onDraftSaved={() => {
                  // Draft saved successfully
                }}
                onNavigateToDrafts={() => setStudioSubTab("drafts")}
              />
            </div>
          )}

          {/* Sub Tab: Identity & Niche */}
          {studioSubTab === "identity" && (
            <div className="space-y-6">
              <CreatorIdentityFlow
                initialPreferences={currentPreferences}
                isInstagramConnected={isConnected}
                username={displayUsername}
                avatarUrl={avatarUrl}
                onPreferencesSaved={(prefs) => setCurrentPreferences(prefs)}
              />
            </div>
          )}

          {/* Sub Tab: Drafts Vault */}
          {studioSubTab === "drafts" && (
            <div className="space-y-6">
              <DraftsManager />
            </div>
          )}

          {/* Supplemental Analytics Recommendations if Instagram is connected */}
          {isConnected && (
            <div className="space-y-6 pt-4 border-t border-zinc-800/80">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Live Telemetry Recommendations
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Calculated from your recent 28-day reach ({analytics.data?.reach30d !== null && analytics.data?.reach30d !== undefined ? analytics.data.reach30d.toLocaleString() : "active"}) and follower engagement signals.
                  </p>
                </div>
              </div>

              <AiRecommendationsCard
                showSampleData={showSampleData}
                onOpenConnectModal={() => setIsConnectModalOpen(true)}
                onNavigateTab={setActiveTab}
                isConnected={true}
                username={displayUsername}
                onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
              />
            </div>
          )}
        </div>
      )}

      {/* Content Planner Dedicated Tab View */}
      {activeTab === "planner" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
            <div>
              <div className="flex items-center gap-2.5">
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername}
                    initials={displayUsername.substring(0, 2).toUpperCase()}
                    size="md"
                    className="hidden sm:inline-flex"
                  />
                )}
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  Content Calendar & Planner
                </h1>
                {isConnected ? (
                  <Badge variant="success" dot className="text-xs">
                    @{displayUsername}
                  </Badge>
                ) : (
                  <Badge variant="purple" className="text-xs">Editorial Pipeline</Badge>
                )}
              </div>
              <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
                Visual editorial calendar with automated posting windows and multi-format scheduling.
              </p>
            </div>
          </div>

          {isConnected ? (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-4 shadow-xs dark:shadow-none">
                <div className="flex items-center gap-2.5">
                  <CalendarIcon size={18} className="text-indigo-600 dark:text-indigo-400" />
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Editorial Scheduling Pipeline
                  </h3>
                  <Badge variant="outline" className="text-[10px]">
                    Publishing Scope Required
                  </Badge>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed">
                  Your Instagram Professional account (@{displayUsername}) is actively connected for analytics and insights. Direct automated posting to your feed requires Meta App Review approval for the <code className="text-indigo-700 dark:text-indigo-300 font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-transparent">instagram_content_publish</code> permission (Milestone 5). You can draft, organize, and plan scheduled release windows below.
                </p>
              </div>

              <ContentPreviewSection
                showSampleData={showSampleData}
                onOpenConnectModal={() => setIsConnectModalOpen(true)}
                onNavigateTab={setActiveTab}
                isConnected={true}
                username={displayUsername}
                recentMedia={analytics.data?.recentMedia}
                onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
              />
            </div>
          ) : instagram.isLoading ? (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-12 flex flex-col items-center justify-center space-y-3 shadow-xs dark:shadow-none">
              <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading publishing pipeline...</p>
            </div>
          ) : (
            <EmptyState
              icon={<CalendarIcon size={24} />}
              badge="Editorial Pipeline"
              title="Content Planner Ready for Publishing Scope"
              description="Direct Instagram scheduling requires an authorized Instagram Creator or Business account. Connect your account to manage scheduled releases directly from the calendar."
              action={
                <Button
                  variant="primary"
                  onClick={navigateToInstagramAuth}
                >
                  <InstagramIcon size={16} />
                  <span>Connect Instagram Account</span>
                </Button>
              }
              secondaryAction={
                <Button variant="outline" onClick={() => setActiveTab("overview")}>
                  <span>Back to Overview</span>
                </Button>
              }
            />
          )}
        </div>
      )}

      {/* Content Library Dedicated Tab View */}
      {activeTab === "library" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
            <div>
              <div className="flex items-center gap-2.5">
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername}
                    initials={displayUsername.substring(0, 2).toUpperCase()}
                    size="md"
                    className="hidden sm:inline-flex"
                  />
                )}
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  Content Asset Library
                </h1>
                {isConnected ? (
                  <Badge variant="success" dot className="text-xs">
                    @{displayUsername}
                  </Badge>
                ) : (
                  <Badge variant="purple" className="text-xs">Asset Vault</Badge>
                )}
              </div>
              <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
                Centralized repository of media assets, caption drafts, hashtag templates, and creative snippets.
              </p>
            </div>
          </div>

          {/* User's Drafts are ALWAYS accessible whether Instagram is connected or not */}
          <div className="space-y-6">
            <DraftsManager />
          </div>

          {isConnected ? (
            <div className="space-y-6 pt-6 border-t border-zinc-200 dark:border-zinc-800/80">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                    Published Instagram Media Feed
                  </h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Live media sync from your connected Instagram Professional account.
                  </p>
                </div>
              </div>
              <ContentPreviewSection
                showSampleData={showSampleData}
                onOpenConnectModal={() => setIsConnectModalOpen(true)}
                onNavigateTab={setActiveTab}
                isConnected={true}
                username={displayUsername}
                recentMedia={analytics.data?.recentMedia}
                onRefresh={() => analytics.fetchAnalytics({ forceRefresh: true })}
              />
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                  Connect Instagram to Sync Published Media
                </h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Link your Instagram Creator or Business account to view real-time feed analytics and published post metrics alongside your drafts.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={navigateToInstagramAuth}
                className="shrink-0"
              >
                <InstagramIcon size={14} />
                <span>Connect Account</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Settings & Connections Dedicated Tab View */}
      {activeTab === "settings" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Settings & Platform Connections
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
              Manage Meta API credentials, Webhooks, appearance preferences, and workspace configuration.
            </p>
          </div>

          {/* Appearance & Theme Section */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-4 shadow-xs dark:shadow-none">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Appearance & Theme
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">
                  Customize the interface theme for day or night workflow. Select Dark Mode, Light Mode, or automatically synchronize with your operating system preference.
                </p>
              </div>
              <div className="shrink-0">
                <ThemeToggle variant="segmented" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-6 shadow-xs dark:shadow-none">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between pb-5 border-b border-zinc-200 dark:border-zinc-800 gap-4">
              <div className="flex items-start gap-3.5">
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername}
                    initials={displayUsername.substring(0, 2).toUpperCase()}
                    size="lg"
                    shape="rounded"
                    className="shrink-0 mt-0.5"
                  />
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Meta Graph API Connection
                    </h3>
                    {instagram.isLoading && !instagram.data ? (
                      <Badge variant="neutral" dot>Checking...</Badge>
                    ) : isConnected ? (
                      <Badge variant="success" dot>Connected</Badge>
                    ) : instagram.data?.status === "expired" ? (
                      <Badge variant="warning" dot>Token Expired</Badge>
                    ) : (
                      <Badge variant="outline" dot>Not Linked</Badge>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
                    {isConnected
                      ? `Connected as @${displayUsername}. Authenticated via official Meta Instagram API.`
                      : instagram.data?.status === "expired"
                        ? `Access token expired for @${displayUsername}. Please re-authenticate with Meta.`
                        : "Connect your Instagram Professional (Creator or Business) Account via Meta's official API."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isConnected ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    isLoading={instagram.isDisconnecting}
                    onClick={async () => {
                      await instagram.disconnect();
                    }}
                    className="border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:border-rose-800/60 dark:text-rose-200"
                  >
                    <span>Disconnect</span>
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={navigateToInstagramAuth}
                  >
                    <InstagramIcon size={14} />
                    <span>{instagram.data?.status === "expired" ? "Reconnect Account" : "Connect Account"}</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Architectural Roadmap
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80">
                  <p className="font-medium text-zinc-900 dark:text-zinc-200">Milestone 1 (Completed)</p>
                  <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Production UI Foundation, design system, responsive shell, and overview telemetry layout.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80">
                  <p className="font-medium text-zinc-900 dark:text-zinc-200">Milestone 2 (Completed)</p>
                  <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Supabase Auth, PostgreSQL schema, RLS, profile provisioning, and session handling.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80 sm:col-span-2">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">Milestone 3 (Completed & Verified)</p>
                  <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Official Meta OAuth handshake, AES-256-GCM token encryption, connection status, and disconnect endpoints.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Meta API Integration Overview Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-roadmap-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl text-zinc-900 dark:text-zinc-100"
          >
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400">
                  <ShieldCheckIcon size={18} />
                </div>
                <div>
                  <h3 id="modal-roadmap-title" className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Meta Graph API Connection
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {instagram.data?.status === "connected"
                      ? "Manage Instagram Connection"
                      : "Instagram Login Integration"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsConnectModalOpen(false)}
                aria-label="Close dialog"
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/70 p-3.5 border border-zinc-200 dark:border-zinc-800/80 flex items-start gap-3">
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={displayUsername}
                    initials={displayUsername.substring(0, 2).toUpperCase()}
                    size="md"
                    shape="rounded"
                    className="shrink-0 mt-0.5"
                  />
                )}
                <div>
                  <div className="flex items-center gap-2 font-medium text-indigo-700 dark:text-indigo-300 mb-1">
                    <InstagramIcon size={15} />
                    <span>
                      {isConnected
                        ? `Connected: @${displayUsername}`
                        : "Connect Instagram Professional Account"}
                    </span>
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {isConnected
                      ? "Your professional Instagram account is actively synced. Encrypted access tokens are securely managed on the server."
                      : "Authenticate securely using Meta's official Instagram API. Tokens are encrypted server-side with AES-256-GCM and never exposed to the client."}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                  Permissions configured:
                </h4>
                <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-indigo-700 dark:text-indigo-400 flex flex-wrap gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-300">instagram_business_basic</span>
                  <span className="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-300">instagram_business_manage_insights</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsConnectModalOpen(false)}
              >
                Close
              </Button>
              {isConnected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    isLoading={instagram.isDisconnecting}
                    onClick={async () => {
                      await instagram.disconnect();
                      setIsConnectModalOpen(false);
                    }}
                    className="border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:border-rose-900/60 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    <span>Disconnect</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setIsConnectModalOpen(false);
                      navigateToInstagramAuth();
                    }}
                  >
                    <InstagramIcon size={16} />
                    <span>Reconnect via Meta</span>
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setIsConnectModalOpen(false);
                    navigateToInstagramAuth();
                  }}
                >
                  <InstagramIcon size={16} />
                  <span>Connect via Meta</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
