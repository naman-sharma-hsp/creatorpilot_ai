"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  TrendingUpIcon,
  TrendingDownIcon,
  CalendarIcon,
  InstagramIcon,
  InfoIcon,
} from "../ui/icons";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  InstagramDailyMetricPoint,
  AnalyticsSnapshotItem,
} from "../../app/lib/instagram/insights";

export interface PerformanceChartCardProps {
  showSampleData?: boolean;
  onOpenConnectModal?: () => void;
  isConnected?: boolean;
  username?: string | null;
  reach30d?: number | null;
  views30d?: number | null;
  followersCount?: number | null;
  mediaCount?: number | null;
  dailyMetrics?: InstagramDailyMetricPoint[];
  followerHistory?: AnalyticsSnapshotItem[];
  onRefresh?: () => void;
}

type MetricType = "reach" | "impressions" | "followers" | "engagement";
type TimeframeType = "7D" | "14D" | "30D";

interface ChartDataPoint {
  date: string;
  fullDate: string;
  reach: number | null;
  impressions: number | null;
  followers: number | null;
  engagement: number | null;
}

// Asymmetric organic 30-day reach distribution weights (representing 4 publishing events, natural decays, and irregular baselines)
const DAILY_REACH_WEIGHTS_30D = [
  0.72, 0.65, 1.68, 1.35, 0.98, 0.81, 1.15, 1.28, 0.74, 0.88,
  1.82, 1.42, 1.05, 0.78, 0.92, 1.20, 1.10, 0.68, 2.15, 1.88,
  1.45, 1.12, 0.85, 0.95, 1.38, 1.22, 0.90, 0.82, 1.08, 1.15,
];

// Content view-to-reach multipliers (Reels get 1.9x-2.2x view loops; carousels get 1.5x-1.6x; quiet days 1.35x)
const DAILY_VIEW_MULTIPLIERS_30D = [
  1.42, 1.38, 1.95, 2.10, 1.65, 1.45, 1.55, 1.60, 1.40, 1.48,
  1.62, 1.58, 1.50, 1.38, 1.42, 1.52, 1.50, 1.35, 2.25, 2.18,
  1.85, 1.60, 1.45, 1.50, 1.88, 1.75, 1.52, 1.42, 1.55, 1.60,
];

// Engagement rates fluctuating naturally per day (4.2% - 6.4%, peaking on high-save educational content)
const DAILY_ENGAGEMENT_RATES_30D = [
  5.2, 5.4, 4.6, 4.8, 5.1, 5.6, 5.9, 5.7, 5.3, 5.5,
  6.4, 6.2, 5.8, 5.2, 5.4, 5.7, 5.6, 5.1, 4.3, 4.5,
  4.9, 5.2, 5.5, 5.4, 6.1, 5.8, 5.4, 5.3, 5.5, 5.7,
];

/**
 * Deterministically generates realistic, organic, and asymmetric daily trajectory data points
 * anchored directly to the user's authentic metrics (reach30d, views30d, followersCount).
 */
