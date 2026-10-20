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
  decodeXmlEntities,
  validateHttpsUrl,
  extractDomain,
  formatFreshnessLabel,
  parseGoogleNewsRss,
  parseGoogleTrendsRss,
  parseMetaNewsroomRss,
  fetchCreatorTrends,
} = await import("../app/lib/trends/service.ts");

const {
  getNicheTrendsAction,
} = await import("../app/actions/trends.ts");

test("Phase 2 — Internet Trend Research Unit & Integration Tests", async (t) => {
  await t.test("XML & Entity Sanitization: decodes CDATA and entities, strips malicious script tags", () => {
    const raw = "Breaking &amp; &quot;Urgent&quot; <![CDATA[Story about <script>alert('xss')</script> AI &amp; Web]]> &#8217;2026&#8217;";
    const clean = decodeXmlEntities(raw);

    assert.ok(!clean.includes("<script>"));
    assert.ok(!clean.includes("&amp;"));
    assert.ok(clean.includes('& "Urgent"'));
    assert.ok(clean.includes("Story about alert('xss') AI & Web '2026'"));
  });

  await t.test("URL Validation: strictly requires https protocol and rejects dangerous schemes", () => {
    assert.equal(validateHttpsUrl("https://example.com/article"), "https://example.com/article");
    assert.equal(validateHttpsUrl("https://news.google.com/rss/articles/123"), "https://news.google.com/rss/articles/123");

    // Must reject non-https schemes
    assert.equal(validateHttpsUrl("http://insecure.com"), null);
    assert.equal(validateHttpsUrl("javascript:alert(1)"), null);
    assert.equal(validateHttpsUrl("data:text/html,<script>"), null);
    assert.equal(validateHttpsUrl("file:///etc/passwd"), null);
    assert.equal(validateHttpsUrl(""), null);
    assert.equal(validateHttpsUrl(null), null);
    assert.equal(validateHttpsUrl(undefined), null);
  });

  await t.test("Domain Extraction: correctly isolates clean domain hostname", () => {
    assert.equal(extractDomain("https://www.socialmediaexaminer.com/reels-guide"), "socialmediaexaminer.com");
    assert.equal(extractDomain("https://about.fb.com/news/category/instagram"), "about.fb.com");
    assert.equal(extractDomain("invalid-url"), "web");
  });

  await t.test("Freshness Labeling: handles valid dates accurately and labels undated sources without fabricating dates", () => {
    const baseNow = new Date("2026-10-20T12:00:00Z").getTime();

    // 2 hours ago
    const twoHoursAgo = new Date("2026-10-20T10:00:00Z").toISOString();
    assert.equal(formatFreshnessLabel(twoHoursAgo, baseNow).freshnessLabel, "2h ago");

    // 3 days ago
    const threeDaysAgo = new Date("2026-10-17T12:00:00Z").toISOString();
    assert.equal(formatFreshnessLabel(threeDaysAgo, baseNow).freshnessLabel, "3 days ago");

    // Missing, empty, or malformed dates must return "Undated Source"
    assert.deepEqual(formatFreshnessLabel(null, baseNow), { publishedAt: null, freshnessLabel: "Undated Source" });
    assert.deepEqual(formatFreshnessLabel("", baseNow), { publishedAt: null, freshnessLabel: "Undated Source" });
    assert.deepEqual(formatFreshnessLabel("not-a-real-date", baseNow), { publishedAt: null, freshnessLabel: "Undated Source" });
  });

  await t.test("Google News RSS Parsing: categorizes as industry_news, parses publisher and valid https URLs", () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>5 Algorithm Strategies for Instagram Reels - TechCrunch</title>
          <link>https://news.google.com/rss/articles/CBMi123</link>
          <pubDate>Mon, 19 Oct 2026 15:30:00 GMT</pubDate>
          <description>Short-form video breakdown strategies for creators.</description>
          <source url="https://techcrunch.com">TechCrunch</source>
        </item>
        <item>
          <title>Insecure Item with Bad Link</title>
          <link>http://insecure.com/bad</link>
          <pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

    const items = parseGoogleNewsRss(mockXml, "Tech", new Date("2026-10-20T12:00:00Z").getTime());
    assert.equal(items.length, 1); // Second item rejected due to insecure http
    assert.equal(items[0].sourceType, "industry_news");
    assert.equal(items[0].publisher, "TechCrunch");
    assert.equal(items[0].title, "5 Algorithm Strategies for Instagram Reels");
    assert.equal(items[0].url, "https://news.google.com/rss/articles/CBMi123");
    assert.equal(items[0].domain, "news.google.com");
    assert.equal(items[0].nicheRelevance, "Tech");
  });

  await t.test("Google Trends RSS Parsing: categorizes as search_spike with explicit search traffic disclaimer", () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
      <channel>
        <item>
          <title>Coding Bootcamps 2026</title>
          <ht:approx_traffic>50K+</ht:approx_traffic>
          <pubDate>Tue, 20 Oct 2026 06:00:00 GMT</pubDate>
          <ht:news_item>
            <ht:news_item_title>Tech Hiring Surge Drives Surge in Coding Certifications</ht:news_item_title>
            <ht:news_item_url>https://wired.com/story/tech-bootcamps-2026</ht:news_item_url>
            <ht:news_item_source>Wired</ht:news_item_source>
          </ht:news_item>
        </item>
      </channel>
    </rss>`;

    const items = parseGoogleTrendsRss(mockXml, "Tech", new Date("2026-10-20T12:00:00Z").getTime());
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceType, "search_spike");
    assert.equal(items[0].trafficVolume, "50K+ searches");
    assert.equal(items[0].publisher, "Wired");
    assert.equal(items[0].url, "https://wired.com/story/tech-bootcamps-2026");
    assert.ok(items[0].snippet.includes("web searches"));
  });

  await t.test("Meta Newsroom Parsing: categorizes as platform_update with Instagram / Meta attribution", () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>New Creative Editing Tools for Instagram Reels</title>
          <link>https://about.fb.com/news/2026/10/instagram-creative-tools</link>
          <pubDate>Fri, 16 Oct 2026 12:00:00 GMT</pubDate>
          <description>Creators now have multi-clip audio synchronization.</description>
        </item>
      </channel>
    </rss>`;

    const items = parseMetaNewsroomRss(mockXml, new Date("2026-10-20T12:00:00Z").getTime());
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceType, "platform_update");
    assert.equal(items[0].publisher, "Instagram / Meta");
    assert.equal(items[0].domain, "about.fb.com");
  });

  await t.test("Personalization & Quota Resilience: falls back cleanly to direct source items when Gemini quota is exhausted", async () => {
    const mockNewsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item>
        <title>Fitness Nutrition Trends for 2026 - Healthline</title>
        <link>https://news.google.com/rss/articles/CBMi999</link>
        <pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate>
        <source>Healthline</source>
      </item>
    </channel></rss>`;

    const mockFetch = async () => ({
      ok: true,
      text: async () => mockNewsXml,
    });

    const result = await fetchCreatorTrends({
      niche: "Fitness & Health",
      fetchFn: mockFetch,
      bypassAi: true, // simulates rate limit or unbilled environment
    });

    assert.equal(result.success, true);
    assert.equal(result.niche, "Fitness & Health");
    assert.ok(result.items.length >= 1);
    assert.equal(result.items[0].publisher, "Healthline");
    assert.equal(result.aiSummary, null);
    assert.equal(result.isAiGenerated, false);
  });

  await t.test("Empty Results: returns honest notice when all feeds return no items without fabricating fake trends", async () => {
    const mockFetch = async () => ({
      ok: true,
      text: async () => "<rss><channel></channel></rss>",
    });

    const result = await fetchCreatorTrends({
      niche: "HyperNicheSubject",
      fetchFn: mockFetch,
    });

    assert.equal(result.success, true);
    assert.equal(result.items.length, 0);
    assert.equal(result.aiSummary, null);
    assert.ok(result.error);
  });

  await t.test("Security & Authorization: server action rejects unauthenticated caller with error", async () => {
    const unauthResult = await getNicheTrendsAction();
    assert.equal(unauthResult.success, false);
    assert.ok(unauthResult.error?.includes("Unauthorized"));
  });
});
