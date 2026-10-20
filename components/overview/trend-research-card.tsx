"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUpIcon,
  SparklesIcon,
  ArrowUpRightIcon,
  RefreshCwIcon,
  InfoIcon,
  InstagramIcon,
  SearchIcon,
} from "../ui/icons";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { TrendSourceItem, TrendResearchResult, TrendSourceType } from "../../app/lib/trends/types";
import { getNicheTrendsAction } from "../../app/actions/trends";

export interface TrendResearchCardProps {
  onNavigateTab?: (tab: string, context?: Record<string, unknown>) => void;
  onOpenDraftModal?: (draft: { title: string; content: string; format: string; topic?: string }) => void;
  creatorNiche?: string | null;
}

export function TrendResearchCard({
  onNavigateTab,
  onOpenDraftModal,
  creatorNiche,
}: TrendResearchCardProps) {
  const [data, setData] = useState<TrendResearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"all" | TrendSourceType>("all");

  const loadTrends = useCallback(async (refresh = false) => {
    setIsLoading(true);
    try {
      const res = await getNicheTrendsAction({ refresh });
      if (res.success && res.result) {
        setData(res.result);
      }
    } catch {
      // Graceful fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    getNicheTrendsAction({ refresh: false })
      .then((res) => {
        if (!ignore && res.success && res.result) {
          setData(res.result);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const items = data?.items || [];
  const filteredItems = activeFilter === "all"
    ? items
    : items.filter((it) => it.sourceType === activeFilter);

  const getSourceTypeBadge = (type: TrendSourceType) => {
    switch (type) {
      case "industry_news":
        return { label: "Industry News", variant: "purple" as const, color: "text-indigo-600 dark:text-indigo-400" };
      case "search_spike":
        return { label: "Search Surge", variant: "warning" as const, color: "text-amber-600 dark:text-amber-400" };
      case "platform_update":
        return { label: "Meta Platform Update", variant: "success" as const, color: "text-emerald-600 dark:text-emerald-400" };
    }
  };

  const handleSendToIdeaLab = (item: TrendSourceItem) => {
    if (onNavigateTab) {
      onNavigateTab("ai-studio", {
        studioTab: "ideas",
        initialTopic: `${item.title} (${item.publisher || item.sourceName})`,
      });
    }
  };

  const handleSendToCaptionStudio = (item: TrendSourceItem) => {
    if (onNavigateTab) {
      onNavigateTab("ai-studio", {
        studioTab: "caption",
        initialTopic: `Trend commentary: ${item.title}`,
      });
    }
  };

  const handleSaveToDrafts = (item: TrendSourceItem) => {
    if (onOpenDraftModal) {
      onOpenDraftModal({
        title: item.title,
        content: `${item.title}\n\nSource: ${item.publisher || item.sourceName} (${item.url})\nFreshness: ${item.freshnessLabel}\n\nKey Takeaway:\n${item.snippet || "Recent public trend verified for creator inspiration."}`,
        format: "post",
        topic: item.title,
      });
    } else if (onNavigateTab) {
      onNavigateTab("ai-studio", { studioTab: "drafts" });
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <SearchIcon size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Internet Trend Research
              </CardTitle>
              <Badge variant="success" className="text-[10px]">
                Live Web & News Feeds
              </Badge>
              {creatorNiche && (
                <Badge variant="neutral" className="text-[10px] hidden sm:inline-flex">
                  Niche: {creatorNiche}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Live trend radar aggregated from Google News, search volume spikes, and Meta announcements.
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTrends(true)}
            isLoading={isLoading}
            className="text-xs"
          >
            <RefreshCwIcon size={13} className={isLoading ? "animate-spin" : ""} />
            <span>Sync Live Trends</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-5">
        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeFilter === "all"
                ? "bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 shadow-2xs dark:shadow-none"
            }`}
          >
            All Signals ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("industry_news")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeFilter === "industry_news"
                ? "bg-indigo-600 text-white"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 shadow-2xs dark:shadow-none"
            }`}
          >
            Industry News
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("search_spike")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeFilter === "search_spike"
                ? "bg-amber-600 text-white"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 shadow-2xs dark:shadow-none"
            }`}
          >
            Search Surges
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("platform_update")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeFilter === "platform_update"
                ? "bg-emerald-600 text-white"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 shadow-2xs dark:shadow-none"
            }`}
          >
            Meta Updates
          </button>
        </div>

        {/* AI Synthesis Box if Available */}
        {data?.aiSummary && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/20 bg-indigo-50/70 dark:bg-indigo-950/20 p-4">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 text-xs font-semibold mb-1">
              <SparklesIcon size={14} />
              <span>AI Strategic Synthesis (Gemini 3.5 Flash Lite)</span>
            </div>
            <p className="text-xs text-zinc-800 dark:text-zinc-300 leading-relaxed">
              {data.aiSummary}
            </p>
          </div>
        )}

        {/* Items Grid */}
        {filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredItems.map((item) => {
              const typeBadge = getSourceTypeBadge(item.sourceType);

              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-4 hover:border-zinc-300 dark:hover:border-zinc-700/80 shadow-xs dark:shadow-none transition-all group"
                >
                  <div>
                    {/* Header Row: Category Badge + Freshness */}
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${typeBadge.color}`}>
                        {typeBadge.label}
                      </span>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                        {item.freshnessLabel}
                      </span>
                    </div>

                    {/* Source & Publisher */}
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">{item.publisher || item.sourceName}</span>
                      <span className="text-zinc-400 dark:text-zinc-600">•</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{item.domain}</span>
                    </div>

                    {/* Title with External Link */}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors inline-flex items-start gap-1 leading-snug"
                    >
                      <span>{item.title}</span>
                      <ArrowUpRightIcon size={13} className="shrink-0 text-zinc-400 dark:text-zinc-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 mt-0.5" />
                    </a>

                    {/* Snippet / Context */}
                    {item.snippet && (
                      <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-3">
                        {item.snippet}
                      </p>
                    )}

                    {/* Search Spike Specific Note */}
                    {item.sourceType === "search_spike" && (
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400/90 font-mono bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-900/40 w-fit">
                        <span>Search Volume: {item.trafficVolume || "Spike Signal"}</span>
                        <span className="text-zinc-500 dark:text-zinc-400">(Web Search Interest, not Instagram metric)</span>
                      </div>
                    )}
                  </div>

                  {/* 1-Click Action Buttons */}
                  <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-900/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSendToIdeaLab(item)}
                        className="rounded px-2 py-1 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                      >
                        Send to Idea Lab
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendToCaptionStudio(item)}
                        className="rounded px-2 py-1 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                      >
                        Draft Caption
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveToDrafts(item)}
                      className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                    >
                      Save Draft
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40">
            <InfoIcon size={20} className="text-zinc-400 dark:text-zinc-500 mb-2" />
            <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">
              No Trends Retrieved
            </h4>
            <p className="mt-1 max-w-sm text-[11px] text-zinc-600 dark:text-zinc-400">
              {data?.error || "No active articles found for your niche. Click Sync Live Trends to refresh public feeds."}
            </p>
          </div>
        )}

        {/* Source Authenticity Footnote */}
        <div className="flex items-center gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 p-2.5 text-[11px] text-zinc-600 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-800/60">
          <InfoIcon size={14} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
          <span>
            Feeds synchronized directly from verified public sources (Google News, Google Trends, Meta Newsroom). Zero fabricated trends or artificial popularity rankings.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
