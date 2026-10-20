"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  AiStudioIcon,
  SparklesIcon,
  ArrowUpRightIcon,
  ClockIcon,
  VideoIcon,
  LayersIcon,
  InfoIcon,
  TrendingUpIcon,
} from "../ui/icons";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { CreatorPreferences, CreativeIntelligenceItem } from "../../app/lib/definitions";
import { getCreativeIntelligenceAction } from "../../app/actions/creator-profile";

export interface AiRecommendationsCardProps {
  showSampleData?: boolean;
  onOpenConnectModal?: () => void;
  onNavigateTab?: (tab: string) => void;
  isConnected?: boolean;
  username?: string | null;
  preferences?: CreatorPreferences | null;
  onRefresh?: () => void;
}

const DEFAULT_RECOMMENDATIONS: CreativeIntelligenceItem[] = [
  {
    id: "rec-1",
    category: "Format Optimization",
    title: "Prioritize 18-24 Second Reels with Problem Hooks",
    summary:
      "Short-form video under 25 seconds with an upfront problem-statement hook in the first 2 seconds captures audience attention before viewers scroll.",
    impactScore: "High Impact",
    iconType: "video",
    suggestedAction: "Draft Script in AI Studio",
    targetTab: "ai-studio",
    factBadge: "Format Strategy",
    isAiHypothesis: true,
  },
  {
    id: "rec-2",
    category: "Publishing Window",
    title: "Shift Thursday Publishing to 6:45 PM – 7:30 PM",
    summary:
      "Audience engagement peaks during evening wind-down intervals. Moving releases closer to evening transit and leisure windows supports early viewer velocity.",
    impactScore: "Timing Signal",
    iconType: "clock",
    suggestedAction: "Schedule Slot in Planner",
    targetTab: "planner",
    factBadge: "Timing Strategy",
    isAiHypothesis: true,
  },
  {
    id: "rec-3",
    category: "Audience Retention",
    title: "Deploy 5-Slide Educational Carousels with Takeaway Cover",
    summary:
      "Carousels featuring concise step-by-step takeaways and clear value proposition covers encourage audience members to bookmark for future reference.",
    impactScore: "Save Potential",
    iconType: "layers",
    suggestedAction: "Generate Carousel Outline",
    targetTab: "ai-studio",
    factBadge: "Audience Retention",
    isAiHypothesis: true,
  },
];

function getRecommendationIcon(type?: string) {
  switch (type) {
    case "video":
      return VideoIcon;
    case "clock":
      return ClockIcon;
    case "layers":
      return LayersIcon;
    case "trending":
      return TrendingUpIcon;
    default:
      return SparklesIcon;
  }
}

