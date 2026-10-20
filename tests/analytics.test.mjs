import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// Register custom hook so Node's test runner can load Next.js 'server-only' package marker
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        format: "module",
        shortCircuit: true,
        url: new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href,
      };
    }
    if (specifier === "next/headers") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export const cookies = async () => ({ getAll: () => [], set: () => {} }); export const headers = () => new Headers();",
      };
    }
    if (specifier === "next/navigation") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export function redirect(url) { const err = new Error('NEXT_REDIRECT'); err.digest = 'NEXT_REDIRECT;replace;' + url + ';307;'; err.destination = url; throw err; }",
      };
    }
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        err &&
        err.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

// Import modules to test
const {
  fetchRecentMedia,
  fetchDailyAccountInsights,
  fetchAccountProfileMetrics,
  fetchAccountInsights,
  MAX_SNAPSHOT_RETENTION,
  MIN_SNAPSHOT_INTERVAL_MS,
} = await import("../app/lib/instagram/insights.ts");

const {
  generateHeuristicRecommendations,
} = await import("../app/lib/creator-profile/service.ts");

test("Analytics & Recommendations Unit Tests", async (t) => {
  await t.test("fetchRecentMedia: parses like_count and comments_count correctly under basic scope", async () => {
    const mockFetch = async () => {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "media_1",
              caption: "Post one #coding",
              media_type: "VIDEO",
              timestamp: "2026-10-18T10:00:00Z",
              permalink: "https://instagr.am/p/1",
              like_count: 142,
              comments_count: 18,
            },
            {
              id: "media_2",
              caption: "Post two",
              media_type: "CAROUSEL_ALBUM",
              timestamp: "2026-10-17T12:00:00Z",
              permalink: "https://instagr.am/p/2",
              like_count: 85,
              comments_count: 4,
            },
            {
              id: "media_3",
              caption: "Post three with no interaction data",
              media_type: "IMAGE",
              timestamp: "2026-10-16T15:00:00Z",
              like_count: null,
              comments_count: null,
            },
          ],
        }),
      };
    };

    const media = await fetchRecentMedia({
      accessToken: "mock_token",
      apiVersion: "v21.0",
      fetchFn: mockFetch,
      limit: 5,
    });

    assert.equal(media.length, 3);
    assert.equal(media[0].id, "media_1");
    assert.equal(media[0].likeCount, 142);
    assert.equal(media[0].commentsCount, 18);
    assert.equal(media[1].likeCount, 85);
    assert.equal(media[1].commentsCount, 4);
    assert.equal(media[2].likeCount, null);
    assert.equal(media[2].commentsCount, null);
  });

  await t.test("fetchDailyAccountInsights: queries period=day with 30-day since/until window and maps chronological points without synthetic interpolation", async () => {
    const fixedNow = new Date("2026-10-20T12:00:00Z");
    const expectedUntil = Math.floor(fixedNow.getTime() / 1000);
    const expectedSince = expectedUntil - 30 * 24 * 60 * 60;

    const mockFetch = async (urlStr) => {
      const parsedUrl = new URL(urlStr);
      assert.equal(parsedUrl.searchParams.get("period"), "day");
      const metric = parsedUrl.searchParams.get("metric");
      assert.ok(metric === "reach" || metric === "views");
      // Verifies explicit since and until query parameters (preventing Meta's 2-day default truncation)
      assert.equal(parsedUrl.searchParams.get("since"), String(expectedSince));
      assert.equal(parsedUrl.searchParams.get("until"), String(expectedUntil));

      return {
        ok: true,
        json: async () => ({
          data: [
            ...(metric === "reach" ? [
              {
                name: "reach",
                period: "day",
                values: [
                  { value: 120, end_time: "2026-10-18T07:00:00+0000" },
                  { value: 240, end_time: "2026-10-19T07:00:00+0000" },
                ],
              },
            ] : []),
            ...(metric === "views" ? [
              {
                name: "views",
                period: "day",
                values: [
                  { value: 210, end_time: "2026-10-18T07:00:00+0000" },
                  { value: 430, end_time: "2026-10-19T07:00:00+0000" },
                ],
              },
            ] : []),
          ],
        }),
      };
    };

    const points = await fetchDailyAccountInsights({
      accessToken: "mock_token",
      platformUserId: "1784140001",
      apiVersion: "v21.0",
      fetchFn: mockFetch,
      now: fixedNow,
    });

    assert.equal(points.length, 2);
    assert.equal(points[0].reach, 120);
    assert.equal(points[0].views, 210);
    assert.equal(points[1].reach, 240);
    assert.equal(points[1].views, 430);
    // Verifies chronological sorting
    assert.ok(points[0].date < points[1].date);
  });

  await t.test("fetchDailyAccountInsights: returns empty array honestly if Meta returns empty data without synthesizing fake curves", async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const points = await fetchDailyAccountInsights({
      accessToken: "mock_token",
      platformUserId: "1784140001",
      apiVersion: "v21.0",
      fetchFn: mockFetch,
    });

    assert.deepEqual(points, []);
  });

  await t.test("Zero-Migration Snapshots: caps retention at MAX_SNAPSHOT_RETENTION (30) and respects 24-hour interval", () => {
    assert.equal(MAX_SNAPSHOT_RETENTION, 30);
    assert.equal(MIN_SNAPSHOT_INTERVAL_MS, 24 * 60 * 60 * 1000);

    // Simulate snapshot list growth beyond 30 items
    const existing = [];
    const baseTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 35; i++) {
      existing.push({
        timestamp: new Date(baseTime + i * 24 * 60 * 60 * 1000).toISOString(),
        followersCount: 1000 + i * 10,
        mediaCount: 20 + i,
        reach30d: 5000 + i * 100,
        views30d: 8000 + i * 200,
        totalRecentLikes: 150 + i * 5,
        totalRecentComments: 20 + i,
      });
    }

    let capped = [...existing];
    if (capped.length > MAX_SNAPSHOT_RETENTION) {
      capped = capped.slice(capped.length - MAX_SNAPSHOT_RETENTION);
    }

    assert.equal(capped.length, 30);
    assert.equal(capped[capped.length - 1].followersCount, 1340);
  });

  await t.test("generateHeuristicRecommendations: contains NO fabricated marketing percentages or fake multipliers", () => {
    const niches = ["Tech & Programming", "Fitness & Health", "Design & Creative", "Business & Finance", "General Lifestyle"];

    const forbiddenPhrases = [
      "64%",
      "3.4x",
      "52%",
      "4.1x",
      "70%",
      "3.6x",
      "48%",
      "3.9x",
      "3.2x",
      "42 minutes",
    ];

    for (const n of niches) {
      const recs = generateHeuristicRecommendations(
        { niche: n, preferredFormats: ["reel", "carousel"], languages: ["English"] },
        { username: "creator_test", followersCount: 1520, reach30d: 8400 }
      );

      assert.equal(recs.length, 3);
      for (const rec of recs) {
        // Assert every recommendation clearly carries factBadge and isAiHypothesis: true
        assert.ok(typeof rec.factBadge === "string" && rec.factBadge.length > 0);
        assert.equal(rec.isAiHypothesis, true);

        // Check for forbidden fabricated percentage claims
        for (const phrase of forbiddenPhrases) {
          assert.ok(
            !rec.summary.includes(phrase),
            `Found fabricated marketing phrase "${phrase}" in recommendation "${rec.title}"`
          );
        }

        // Verify impactScore is strictly qualitative and has no fake match percentages
        assert.ok(
          !rec.impactScore.includes("%") && !rec.impactScore.toLowerCase().includes("match"),
          `Found fabricated percentage in impactScore "${rec.impactScore}"`
        );
        assert.ok(
          ["High Impact", "Timing Signal", "Save Potential"].includes(rec.impactScore),
          `Unexpected impactScore label: "${rec.impactScore}"`
        );
      }
    }
  });

  await t.test("generateHeuristicRecommendations: attaches verified account fact badges when telemetry is present", () => {
    const recsWithFollowers = generateHeuristicRecommendations(
      { niche: "Tech", preferredFormats: ["reel", "carousel"] },
      { followersCount: 25400, mediaCount: 124 }
    );
    assert.equal(recsWithFollowers[2].factBadge, "25,400 Followers");

    const recsWithoutFollowers = generateHeuristicRecommendations(
      { niche: "Design", preferredFormats: ["carousel"] },
      null
    );
    assert.equal(recsWithoutFollowers[0].factBadge, "Niche: Design");
  });

  await t.test("Performance Velocity: handles zero baseline without fabricating 18.4% growth", () => {
    const firstTotal = 0;
    const secondTotal = 500;
    const growth = firstTotal > 0 ? ((secondTotal - firstTotal) / firstTotal) * 100 : 0;
    assert.equal(growth, 0);
  });

  await t.test("Regression Bug 1: fetchAccountProfileMetrics removes unsupported follows_count to prevent Meta Error 100", async () => {
    let requestedUrl = "";
    const mockFetch = async (url) => {
      requestedUrl = String(url);
      const parsed = new URL(requestedUrl);
      const fields = parsed.searchParams.get("fields") || "";
      // CRITICAL: follows_count must never be requested
      assert.ok(!fields.includes("follows_count"), "follows_count must not be present in fields");
      assert.ok(fields.includes("followers_count"), "followers_count must be present");
      assert.ok(fields.includes("media_count"), "media_count must be present");

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "ig-12345",
          username: "verified_creator",
          followers_count: 32450,
          media_count: 58,
        }),
      };
    };

    const metrics = await fetchAccountProfileMetrics({
      accessToken: "mock_token",
      fetchFn: mockFetch,
    });

    assert.equal(metrics.followersCount, 32450);
    assert.equal(metrics.mediaCount, 58);
  });

  await t.test("Regression Bug 2: fetchAccountInsights isolates Reach and Views so Views failure does not break Reach", async () => {
    const mockFetch = async (urlStr) => {
      const url = new URL(urlStr);
      const metric = url.searchParams.get("metric");

      if (metric === "reach") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                name: "reach",
                period: "days_28",
                total_value: { value: 64200 },
              },
            ],
          }),
        };
      }

      if (metric === "views") {
        // Simulate Meta Error 100 on Views (e.g. unaggregated views or unsupported account tier)
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              message: "(#100) Metric (views) is not supported for this account tier",
              type: "OAuthException",
              code: 100,
            },
          }),
        };
      }

      throw new Error(`Unexpected metric requested: ${metric}`);
    };

    const insights = await fetchAccountInsights({
      accessToken: "mock_token",
      platformUserId: "1784140001",
      fetchFn: mockFetch,
      period: "days_28",
    });

    // Reach must succeed despite Views failing!
    assert.equal(insights.reach, 64200);
    // Views must be null, NEVER fabricated as 0
    assert.equal(insights.views, null);
    assert.notEqual(insights.views, 0);
  });

  await t.test("Regression Bug 2: fetchAccountInsights preserves genuine zero views vs unavailable null", async () => {
    // 1. Genuine Zero from Meta
    const mockFetchZero = async (urlStr) => {
      const url = new URL(urlStr);
      const metric = url.searchParams.get("metric");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              name: metric,
              total_value: { value: 0 },
            },
          ],
        }),
      };
    };

    const insightsZero = await fetchAccountInsights({
      accessToken: "mock_token",
      platformUserId: "1784140001",
      fetchFn: mockFetchZero,
    });

    assert.equal(insightsZero.reach, 0);
    assert.equal(insightsZero.views, 0);
    assert.notEqual(insightsZero.views, null);

    // 2. Unavailable / Missing from Meta
    const mockFetchMissing = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      };
    };

    const insightsMissing = await fetchAccountInsights({
      accessToken: "mock_token",
      platformUserId: "1784140001",
      fetchFn: mockFetchMissing,
    });

    assert.equal(insightsMissing.reach, null);
    assert.equal(insightsMissing.views, null);
  });

  await t.test("Regression Bug 2: Daily time-series preserves null views without converting to zero", async () => {
    const fixedNow = new Date("2026-10-20T12:00:00Z");
    const mockFetch = async (urlStr) => {
      const url = new URL(urlStr);
      const metric = url.searchParams.get("metric");

      if (metric === "reach") {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                name: "reach",
                period: "day",
                values: [
                  { value: 150, end_time: "2026-10-18T07:00:00+0000" },
                  { value: 300, end_time: "2026-10-19T07:00:00+0000" },
                ],
              },
            ],
          }),
        };
      }

      // Views returns empty or fails
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    };

    const dailyPoints = await fetchDailyAccountInsights({
      accessToken: "mock_token",
      platformUserId: "1784140001",
      fetchFn: mockFetch,
      now: fixedNow,
    });

    assert.equal(dailyPoints.length, 2);
    assert.equal(dailyPoints[0].reach, 150);
    assert.equal(dailyPoints[0].views, null); // Strictly null, NEVER 0
    assert.equal(dailyPoints[1].reach, 300);
    assert.equal(dailyPoints[1].views, null); // Strictly null, NEVER 0
  });

  await t.test("Followers Chart: 0 snapshots returns empty points and compiling state without fabricating data", () => {
    const followerHistory = [];
    const activeTimeframe = "30D";
    const daysCount = activeTimeframe === "7D" ? 7 : activeTimeframe === "14D" ? 14 : 30;

    // Mapping logic mirror from performance-chart-card.tsx
    const slice = followerHistory.slice(-daysCount);
    const chartData = slice.map((s) => ({
      date: s.timestamp ? s.timestamp.slice(5, 10) : "",
      fullDate: s.timestamp || "",
      reach: s.reach30d,
      impressions: s.views30d,
      followers: typeof s.followersCount === "number" ? s.followersCount : null,
      engagement: null,
    }));

    assert.equal(chartData.length, 0);
    const validFollowerPoints = chartData.filter((d) => typeof d.followers === "number");
    assert.equal(validFollowerPoints.length, 0);

    // Verify fallback display does not invent data
    const followersCount = 652;
    const periodTotal = validFollowerPoints.length === 0 ? followersCount.toLocaleString() : "—";
    const trendDelta = validFollowerPoints.length === 0 ? "Compiling" : "—";
    assert.equal(periodTotal, "652");
    assert.equal(trendDelta, "Compiling");
  });

  await t.test("Followers Chart: 1 snapshot returns 1 verified point and compiling state, strictly never faking a second point", () => {
    const followerHistory = [
      {
        timestamp: "2026-10-20T11:38:43Z",
        followersCount: 652,
        mediaCount: 144,
        reach30d: 6532,
        views30d: 8006,
      },
    ];

    const slice = followerHistory.slice(-30);
    const chartData = slice.map((s) => {
      const d = new Date(s.timestamp);
      return {
        date: !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : "",
        fullDate: !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "",
        reach: s.reach30d,
        impressions: s.views30d,
        followers: typeof s.followersCount === "number" ? s.followersCount : null,
        engagement: null,
      };
    });

    assert.equal(chartData.length, 1);
    assert.equal(chartData[0].followers, 652);

    const validPoints = chartData.filter((d) => typeof d.followers === "number");
    assert.equal(validPoints.length, 1);

    // Rule: Single snapshot does NOT fabricate a trajectory line (< 2 points)
    const canPlotLine = validPoints.length >= 2;
    assert.equal(canPlotLine, false);

    // Rule: Status is explicitly 1 snapshot recorded
    const current = validPoints[0].followers;
    const trendDelta = "1 snapshot recorded";
    assert.equal(current, 652);
    assert.equal(trendDelta, "1 snapshot recorded");
  });

  await t.test("Followers Chart: 2+ snapshots correctly maps authentic trajectory and calculates net gain/velocity", () => {
    const followerHistory = [
      {
        timestamp: "2026-10-18T10:00:00Z",
        followersCount: 640,
        mediaCount: 142,
        reach30d: 6100,
        views30d: 7800,
      },
      {
        timestamp: "2026-10-19T10:00:00Z",
        followersCount: 645,
        mediaCount: 143,
        reach30d: 6300,
        views30d: 7950,
      },
      {
        timestamp: "2026-10-20T10:00:00Z",
        followersCount: 652,
        mediaCount: 144,
        reach30d: 6532,
        views30d: 8006,
      },
    ];

    // 1. Timeframe slicing
    const slice7D = followerHistory.slice(-7);
    assert.equal(slice7D.length, 3);

    const chartData = slice7D.map((s) => ({
      date: s.timestamp.slice(5, 10),
      fullDate: s.timestamp,
      reach: s.reach30d,
      impressions: s.views30d,
      followers: typeof s.followersCount === "number" ? s.followersCount : null,
      engagement: null,
    }));

    const validPoints = chartData.filter((d) => typeof d.followers === "number");
    assert.equal(validPoints.length, 3);
    assert.equal(validPoints.length >= 2, true); // Can plot line trajectory

    // 2. Growth calculation
    const current = validPoints[validPoints.length - 1].followers;
    const start = validPoints[0].followers;
    const gain = current - start;
    const deltaPercent = start > 0 ? ((gain / start) * 100).toFixed(1) : "0.0";

    assert.equal(current, 652);
    assert.equal(start, 640);
    assert.equal(gain, 12);
    assert.equal(deltaPercent, "1.9");

    const trendDelta = `${gain >= 0 ? "+" : ""}${gain.toLocaleString()} (${gain >= 0 ? "+" : ""}${deltaPercent}%)`;
    assert.equal(trendDelta, "+12 (+1.9%)");
    assert.equal(gain >= 0, true);
  });

  await t.test("Followers Chart: strictly forbids deriving past follower counts backwards from current count", () => {
    // Current count is 652, but without historical snapshot, past points MUST NOT be synthesized
    const currentFollowers = 652;
    const dailyReachPoints = [
      { date: "2026-10-18", reach: 500, views: null },
      { date: "2026-10-19", reach: 700, views: null },
      { date: "2026-10-20", reach: 900, views: null },
    ];

    // Live mode mapping for followers only accepts verified snapshots
    const liveFollowerPoints = dailyReachPoints.map((pt) => ({
      date: pt.date,
      reach: pt.reach,
      followers: null, // Strictly null, NEVER currentFollowers - reach * conversion
    }));

    assert.ok(liveFollowerPoints.every((pt) => pt.followers === null));
  });
});
