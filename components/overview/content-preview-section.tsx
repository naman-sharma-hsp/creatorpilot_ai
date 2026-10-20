"use client";

import React, { useState, useEffect } from "react";
import {
  VideoIcon,
  LayersIcon,
  ImageIcon,
  EyeIcon,
  HeartIcon,
  MessageCircleIcon,
  CalendarIcon,
  ClockIcon,
  ArrowUpRightIcon,
  PlusIcon,
  BookmarkIcon,
} from "../ui/icons";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { InstagramRecentMediaItem } from "../../app/lib/instagram/insights";
import type { ContentDraft } from "../../app/lib/definitions";
import { listDraftsAction } from "../../app/actions/drafts";

export interface ContentPreviewSectionProps {
  showSampleData?: boolean;
  onOpenConnectModal?: () => void;
  onNavigateTab?: (tab: string) => void;
  isConnected?: boolean;
  username?: string | null;
  recentMedia?: InstagramRecentMediaItem[];
  onRefresh?: () => void;
  initialDrafts?: ContentDraft[];
}

interface RecentPostItem {
  id: string;
  type: "Reel" | "Carousel" | "Photo";
  title: string;
  publishedDate: string;
  reach: string;
  likes: string;
  comments: string;
  engagement: string;
}

interface UpcomingScheduleItem {
  id: string;
  type: "Reel" | "Carousel" | "Story";
  title: string;
  scheduledTime: string;
  isOptimalTime: boolean;
  status: "Scheduled" | "Draft" | "Review";
}

const SAMPLE_RECENT_POSTS: RecentPostItem[] = [
  {
    id: "p1",
    type: "Reel",
    title: "5 Visual Design Rules Every Creator Needs in 2026",
    publishedDate: "2 days ago",
    reach: "44.2k",
    likes: "2,840",
    comments: "142",
    engagement: "6.8%",
  },
  {
    id: "p2",
    type: "Carousel",
    title: "Breakdown: How Typography Changes Audience Conversion",
    publishedDate: "5 days ago",
    reach: "29.8k",
    likes: "1,920",
    comments: "86",
    engagement: "5.4%",
  },
  {
    id: "p3",
    type: "Photo",
    title: "Workspace Aesthetic & Current Tech Stack Snapshot",
    publishedDate: "1 week ago",
    reach: "18.4k",
    likes: "1,150",
    comments: "39",
    engagement: "4.1%",
  },
];

const SAMPLE_UPCOMING_ITEMS: UpcomingScheduleItem[] = [
  {
    id: "s1",
    type: "Reel",
    title: "Why Most Creators Fail at Retention Curves",
    scheduledTime: "Tomorrow, 6:45 PM",
    isOptimalTime: true,
    status: "Scheduled",
  },
  {
    id: "s2",
    type: "Carousel",
    title: "Color Theory for Creator Brands: Step-by-Step Guide",
    scheduledTime: "Thursday, 7:15 PM",
    isOptimalTime: true,
    status: "Review",
  },
  {
    id: "s3",
    type: "Story",
    title: "Q&A Session: Workflow and Tooling Deep Dive",
    scheduledTime: "Friday, 1:00 PM",
    isOptimalTime: false,
    status: "Draft",
  },
];