export function AiRecommendationsCard({
  showSampleData = true,
  onOpenConnectModal,
  onNavigateTab,
  isConnected = false,
  username = null,
  preferences = null,
  onRefresh,
}: AiRecommendationsCardProps) {
  const [recommendations, setRecommendations] = useState<CreativeIntelligenceItem[]>(DEFAULT_RECOMMENDATIONS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchRecommendations = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await getCreativeIntelligenceAction(preferences || undefined);
      if (result.success && Array.isArray(result.recommendations) && result.recommendations.length > 0) {
        setRecommendations(result.recommendations);
      }
    } catch {
      // Graceful fallback to existing recommendations
    } finally {
      setIsRefreshing(false);
    }
  }, [preferences]);

  // Initial load and updates when creator preferences change
  useEffect(() => {
    let ignore = false;
    getCreativeIntelligenceAction(preferences || undefined)
      .then((res) => {
        if (!ignore && res.success && Array.isArray(res.recommendations) && res.recommendations.length > 0) {
          setRecommendations(res.recommendations);
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, [preferences]);

  const handleRefreshSignals = async () => {
    await fetchRecommendations();
    if (onRefresh) {
      onRefresh();
    }
  };

  const renderRecommendationCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {recommendations.map((rec) => {
        const Icon = getRecommendationIcon(rec.iconType);

        return (
          <div
            key={rec.id}
            className="flex flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-4 hover:border-zinc-300 dark:hover:border-zinc-700/80 shadow-xs dark:shadow-none transition-all group"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                  <SparklesIcon size={11} />
                  {rec.category}
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                  {rec.impactScore}
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 mt-0.5">
                  <Icon size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 group-hover:text-black dark:group-hover:text-white transition-colors leading-snug">
                    {rec.title}
                  </h4>
                  {/* Verified Fact vs AI Hypothesis Badging */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {rec.factBadge && (
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/60 px-1.5 py-0.5 text-[9px] font-medium text-zinc-700 dark:text-zinc-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                        {rec.factBadge}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                        rec.isAiHypothesis
                          ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300"
                          : "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          rec.isAiHypothesis ? "bg-amber-500 dark:bg-amber-400" : "bg-emerald-500 dark:bg-emerald-400"
                        }`}
                      />
                      {rec.isAiHypothesis ? "AI Strategic Hypothesis" : "Verified Account Fact"}
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-2.5 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {rec.summary}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-900/80">
              <button
                type="button"
                onClick={() => {
                  if (onNavigateTab) {
                    onNavigateTab(rec.targetTab || "ai-studio");
                  } else if (onOpenConnectModal) {
                    onOpenConnectModal();
                  }
                }}
                className="flex w-full items-center justify-between text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
              >
                <span>{rec.suggestedAction}</span>
                <ArrowUpRightIcon size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <AiStudioIcon size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                AI Studio Intelligence
              </CardTitle>
              <Badge variant={isConnected && !showSampleData ? "success" : "purple"} className="text-[10px]">
                {showSampleData ? "Preview Signals" : isConnected ? "AI Model Active" : "Awaiting Meta Link"}
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {isConnected
                ? `Data-informed creative recommendations tailored to @${username || "creator"}'s audience signals.`
                : "Data-informed creative recommendations tailored to your audience engagement signals."}
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
          <span>Model: Gemini 3.5 Flash Lite</span>
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {showSampleData ? (
          <div className="space-y-4">
            {renderRecommendationCards()}

            <div className="flex items-center gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 p-2.5 text-[11px] text-zinc-600 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-800/60">
              <InfoIcon size={14} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span>
                {isConnected
                  ? `Connected to @${username || "creator"}. AI recommendations informed by active Meta Graph telemetry and audience retention signals.`
                  : "Demonstration signals shown above. Once 14+ days of Meta Graph telemetry are synced, AI Studio generates recommendations based on your authentic audience retention curves."}
              </span>
            </div>
          </div>
        ) : isConnected ? (
          <div className="space-y-5">
            {/* Connected Header Box */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/40 p-4 gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs dark:shadow-none mt-0.5">
                  <SparklesIcon size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                    AI Creative Engine Active — @{username || "creator"}
                  </h4>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Account telemetry is actively streaming. AI Studio generates format recommendations, retention hooks, and optimal release windows from your audience signals.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleRefreshSignals} isLoading={isRefreshing}>
                  <span>Refresh Signals</span>
                </Button>
                <Button variant="outline" size="sm" onClick={onOpenConnectModal}>
                  <span>Manage Connection</span>
                </Button>
              </div>
            </div>

            {/* Active Recommendations Feed */}
            {renderRecommendationCards()}
          </div>
        ) : (
          /* Disconnected Empty State */
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 py-12 px-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs dark:shadow-none mb-3">
              <SparklesIcon size={20} />
            </div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
              AI Recommendations Inactive
            </h4>
            <p className="mt-1 max-w-sm text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Connect your Instagram account to provide the AI engine with historical impressions, retention rates, and top-performing formats.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenConnectModal}
              className="mt-4"
            >
              <span>Connect to Enable AI</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
