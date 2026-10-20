export type PlanTier = "creator" | "pro" | "agency";
export type PlatformType = "instagram" | "facebook";
export type ConnectionStatus = "connected" | "disconnected" | "expired";
export type DraftFormat = "reel" | "carousel" | "post" | "story";
export type DraftStatus = "draft" | "review" | "scheduled" | "published";

export interface DiscrepancyItem {
  field: string;
  creatorAnswer: string;
  aiObservation: string;
  explanation: string;
  severity: "info" | "warning";
}

export interface AiProfileAnalysis {
  suggestedNiche: string;
  suggestedSubNiches: string[];
  audienceThemes: string[];
  audienceDemographicsNote: string;
  contentThemes: string[];
  recommendedFormats: DraftFormat[];
  opportunities: string[];
  discrepancies: DiscrepancyItem[];
  missingEvidenceNotes: string[];
  analyzedAt: string;
}

export interface CreatorPreferences {
  niche: string;
  subNiches: string[];
  targetAudience: string;
  contentGoals: string[];
  preferredFormats: DraftFormat[];
  brandVoice: string[];
  languages: string[];
  topicsToCover: string[];
  topicsToAvoid: string[];
  otherNotes?: string;
  isConfirmed: boolean;
  confirmedAt?: string | null;
  updatedAt?: string;
  aiSuggestions?: AiProfileAnalysis | null;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  creator_handle: string | null;
  avatar_url: string | null;
  plan_tier: PlanTier;
  preferences?: CreatorPreferences;
  created_at: string;
  updated_at: string;
}

