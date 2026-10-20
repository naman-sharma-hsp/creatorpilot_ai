"use client";

import React from "react";
import {
  UsersIcon,
  EyeIcon,
  Share2Icon,
  InfoIcon,
  AlertCircleIcon,
  InstagramIcon,
} from "../ui/icons";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import type { InstagramAnalyticsData } from "../../app/lib/instagram/insights";

export interface AnalyticsSummaryProps {
  showSampleData?: boolean;
  onToggleSample?: () => void;
  analyticsData?: InstagramAnalyticsData | null;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onReconnect?: () => void;
}

interface MetricCardItem {
  id: string;
  label: string;
  sampleValue: string;
  sampleChange: string;
  sampleChangePositive: boolean;
  sampleSubtitle: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  description: string;
}

const SAMPLE_METRICS: MetricCardItem[] = [
  {
    id: "followers",
    label: "Total Audience",
    sampleValue: "48,250",
    sampleChange: "+4.2%",
    sampleChangePositive: true,
    sampleSubtitle: "+1,940 this month",
    icon: UsersIcon,
    description: "Net follower count on your connected Instagram Professional account.",
  },
  {
    id: "reach",
    label: "Accounts Reached",
    sampleValue: "182,400",
    sampleChange: "+12.8%",
    sampleChangePositive: true,
    sampleSubtitle: "78% non-followers",
    icon: EyeIcon,
    description: "Unique accounts that saw your posts, reels, or stories (past 28 days).",
  },
  {
    id: "views",
    label: "Content Views",
    sampleValue: "248,600",
    sampleChange: "+8.4%",
    sampleChangePositive: true,
    sampleSubtitle: "Reels & posts",
    icon: EyeIcon,
    description: "Total content views (Meta unified views metric replacing legacy impressions).",
  },
  {
    id: "interactions",
    label: "Content Interactions",
    sampleValue: "24.6k",
    sampleChange: "-1.4%",
    sampleChangePositive: false,
    sampleSubtitle: "Likes, comments & shares",
    icon: Share2Icon,
    description: "Direct audience engagements across published media.",
  },
];