function generateTrajectoryData(
  timeframe: TimeframeType,
  reach30d: number | null | undefined,
  views30d: number | null | undefined,
  followersCount: number | null | undefined,
  showSampleData: boolean
): ChartDataPoint[] {
  const daysCount = timeframe === "7D" ? 7 : timeframe === "14D" ? 14 : 30;

  // Anchor numbers: use real telemetry if available, or realistic sample defaults
  const effectiveReach28d =
    typeof reach30d === "number" && reach30d > 0
      ? reach30d
      : showSampleData
      ? 84200
      : 0;

  const effectiveViews28d =
    typeof views30d === "number" && views30d > 0
      ? views30d
      : effectiveReach28d > 0
      ? Math.round(effectiveReach28d * 1.72)
      : showSampleData
      ? 145000
      : 0;

  const effectiveFollowers =
    typeof followersCount === "number" && followersCount > 0
      ? followersCount
      : showSampleData
      ? 84767
      : 0;

  // Scale target total according to timeframe
  // Meta reach is for 28 days; scale proportionally for 7D, 14D, 30D
  const targetReach =
    effectiveReach28d > 0
      ? Math.round(effectiveReach28d * (daysCount / 28))
      : daysCount * 2800;

  const targetViews =
    effectiveViews28d > 0
      ? Math.round(effectiveViews28d * (daysCount / 28))
      : daysCount * 4800;

  // Slice the last `daysCount` weights ending today
  const reachSlice = DAILY_REACH_WEIGHTS_30D.slice(-daysCount);
  const viewMultSlice = DAILY_VIEW_MULTIPLIERS_30D.slice(-daysCount);
  const engSlice = DAILY_ENGAGEMENT_RATES_30D.slice(-daysCount);

  const sumWeights = reachSlice.reduce((a, b) => a + b, 0);

  // Distribute reach accurately to match targetReach
  const reachValues = reachSlice.map((w) =>
    Math.round(targetReach * (w / Math.max(0.001, sumWeights)))
  );
  const reachSum = reachValues.reduce((a, b) => a + b, 0);
  if (reachValues.length > 0) {
    reachValues[reachValues.length - 1] += targetReach - reachSum;
  }

  // Distribute views using organic multipliers, accurately matching targetViews
  const rawViews = reachValues.map((r, i) => r * viewMultSlice[i]);
  const sumRawViews = rawViews.reduce((a, b) => a + b, 0);
  const viewValues = rawViews.map((v) =>
    Math.round(targetViews * (v / Math.max(1, sumRawViews)))
  );
  const viewsSum = viewValues.reduce((a, b) => a + b, 0);
  if (viewValues.length > 0) {
    viewValues[viewValues.length - 1] += targetViews - viewsSum;
  }

  // Follower gains: proportional to daily reach with natural conversion variation
  const dailyFollowerGains = reachValues.map((r, i) =>
    Math.round(r * 0.0175 * (0.85 + (i % 7) * 0.05))
  );
  const followersValues: number[] = new Array(daysCount);
  let currentFollower = effectiveFollowers;
  for (let i = daysCount - 1; i >= 0; i--) {
    followersValues[i] = currentFollower;
    currentFollower -= dailyFollowerGains[i];
  }

  const now = new Date();
  const points: ChartDataPoint[] = [];

  for (let i = 0; i < daysCount; i++) {
    const daysAgo = daysCount - 1 - i;
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);

    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    const fullDateStr = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    points.push({
      date: dateStr,
      fullDate: fullDateStr,
      reach: reachValues[i],
      impressions: viewValues[i],
      followers: followersValues[i],
      engagement: engSlice[i],
    });
  }

  return points;
}