export interface ConnectedAccount {
  id: string;
  user_id: string;
  platform: PlatformType;
  platform_user_id: string | null;
  username: string | null;
  status: ConnectionStatus;
  scopes: string[];
  metadata: Record<string, unknown>;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentDraft {
  id: string;
  user_id: string;
  title: string;
  caption: string | null;
  format: DraftFormat;
  status: DraftStatus;
  scheduled_for: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ActionState {
  success?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
}

export interface CreateDraftInput {
  title: string;
  caption?: string | null;
  format: DraftFormat;
  status?: DraftStatus;
  scheduled_for?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateDraftInput {
  title?: string;
  caption?: string | null;
  format?: DraftFormat;
  status?: DraftStatus;
  scheduled_for?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DraftListFilter {
  format?: DraftFormat;
  status?: DraftStatus;
  limit?: number;
  offset?: number;
}

export interface DraftActionResult extends ActionState {
  draft?: ContentDraft;
  drafts?: ContentDraft[];
  total?: number;
}

export interface GenerateCaptionInput {
  format: "post" | "reel";
  topic: string;
  callToAction?: string;
  language?: string;
  tone?: string;
}

export interface GeneratedCaptionResult {
  caption: string;
  hashtags: string[];
  callToAction?: string;
  explanation: string;
  format: "post" | "reel";
  language: string;
  tone: string;
  scriptWarning?: string;
}

export interface GenerateCaptionActionResult extends Omit<ActionState, "data"> {
  data?: GeneratedCaptionResult;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  quotaDetails?: string;
  scriptWarning?: string;
}

export interface CreativeIntelligenceItem {
  id: string;
  category: string;
  title: string;
  summary: string;
  impactScore: string;
  iconType: "video" | "clock" | "layers" | "trending" | "sparkles";
  suggestedAction: string;
  targetTab: "ai-studio" | "planner";
  factBadge?: string;
  isAiHypothesis?: boolean;
}

export interface CreativeIntelligenceResult extends ActionState {
  recommendations?: CreativeIntelligenceItem[];
  model?: string;
  isAiGenerated?: boolean;
}

export interface ChatMessageTurn {
  id: string;
  role: "user" | "model";
  content: string;
  createdAt: string;
  model?: string;
  language?: string;
  tone?: string;
  scriptWarning?: string;
}

export interface CreatorChatInput {
  message: string;
  history?: Array<{
    role: "user" | "model";
    content: string;
  }>;
  language?: string;
  tone?: string;
}

export interface CreatorChatActionResult extends Omit<ActionState, "data"> {
  message?: string;
  model?: string;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  quotaDetails?: string;
  isModelRestricted?: boolean;
  language?: string;
  tone?: string;
  scriptWarning?: string;
}

export interface ReelScriptOutline {
  hook: string;
  lesson: string;
  callToAction: string;
}

export interface ContentIdeaCard {
  id: string;
  title: string;
  concept: string;
  format: "reel" | "post";
  hooks: [string, string, string];
  script: ReelScriptOutline;
  targetAudienceAngle: string;
  suggestedPillar?: string;
  language?: string;
  tone?: string;
}

export interface GenerateIdeasInput {
  topic?: string;
  pillar?: string;
  format?: "all" | "reel" | "post";
  targetGoal?: string;
  language?: string;
  tone?: string;
}

export interface GenerateIdeasActionResult extends Omit<ActionState, "data"> {
  ideas?: ContentIdeaCard[];
  model?: string;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  quotaDetails?: string;
  language?: string;
  tone?: string;
  scriptWarning?: string;
}

export interface CarouselSlideItem {
  slideNumber: number;
  slideType: "cover" | "value" | "cta";
  headline: string;
  bodyText: string;
  visualSuggestion: string;
  type?: "cover" | "value" | "cta";
}

export interface GeneratedCarouselResult {
  title: string;
  slides: CarouselSlideItem[];
  companionCaption: string;
  caption?: string;
  hashtags: string[];
  slideCount: number;
  model?: string;
  targetAudienceAngle?: string;
  pillar?: string;
  language?: string;
  tone?: string;
  scriptWarning?: string;
}

export interface GenerateCarouselInput {
  topic: string;
  slideCount?: 5 | 7 | 10;
  pillar?: string;
  tone?: string;
  goal?: string;
  language?: string;
}

export interface GenerateCarouselActionResult extends Omit<ActionState, "data"> {
  carousel?: GeneratedCarouselResult;
  model?: string;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  quotaDetails?: string;
  scriptWarning?: string;
}

export type RepurposeMode = "rewrite" | "convert" | "multipack";

export type RewriteGoal = "improve" | "shorten" | "expand" | "hooks";

export type RepurposeTargetFormat = "reel" | "carousel" | "story";

export interface ReelScriptItem {
  hook: string;
  beats: string;
  callToAction: string;
  visualNotes?: string;
}

export interface CarouselOutlineSlide {
  slideNumber: number;
  slideType: "cover" | "value" | "cta";
  headline: string;
  bodyText: string;
  visualSuggestion?: string;
}

export interface StoryFrameItem {
  frameNumber: number;
  frameType: "hook" | "insight" | "cta";
  content: string;
  stickerSuggestion?: string;
}

export interface MultiPackRepurposeResult {
  feedCaption: string;
  hashtags: string[];
  reelScript: ReelScriptItem;
  carouselOutline: {
    title: string;
    slides: CarouselOutlineSlide[];
  };
  storySequence: StoryFrameItem[];
}

export interface GeneratedRepurposeResult {
  mode: RepurposeMode;
  goal?: RewriteGoal;
  targetFormat?: RepurposeTargetFormat;
  originalText: string;
  originalWordCount: number;
  // For rewrite mode
  rewrittenText?: string;
  rewrittenWordCount?: number;
  alternativeHooks?: string[];
  hashtags?: string[];
  explanation?: string;
  // For single format convert mode
  reelScript?: ReelScriptItem;
  carouselOutline?: {
    title: string;
    slides: CarouselOutlineSlide[];
  };
  storySequence?: StoryFrameItem[];
  // For multipack mode
  multiPack?: MultiPackRepurposeResult;
  // Metadata
  model?: string;
  language?: string;
  tone?: string;
  scriptWarning?: string;
}

export interface GenerateRepurposeInput {
  sourceText: string;
  mode: RepurposeMode;
  goal?: RewriteGoal;
  targetFormat?: RepurposeTargetFormat;
  tone?: string;
  language?: string;
  sourceDraftId?: string;
}

export interface GenerateRepurposeActionResult extends Omit<ActionState, "data"> {
  result?: GeneratedRepurposeResult;
  model?: string;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  quotaDetails?: string;
  scriptWarning?: string;
}