export function AnalyticsSummary({
  showSampleData = true,
  onToggleSample,
  analyticsData,
  isLoading = false,
  error,
  onRefresh,
  onReconnect,
}: AnalyticsSummaryProps) {
  const isConnected = analyticsData?.connected === true && analyticsData?.status === "connected";
  const isInsufficientPermissions = analyticsData?.status === "insufficient_permissions";
  const isExpired = analyticsData?.status === "expired";
  const isDisconnected = analyticsData?.status === "disconnected";

  const getBadgeState = () => {
    if (showSampleData) {
      return { label: "Demonstration Preview (Sample Data)", variant: "purple" as const };
    }
    if (isLoading) {
      return { label: "Syncing Telemetry...", variant: "neutral" as const };
    }
    if (isConnected) {
      return { label: "Live Meta Graph Telemetry", variant: "success" as const };
    }
    if (isInsufficientPermissions) {
      return { label: "Insights Permission Required", variant: "warning" as const };
    }
    if (isExpired) {
      return { label: "Token Expired", variant: "warning" as const };
    }
    if (isDisconnected) {
      return { label: "Not Connected", variant: "neutral" as const };
    }
    return { label: "Awaiting API Data", variant: "neutral" as const };
  };

  const badgeState = getBadgeState();

  const getLiveMetricDisplay = (id: string) => {
    if (!analyticsData) {
      return {
        value: "—",
        subtitle: isDisconnected ? "Connect account to sync" : "Awaiting API Data",
      };
    }

    if (id === "followers") {
      const val = analyticsData.followersCount;
      return {
        value: val !== null && val !== undefined ? val.toLocaleString() : "—",
        subtitle:
          val !== null && val !== undefined
            ? analyticsData.mediaCount !== null && analyticsData.mediaCount !== undefined
              ? `${analyticsData.mediaCount.toLocaleString()} posts & reels`
              : "Live follower count"
            : "Awaiting follower telemetry",
      };
    }

    if (id === "reach") {
      const val = analyticsData.reach30d;
      return {
        value: val !== null && val !== undefined ? val.toLocaleString() : "—",
        subtitle:
          val !== null && val !== undefined
            ? val === 0
              ? "0 reach recorded in period"
              : "Past 28 days unique reach"
            : isInsufficientPermissions
              ? "Requires insights permission"
              : "No reach recorded in period",
      };
    }

    if (id === "views") {
      const val = analyticsData.views30d;
      return {
        value: val !== null && val !== undefined ? val.toLocaleString() : "—",
        subtitle:
          val !== null && val !== undefined
            ? val === 0
              ? "0 views recorded on Meta"
              : "Past 28 days total views"
            : isInsufficientPermissions
              ? "Requires insights permission"
              : "Metric compiling or unavailable from Meta",
      };
    }

    if (id === "interactions") {
      const val = analyticsData.totalInteractions;
      return {
        value: val !== null && val !== undefined ? val.toLocaleString() : "—",
        subtitle:
          val !== null && val !== undefined
            ? "Recent media likes & comments"
            : analyticsData.recentMedia && analyticsData.recentMedia.length === 0
              ? "No recent media"
              : "Awaiting media telemetry",
      };
    }

    return { value: "—", subtitle: "Syncs with Meta Graph" };
  };

  return (
    <div className="space-y-3.5">
      {/* Header with Transparency Disclaimer and Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Core Performance Indicators
          </h3>
          <Badge
            variant={badgeState.variant}
            className="text-[10px] uppercase tracking-wider"
          >
            {badgeState.label}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">View mode:</span>
          <button
            type="button"
            onClick={onToggleSample}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-white transition-colors shadow-xs dark:shadow-none"
          >
            <span>{showSampleData ? "Switch to Live Data" : "Preview with Sample Data"}</span>
          </button>
        </div>
      </div>

      {/* Insufficient Permissions Banner */}
      {!showSampleData && isInsufficientPermissions && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200 text-xs animate-in fade-in">
          <div className="flex items-start sm:items-center gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5 sm:mt-0" />
            <span>
              <strong>Insights Permission Required:</strong> Your Instagram account was authorized with basic permissions. Reconnect your account to grant <code>instagram_business_manage_insights</code> and activate Reach & Views metrics.
            </span>
          </div>
          {onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs transition-colors shadow-xs"
            >
              <InstagramIcon size={13} />
              <span>Reconnect Account</span>
            </button>
          )}
        </div>
      )}

      {/* Expired Token Banner */}
      {!showSampleData && isExpired && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/40 dark:bg-rose-950/20 dark:text-rose-200 text-xs animate-in fade-in">
          <div className="flex items-start sm:items-center gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5 sm:mt-0" />
            <span>
              <strong>Session Expired:</strong> Your Instagram authorization token has expired. Please reconnect to resume live analytics.
            </span>
          </div>
          {onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors shadow-xs"
            >
              <InstagramIcon size={13} />
              <span>Reconnect Account</span>
            </button>
          )}
        </div>
      )}

      {/* General Error Banner */}
      {!showSampleData && error && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircleIcon size={16} className="shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs text-rose-700 dark:text-rose-200 underline hover:text-rose-900 dark:hover:text-white transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {SAMPLE_METRICS.map((item) => {
          const Icon = item.icon;
          const liveDisplay = getLiveMetricDisplay(item.id);

          return (
            <Card key={item.id} className="relative overflow-hidden group">
              <CardHeader className="flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {item.label}
                </CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors">
                  <Icon size={16} />
                </div>
              </CardHeader>

              <CardContent className="pt-1">
                {showSampleData ? (
                  <div>
                    <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-mono">
                      {item.sampleValue}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                          item.sampleChangePositive
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {item.sampleChangePositive ? "+" : ""}
                        {item.sampleChange}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {item.sampleSubtitle}
                      </span>
                    </div>
                  </div>
                ) : isLoading ? (
                  <div className="py-2 animate-pulse space-y-2">
                    <div className="h-8 w-24 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                    <div className="h-3 w-32 bg-zinc-100 dark:bg-zinc-800/60 rounded"></div>
                  </div>
                ) : (
                  <div className="py-1">
                    <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-mono">
                      {liveDisplay.value}
                    </div>
                    <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {liveDisplay.subtitle}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Informational Footers */}
      {showSampleData ? (
        <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <InfoIcon size={13} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
          <span>
            Illustrative preview data — figures are mock demonstration values for layout visualization and do not reflect real account metrics.
          </span>
        </div>
      ) : isConnected && analyticsData ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-1.5">
            <InfoIcon size={12} className="shrink-0" />
            <span>
              Live Meta Graph telemetry (past 28 days) • Synced {new Date(analyticsData.lastSyncedAt).toLocaleTimeString()}
              {analyticsData.isCached ? " (cached)" : ""}
            </span>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors underline self-start sm:self-auto"
            >
              Refresh now
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