export function PerformanceChartCard({
  showSampleData = true,
  onOpenConnectModal,
  isConnected = false,
  username = null,
  reach30d = null,
  views30d = null,
  followersCount = null,
  dailyMetrics = [],
  followerHistory = [],
  onRefresh,
}: PerformanceChartCardProps) {
  const [activeMetric, setActiveMetric] = useState<MetricType>("reach");
  const [activeTimeframe, setActiveTimeframe] = useState<TimeframeType>("30D");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [prevShowSampleData, setPrevShowSampleData] = useState(showSampleData);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Reset metric to reach if switching to live mode where engagement is not a supported daily stream
  if (prevShowSampleData !== showSampleData) {
    setPrevShowSampleData(showSampleData);
    if (!showSampleData && activeMetric === "engagement") {
      setActiveMetric("reach");
    }
  }

  // Generate dynamic data points: use sample data if showSampleData, or map real daily insights/snapshots
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (showSampleData) {
      return generateTrajectoryData(activeTimeframe, reach30d, views30d, followersCount, true);
    }

    if (activeMetric === "followers") {
      if (!followerHistory || followerHistory.length === 0) {
        return [];
      }
      const daysCount = activeTimeframe === "7D" ? 7 : activeTimeframe === "14D" ? 14 : 30;
      const slice = followerHistory.slice(-daysCount);
      return slice.map((s) => {
        const d = new Date(s.timestamp);
        const dateStr = !isNaN(d.getTime())
          ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
          : "";
        const fullDateStr = !isNaN(d.getTime())
          ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
          : "";

        return {
          date: dateStr,
          fullDate: fullDateStr,
          reach: s.reach30d,
          impressions: s.views30d,
          followers: typeof s.followersCount === "number" ? s.followersCount : null,
          engagement: null,
        };
      });
    }

    if (!dailyMetrics || dailyMetrics.length === 0) {
      return [];
    }
    const daysCount = activeTimeframe === "7D" ? 7 : activeTimeframe === "14D" ? 14 : 30;
    const slice = dailyMetrics.slice(-daysCount);
    return slice.map((pt) => ({
      date: pt.date ? pt.date.slice(5) : "",
      fullDate: pt.fullDate || pt.date || "",
      reach: typeof pt.reach === "number" ? pt.reach : null,
      impressions: typeof pt.views === "number" ? pt.views : null,
      followers: null,
      engagement: null,
    }));
  }, [activeTimeframe, reach30d, views30d, followersCount, showSampleData, dailyMetrics, followerHistory, activeMetric]);

  // Metric calculation & trends: distinguish real numeric values from null/unavailable
  const metricValues = useMemo(() => chartData.map((d) => d[activeMetric]), [chartData, activeMetric]);
  const numericValues = useMemo(
    () => metricValues.filter((v): v is number => typeof v === "number"),
    [metricValues]
  );
  const hasNumericData = numericValues.length > 0;

  const { periodTotalFormatted, trendDelta, isPositiveTrend, periodAverageFormatted } = useMemo(() => {
    if (chartData.length === 0 || !hasNumericData) {
      return {
        periodTotalFormatted: "—",
        trendDelta: "Unavailable",
        isPositiveTrend: true,
        periodAverageFormatted: "—",
      };
    }

    if (activeMetric === "followers") {
      const validPoints = chartData.filter((d) => typeof d.followers === "number");
      if (validPoints.length === 0) {
        const fallbackCount = typeof followersCount === "number" ? followersCount : null;
        return {
          periodTotalFormatted: fallbackCount !== null ? fallbackCount.toLocaleString() : "—",
          trendDelta: "Compiling",
          isPositiveTrend: true,
          periodAverageFormatted: fallbackCount !== null ? fallbackCount.toLocaleString() : "—",
        };
      }
      if (validPoints.length === 1) {
        const current = validPoints[0].followers as number;
        return {
          periodTotalFormatted: current.toLocaleString(),
          trendDelta: "1 snapshot recorded",
          isPositiveTrend: true,
          periodAverageFormatted: current.toLocaleString(),
        };
      }
      const current = validPoints[validPoints.length - 1].followers as number;
      const start = validPoints[0].followers as number;
      const gain = current - start;
      const deltaPercent = start > 0 ? ((gain / start) * 100).toFixed(1) : "0.0";
      return {
        periodTotalFormatted: current.toLocaleString(),
        trendDelta: `${gain >= 0 ? "+" : ""}${gain.toLocaleString()} (${gain >= 0 ? "+" : ""}${deltaPercent}%)`,
        isPositiveTrend: gain >= 0,
        periodAverageFormatted: Math.round(current).toLocaleString(),
      };
    }

    if (activeMetric === "engagement") {
      const avg = numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length;
      const mid = Math.floor(numericValues.length / 2);
      const firstHalf = numericValues.slice(0, mid);
      const secondHalf = numericValues.slice(mid);
      const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : avg;
      const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : avg;
      const delta = secondAvg - firstAvg;
      return {
        periodTotalFormatted: `${avg.toFixed(2)}%`,
        trendDelta: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`,
        isPositiveTrend: delta >= 0,
        periodAverageFormatted: `${avg.toFixed(2)}%`,
      };
    }

    // Reach or Impressions: calculate total and comparative velocity across verified numbers
    const total = numericValues.reduce((sum, v) => sum + v, 0);
    const avg = total / numericValues.length;
    const mid = Math.floor(numericValues.length / 2);
    const firstHalf = numericValues.slice(0, mid);
    const secondHalf = numericValues.slice(mid);
    const firstTotal = firstHalf.reduce((s, v) => s + v, 0);
    const secondTotal = secondHalf.reduce((s, v) => s + v, 0);
    const growth = firstTotal > 0 ? ((secondTotal - firstTotal) / firstTotal) * 100 : 0;

    return {
      periodTotalFormatted: total.toLocaleString(),
      trendDelta: `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`,
      isPositiveTrend: growth >= 0,
      periodAverageFormatted: Math.round(avg).toLocaleString(),
    };
  }, [chartData, metricValues, numericValues, hasNumericData, activeMetric]);

  // SVG Line & Area Coordinates: only plot when authentic numeric data exists
  const rawMin = hasNumericData ? Math.min(...numericValues) : 0;
  const rawMax = hasNumericData ? Math.max(...numericValues) : 100;
  const minVal = rawMin * 0.92;
  const maxVal = rawMax > rawMin ? rawMax * 1.08 : rawMax + 10;
  const range = maxVal - minVal || 1;

  const points = useMemo(() => {
    return chartData.map((d, index) => {
      const val = d[activeMetric];
      const hasVal = typeof val === "number";
      const x = (index / Math.max(1, chartData.length - 1)) * 550 + 25;
      const numVal = hasVal ? (val as number) : minVal;
      const y = 170 - ((numVal - minVal) / range) * 130;
      return { x, y, hasVal, ...d };
    });
  }, [chartData, activeMetric, minVal, range]);

  const pathD = useMemo(() => {
    const validPoints = points.filter((pt) => pt.hasVal);
    return validPoints.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, "");
  }, [points]);

  const areaD = useMemo(() => {
    const validPoints = points.filter((pt) => pt.hasVal);
    if (validPoints.length === 0 || !pathD) return "";
    return `${pathD} L ${validPoints[validPoints.length - 1].x} 180 L ${validPoints[0].x} 180 Z`;
  }, [pathD, points]);

  // Handle interactive SVG hover tracking
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX = (mouseX / rect.width) * 600;

    let closestIdx = 0;
    let minDiff = Infinity;
    points.forEach((pt, i) => {
      const diff = Math.abs(pt.x - relX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    });

    setHoveredIndex(closestIdx);
  };

  const activeHoverPoint = hoveredIndex !== null && points[hoveredIndex] ? points[hoveredIndex] : null;

  const renderInteractiveChart = () => (
    <div>
      {/* Trend Summary Numbers */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 px-1">
        <div>
          <span className="text-xs text-zinc-500 capitalize">
            Period Total ({activeMetric}):
          </span>
          <div className="text-xl font-bold font-mono text-zinc-900 dark:text-white mt-0.5">
            {periodTotalFormatted}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <span className="text-[11px] text-zinc-500">Daily Average:</span>
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 font-mono">
              {periodAverageFormatted}
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-950 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-800">
            <span
              className={`flex items-center gap-1 text-xs font-semibold ${
                isPositiveTrend ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {isPositiveTrend ? <TrendingUpIcon size={14} /> : <TrendingDownIcon size={14} />}
              {trendDelta}
            </span>
            <span className="text-[11px] text-zinc-500">vs preceding period</span>
          </div>
        </div>
      </div>

      {/* SVG Responsive Chart Graphic or Honest Notice */}
      {!hasNumericData ? (
        <div className="flex flex-col items-center justify-center h-44 sm:h-56 rounded-xl bg-zinc-50/80 dark:bg-zinc-950/60 p-6 text-center border border-zinc-200 dark:border-zinc-800/80">
          <InfoIcon className="w-8 h-8 text-amber-500 dark:text-amber-400 mb-2" />
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
            {activeMetric === "impressions"
              ? "Content Views Currently Unavailable"
              : activeMetric === "followers"
                ? "Follower Snapshots Compiling"
                : "Metric Telemetry Unavailable"}
          </h4>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-md mt-1">
            {activeMetric === "impressions"
              ? `Meta Graph API does not currently return daily view counts for @${username || "this account"}. View metrics may be compiling, delayed, or restricted by Meta account tier.`
              : activeMetric === "followers"
                ? `Meta Graph API does not provide retroactive historical daily followers. The system captures authentic daily snapshots every 24 hours in your account history to build your trajectory.`
                : `Historical daily ${activeMetric} telemetry is not currently provided by Meta Graph API.`}
          </p>
          {activeMetric === "impressions" ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setActiveMetric("reach")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-100 dark:hover:bg-indigo-600/30 transition-colors"
              >
                View Verified Live Reach →
              </button>
            </div>
          ) : activeMetric === "followers" && onRefresh ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700/60"
              >
                Sync Snapshot Now
              </button>
            </div>
          ) : null}
        </div>
      ) : !showSampleData && activeMetric === "followers" && numericValues.length < 2 ? (
        <div className="flex flex-col items-center justify-center h-44 sm:h-56 rounded-xl bg-zinc-50/80 dark:bg-zinc-950/60 p-6 text-center border border-zinc-200 dark:border-zinc-800/80">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/50 text-indigo-600 dark:text-indigo-400 mb-2">
            <TrendingUpIcon size={20} />
          </div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
            Follower Trajectory Compiling (1 Snapshot Recorded)
          </h4>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-md mt-1.5 leading-relaxed">
            Initial authentic snapshot: <strong className="text-zinc-900 dark:text-zinc-200">{numericValues[0].toLocaleString()} followers</strong> recorded on {chartData[0]?.fullDate || "today"}. A time-series trajectory requires a minimum of 2 daily snapshots to plot a growth curve and measure velocity.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveMetric("reach")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-100 dark:hover:bg-indigo-600/30 transition-colors"
            >
              View Verified Live Reach →
            </button>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700/60"
              >
                Sync Snapshot Now
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="relative w-full overflow-hidden rounded-xl bg-zinc-50/50 dark:bg-zinc-950/60 p-2 border border-zinc-200 dark:border-zinc-800/80">
          <svg
            ref={svgRef}
            viewBox="0 0 600 200"
            className="w-full h-44 sm:h-56 overflow-visible cursor-crosshair"
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Guide Lines */}
            <line x1="20" y1="40" x2="580" y2="40" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="3 3" />
            <line x1="20" y1="90" x2="580" y2="90" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="3 3" />
            <line x1="20" y1="140" x2="580" y2="140" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="3 3" />

            {/* Area under curve */}
            <path d={areaD} fill="url(#chartGradient)" />

            {/* Main line */}
            <path
              d={pathD}
              fill="none"
              stroke="#6366f1"
              className="stroke-indigo-600 dark:stroke-indigo-400"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Vertical Crosshair Line when Hovering */}
            {activeHoverPoint && activeHoverPoint.hasVal && (
              <line
                x1={activeHoverPoint.x}
                y1={20}
                x2={activeHoverPoint.x}
                y2={180}
                stroke="#6366f1"
                className="stroke-indigo-500 dark:stroke-indigo-400"
                strokeDasharray="2 2"
                strokeWidth="1.5"
                strokeOpacity="0.75"
              />
            )}

            {/* Data Points */}
            {points.map((pt, i) => {
              if (!pt.hasVal) return null;
              const isHovered = hoveredIndex === i;

              return (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? "6" : "3.5"}
                  className={`transition-all duration-150 ${
                    isHovered
                      ? "fill-indigo-600 dark:fill-indigo-400 stroke-white stroke-2 shadow-lg"
                      : "fill-white dark:fill-zinc-950 stroke-indigo-600 dark:stroke-indigo-400 stroke-2 hover:r-5 cursor-pointer"
                  }`}
                />
              );
            })}
          </svg>

          {/* Hover Floating Tooltip */}
          {activeHoverPoint && (
            <div
              className="absolute top-4 pointer-events-none z-10 transition-all duration-75 ease-out"
              style={{
                left: `${Math.min(Math.max(12, (activeHoverPoint.x / 600) * 100), 85)}%`,
                transform: "translateX(-50%)",
              }}
            >
              <div className="rounded-lg bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-indigo-500/30 px-3 py-1.5 shadow-xl backdrop-blur-xs text-center whitespace-nowrap">
                <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                  {activeHoverPoint.fullDate}
                </div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white font-mono mt-0.5">
                  {typeof activeHoverPoint[activeMetric] === "number"
                    ? (activeHoverPoint[activeMetric] as number).toLocaleString()
                    : "Unavailable"}
                </div>
              </div>
            </div>
          )}

          {/* Date Axis Labels */}
          <div className="mt-2 flex justify-between px-4 text-[10px] text-zinc-500 font-mono">
            <span>{points[0]?.date}</span>
            {points.length > 3 && (
              <>
                <span>{points[Math.floor(points.length / 3)]?.date}</span>
                <span>{points[Math.floor((points.length * 2) / 3)]?.date}</span>
              </>
            )}
            <span>{points[points.length - 1]?.date}</span>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-500 text-center flex items-center justify-center gap-1.5">
        <InfoIcon size={12} className="text-zinc-500 shrink-0" />
        <span>
          {isConnected
            ? showSampleData
              ? `Connected to @${username || "creator"}. Showing sample trajectory alongside live 28-day reach (${
                  reach30d !== null && reach30d !== undefined ? reach30d.toLocaleString() : "synced"
                }).`
              : activeMetric === "followers"
                ? `Daily follower snapshots recorded in connected account history (${numericValues.length} snapshot${numericValues.length === 1 ? "" : "s"} logged).`
                : `Connected to @${username || "creator"}. Showing verified daily ${activeMetric === "reach" ? "reach" : "views"} streamed via Meta Graph API.`
            : "Sample trajectory rendering. Connect Meta API to stream verified daily insights."}
        </span>
      </p>
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col lg:flex-row lg:items-center lg:justify-between pb-4 gap-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold text-zinc-100">
              Audience Trajectory & Performance
            </CardTitle>
            <Badge
              variant={isConnected && !showSampleData ? "success" : "purple"}
              className="text-[10px]"
            >
              {showSampleData ? "Sample Visualization (Demo)" : isConnected ? "Live Meta Sync" : "Awaiting Data"}
            </Badge>
          </div>
          <CardDescription className="mt-1 text-xs text-zinc-400">
            {showSampleData
              ? "Demonstration trajectory preview using illustrative sample points."
              : isConnected
                ? `Historical daily performance for @${username || "creator"}. Verified reach, views, and daily follower snapshots.`
                : "Historical daily performance over time. Authenticate Meta account to view authentic telemetry."}
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Selector Tabs */}
          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-950 p-1 border border-zinc-200 dark:border-zinc-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveMetric("reach")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeMetric === "reach"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              Reach
            </button>
            <button
              type="button"
              onClick={() => setActiveMetric("impressions")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeMetric === "impressions"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              Content Views
            </button>
            <button
              type="button"
              onClick={() => setActiveMetric("followers")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeMetric === "followers"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              Followers{showSampleData ? " (Demo)" : ""}
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-950 p-1 border border-zinc-200 dark:border-zinc-800 text-xs">
            {(["7D", "14D", "30D"] as TimeframeType[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setActiveTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  activeTimeframe === tf
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-200 shadow-xs dark:shadow-none"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {showSampleData ? (
          renderInteractiveChart()
        ) : isConnected ? (
          <div className="space-y-6">
            {/* Connected Telemetry Status Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/40 p-4 gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 mt-0.5 shadow-xs dark:shadow-none">
                  <TrendingUpIcon size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                    Telemetry Synced for @{username || "creator"}
                  </h4>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Your Instagram Professional account is actively connected.
                    {reach30d !== null && reach30d !== undefined
                      ? ` Verified 28-day reach is ${reach30d.toLocaleString()}${
                          views30d !== null && views30d !== undefined ? ` with ${views30d.toLocaleString()} views` : ""
                        }.`
                      : " Daily time-series breakdown is aggregating from Meta Graph API."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {onRefresh && (
                  <Button variant="outline" size="sm" onClick={onRefresh}>
                    <span>Refresh Telemetry</span>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onOpenConnectModal}>
                  <span>Manage Connection</span>
                </Button>
              </div>
            </div>

            {/* Live Visual Trajectory Chart or Honest Notice */}
            {chartData.length > 0 ? (
              renderInteractiveChart()
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-12 px-6 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 mb-2">
                  <CalendarIcon size={18} />
                </div>
                <h4 className="text-xs font-semibold text-zinc-200">
                  {activeMetric === "followers"
                    ? "Follower Snapshots Compiling"
                    : "Awaiting Meta Daily Time-Series Points"}
                </h4>
                <p className="mt-1 max-w-sm text-[11px] text-zinc-400 leading-relaxed">
                  {activeMetric === "followers"
                    ? `Daily follower snapshots are recorded every 24 hours in your account history. Once at least 2 daily snapshots are logged for @${username || "creator"}, your authentic follower trajectory will plot here.`
                    : `Meta compiles daily reach and views within a 24–48 hour aggregation window. As soon as daily historical points are computed for @${username || "creator"}, your authentic trajectory will plot here. Verified 28-day totals (${reach30d ? `${reach30d.toLocaleString()} reach` : "synced"}) are displayed in Core Indicators above.`}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Disconnected Empty State */
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-16 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 mb-3">
              <CalendarIcon size={22} />
            </div>
            <h4 className="text-sm font-semibold text-zinc-200">
              No Historical Graph Data Synced
            </h4>
            <p className="mt-1 max-w-md text-xs text-zinc-400 leading-relaxed">
              Trajectory graphs require an authorized Instagram Creator or Business connection.
              Once linked, Meta will provide up to 90 days of daily reach and interaction telemetry.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={onOpenConnectModal}
              className="mt-5"
            >
              <InstagramIcon size={15} />
              <span>Connect Meta Account</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
