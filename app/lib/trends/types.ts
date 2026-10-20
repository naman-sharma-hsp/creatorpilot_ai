export type TrendSourceType = "industry_news" | "search_spike" | "platform_update";

export interface TrendSourceItem {
  id: string;
  sourceType: TrendSourceType;
  sourceName: string; // e.g. "Google News", "Google Search Trends", "Meta Newsroom"
  publisher: string | null; // e.g. "Social Media Examiner", "CNBC"
  title: string;
  url: string; // Validated https: URL only
  domain: string; // e.g. "socialmediaexaminer.com"
  snippet: string | null;
  publishedAt: string | null; // ISO string if pubDate was valid
  freshnessLabel: string; // e.g. "Today", "2 days ago", or "Undated Source"
  trafficVolume: string | null; // General search volume for search spikes (e.g. "100k+ searches"), null for news
  nicheRelevance: string; // Context tag e.g. "Tech & Programming", "Instagram Strategy"
}

export interface TrendResearchResult {
  success: boolean;
  query: string;
  niche: string;
  items: TrendSourceItem[];
  aiSummary: string | null;
  isAiGenerated: boolean;
  fetchedAt: string;
  error?: string | null;
}

export interface FetchTrendsOptions {
  niche?: string;
  subNiches?: string[];
  preferredFormats?: string[];
  languages?: string[];
  geo?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  nowMs?: number;
  bypassAi?: boolean;
}