export function ContentPreviewSection({
  showSampleData = true,
  onOpenConnectModal,
  onNavigateTab,
  isConnected = false,
  username = null,
  recentMedia = [],
  onRefresh,
  initialDrafts = [],
}: ContentPreviewSectionProps) {
  const [drafts, setDrafts] = useState<ContentDraft[]>(initialDrafts);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(!showSampleData && initialDrafts.length === 0);
  const [prevShowSampleData, setPrevShowSampleData] = useState(showSampleData);

  if (prevShowSampleData !== showSampleData) {
    setPrevShowSampleData(showSampleData);
    if (!showSampleData && drafts.length === 0) {
      setIsLoadingDrafts(true);
    }
  }

  useEffect(() => {
    let ignore = false;
    if (!showSampleData) {
      listDraftsAction({ limit: 5 })
        .then((res) => {
          if (!ignore && res.success && Array.isArray(res.drafts)) {
            setDrafts(res.drafts);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!ignore) setIsLoadingDrafts(false);
        });
    }
    return () => {
      ignore = true;
    };
  }, [showSampleData]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 1. Recent Content Performance */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Recent Content Performance
              </CardTitle>
              <Badge variant={isConnected && !showSampleData ? "success" : "purple"} className="text-[10px]">
                {showSampleData ? "Sample Media (Demo)" : isConnected ? "Live Media Sync" : "Awaiting Sync"}
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {showSampleData
                ? "Illustrative recent media with sample engagement metrics."
                : isConnected
                ? `Recent media published by @${username || "creator"} via Meta Graph API.`
                : "Engagement metrics on recently published posts and reels."}
            </CardDescription>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab && onNavigateTab("library")}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1"
          >
            <span>Library</span>
            <ArrowUpRightIcon size={13} />
          </button>
        </CardHeader>

        <CardContent className="pt-4">
          {showSampleData ? (
            <div className="space-y-3">
              {SAMPLE_RECENT_POSTS.map((post) => {
                const TypeIcon =
                  post.type === "Reel"
                    ? VideoIcon
                    : post.type === "Carousel"
                    ? LayersIcon
                    : ImageIcon;

                return (
                  <div
                    key={post.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-3.5 hover:border-zinc-300 dark:hover:border-zinc-700/80 shadow-2xs dark:shadow-none transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
                        <TypeIcon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                            {post.type}
                          </span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            • {post.publishedDate}
                          </span>
                        </div>
                        <h4 className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-200 mt-0.5">
                          {post.title}
                        </h4>
                      </div>
                    </div>

                    {/* Stats pills */}
                    <div className="flex items-center gap-3 shrink-0 text-xs font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/60 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800/60">
                      <div className="flex items-center gap-1">
                        <EyeIcon size={13} className="text-zinc-400 dark:text-zinc-500" />
                        <span>{post.reach}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HeartIcon size={13} className="text-zinc-400 dark:text-zinc-500" />
                        <span>{post.likes}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{post.engagement}</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 text-center pt-1">
                {isConnected
                  ? `Connected to @${username || "creator"}. Showing illustrative sample posts (switch to Live Account to inspect authentic posts).`
                  : "Illustrative posts preview for demonstration. Real media will populate upon Meta Graph OAuth."}
              </p>
            </div>
          ) : isConnected && recentMedia && recentMedia.length > 0 ? (
            <div className="space-y-3">
              {recentMedia.map((item) => {
                const isVideo = item.mediaType === "VIDEO";
                const isCarousel = item.mediaType === "CAROUSEL_ALBUM";
                const TypeIcon = isVideo ? VideoIcon : isCarousel ? LayersIcon : ImageIcon;
                const typeLabel = isVideo ? "Reel" : isCarousel ? "Carousel" : "Photo";
                const displayDate = item.timestamp
                  ? new Date(item.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : "Recent";
                const captionText = item.caption
                  ? item.caption.length > 70
                    ? item.caption.slice(0, 70) + "..."
                    : item.caption
                  : "Instagram Media";

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-3.5 hover:border-zinc-300 dark:hover:border-zinc-700/80 shadow-2xs dark:shadow-none transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400">
                        <TypeIcon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                            {typeLabel}
                          </span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            • {displayDate}
                          </span>
                        </div>
                        <h4 className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-200 mt-0.5">
                          {captionText}
                        </h4>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {typeof item.likeCount === "number" && (
                            <span className="flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                              <HeartIcon size={12} className="text-rose-500 dark:text-rose-400" />
                              {item.likeCount.toLocaleString()}
                            </span>
                          )}
                          {typeof item.commentsCount === "number" && (
                            <span className="flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                              <MessageCircleIcon size={12} className="text-indigo-600 dark:text-indigo-400" />
                              {item.commentsCount.toLocaleString()}
                            </span>
                          )}
                          {typeof item.likeCount !== "number" && typeof item.commentsCount !== "number" && (
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Live interactions compiling</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.permalink && (
                        <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                        >
                          <span>View on Instagram</span>
                          <ArrowUpRightIcon size={12} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {recentMedia.length} recent posts synced for @{username || "creator"}
                </span>
                {onRefresh && (
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                  >
                    Refresh Media
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 mb-2">
                <VideoIcon size={18} />
              </div>
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                {isConnected
                  ? `No Recent Media Synced for @${username || "creator"}`
                  : "No Published Media Synced"}
              </h4>
              <p className="mt-1 max-w-xs text-[11px] text-zinc-500 dark:text-zinc-400">
                {isConnected
                  ? "Your account is connected. No posts were published in the recent telemetry window, or feed is awaiting initial sync."
                  : "Connect your account to display and audit recent Instagram posts, reels, and carousel performance."}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {isConnected ? (
                  <>
                    {onRefresh && (
                      <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs">
                        <span>Refresh Media Feed</span>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={onOpenConnectModal} className="text-xs">
                      <span>Manage Connection</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenConnectModal}
                    className="mt-3 text-xs"
                  >
                    <span>Connect Account</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Upcoming Content / Planner Preview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Content Planner Queue
              </CardTitle>
              <Badge variant={!showSampleData && drafts.length > 0 ? "success" : "purple"} className="text-[10px]">
                {showSampleData ? "Sample Schedule (Demo)" : drafts.length > 0 ? "Drafts Vault Pipeline" : "Empty Queue"}
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {showSampleData
                ? "Illustrative production queue for layout demonstration."
                : "Active drafts and planned releases from your private Drafts Vault."}
            </CardDescription>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab && onNavigateTab("planner")}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1"
          >
            <span>Planner</span>
            <ArrowUpRightIcon size={13} />
          </button>
        </CardHeader>

        <CardContent className="pt-4">
          {showSampleData ? (
            <div className="space-y-3">
              {SAMPLE_UPCOMING_ITEMS.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-3.5 hover:border-zinc-300 dark:hover:border-zinc-700/80 shadow-2xs dark:shadow-none transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/40 text-indigo-600 dark:text-indigo-400">
                      <CalendarIcon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                          {item.type}
                        </span>
                        {item.isOptimalTime && (
                          <Badge variant="success" className="text-[9px] px-1.5 py-0">
                            Optimal Time
                          </Badge>
                        )}
                      </div>
                      <h4 className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-200 mt-0.5">
                        {item.title}
                      </h4>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center gap-1">
                        <ClockIcon size={11} />
                        <span>{item.scheduledTime}</span>
                      </p>
                    </div>
                  </div>

                  <Badge
                    variant={
                      item.status === "Scheduled"
                        ? "success"
                        : item.status === "Review"
                        ? "warning"
                        : "neutral"
                    }
                    className="shrink-0 text-[10px] self-start sm:self-center"
                  >
                    {item.status}
                  </Badge>
                </div>
              ))}

              <div className="pt-1 flex items-center justify-between">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Demonstration preview • 3 mock queue items
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (onNavigateTab) {
                      onNavigateTab("planner");
                    } else if (onOpenConnectModal) {
                      onOpenConnectModal();
                    }
                  }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 h-7 px-2"
                >
                  <PlusIcon size={13} />
                  <span>Draft Concept</span>
                </Button>
              </div>
            </div>
          ) : drafts.length > 0 ? (
            <div className="space-y-3">
              {drafts.map((draft) => {
                const isReel = draft.format === "reel";
                const isCarousel = draft.format === "carousel";
                const isStory = draft.format === "story";
                const TypeIcon = isReel ? VideoIcon : isCarousel ? LayersIcon : isStory ? ClockIcon : ImageIcon;
                const formatLabel = isReel ? "Reel" : isCarousel ? "Carousel" : isStory ? "Story" : "Post";

                const isScheduled = draft.status === "scheduled";
                const isReview = draft.status === "review";
                const isPublished = draft.status === "published";

                const statusLabel = isScheduled
                  ? "Planned Release"
                  : isReview
                  ? "Ready for Review"
                  : isPublished
                  ? "Published"
                  : "Draft Concept";

                const statusVariant = isScheduled
                  ? "warning"
                  : isReview
                  ? "purple"
                  : isPublished
                  ? "success"
                  : "neutral";

                const displayDate = draft.scheduled_for
                  ? `Planned: ${new Date(draft.scheduled_for).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : `Updated: ${new Date(draft.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

                return (
                  <div
                    key={draft.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-3.5 hover:border-zinc-300 dark:hover:border-zinc-700/80 shadow-2xs dark:shadow-none transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-zinc-900 border border-indigo-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400">
                        <TypeIcon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                            {formatLabel}
                          </span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            • {displayDate}
                          </span>
                        </div>
                        <h4 className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-200 mt-0.5">
                          {draft.title || "Untitled Draft"}
                        </h4>
                        {isScheduled ? (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400/90 mt-0.5">
                            Manual Reminder (Direct automated posting requires Meta App Review)
                          </p>
                        ) : draft.caption ? (
                          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {draft.caption.slice(0, 60)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                      <Badge variant={statusVariant} className="text-[10px]">
                        {statusLabel}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => onNavigateTab && onNavigateTab("library")}
                        className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 p-1"
                        title="View in Drafts Vault"
                      >
                        <ArrowUpRightIcon size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="pt-1 flex items-center justify-between">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {drafts.length} draft{drafts.length === 1 ? "" : "s"} in production pipeline
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigateTab && onNavigateTab("library")}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 h-7 px-2"
                >
                  <BookmarkIcon size={13} />
                  <span>Open Drafts Vault</span>
                </Button>
              </div>
            </div>
          ) : isLoadingDrafts ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-2">
              <div className="h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Loading pipeline drafts...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 mb-2">
                <BookmarkIcon size={18} />
              </div>
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-300">
                Pipeline is Empty
              </h4>
              <p className="mt-1 max-w-xs text-[11px] text-zinc-500 dark:text-zinc-400">
                Create hooks, scripts, or captions in AI Studio to organize your upcoming releases here.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (onNavigateTab) {
                    onNavigateTab("ai-studio");
                  }
                }}
                className="mt-3 text-xs"
              >
                <PlusIcon size={13} />
                <span>Create Draft in AI Studio</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
