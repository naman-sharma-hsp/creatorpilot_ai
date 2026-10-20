"use client";

import React, { useState, useId } from "react";
import {
  SparklesIcon,
  VideoIcon,
  ImageIcon,
  CopyIcon,
  CheckIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  BookmarkIcon,
  RefreshCwIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  CreatorPreferences,
  ContentIdeaCard,
  ContentDraft,
  DraftFormat,
} from "../../app/lib/definitions";
import { generateIdeasAction } from "../../app/actions/ai-studio";
import { createDraftAction } from "../../app/actions/drafts";
import {
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
  normalizeLanguagePreset,
} from "../../app/lib/localization/standards";

export interface IdeaLabProps {
  creatorPreferences?: CreatorPreferences | null;
  onDraftSaved?: (draft: ContentDraft) => void;
  onNavigateToDrafts?: () => void;
}

interface DraftReviewModalState {
  isOpen: boolean;
  idea: ContentIdeaCard | null;
  title: string;
  caption: string;
  format: DraftFormat;
  isSaving: boolean;
  error?: string | null;
  success?: string | null;
}

export function IdeaLab({
  creatorPreferences,
  onDraftSaved,
  onNavigateToDrafts,
}: IdeaLabProps) {
  const formId = useId();

  // Generator form inputs
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"all" | "reel" | "post">("all");
  const [selectedPillar, setSelectedPillar] = useState<string>("");
  const [customPillar, setCustomPillar] = useState("");
  const [language, setLanguage] = useState<string>(() => {
    return normalizeLanguagePreset(creatorPreferences?.languages?.[0]) || "English";
  });
  const [tone, setTone] = useState<string>(() => {
    return creatorPreferences?.brandVoice?.[0] || CANONICAL_TONE_OPTIONS[0];
  });
  const [scriptWarning, setScriptWarning] = useState<string | null>(null);

  // State management
  const [isGenerating, setIsGenerating] = useState(false);
  const [ideas, setIdeas] = useState<ContentIdeaCard[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeHookIndex, setActiveHookIndex] = useState<Record<string, number>>({});
  const [generationError, setGenerationError] = useState<{
    message: string;
    quotaDetails?: string;
    retryAfterMs?: number;
  } | null>(null);

  // Draft review modal state
  const [draftReview, setDraftReview] = useState<DraftReviewModalState>({
    isOpen: false,
    idea: null,
    title: "",
    caption: "",
    format: "reel",
    isSaving: false,
    error: null,
    success: null,
  });

  const hasConfirmedIdentity = Boolean(
    creatorPreferences?.isConfirmed && creatorPreferences?.niche
  );

  const subNiches = creatorPreferences?.subNiches || [];
  const effectivePillar =
    selectedPillar === "custom"
      ? customPillar.trim()
      : selectedPillar || (subNiches.length > 0 ? subNiches[0] : "");

  // Generate ideas handler
  const handleGenerateIdeas = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGenerating) return;

    setIsGenerating(true);
    setGenerationError(null);
    setScriptWarning(null);

    try {
      const response = await generateIdeasAction({
        topic: topic.trim() || undefined,
        format,
        pillar: effectivePillar || undefined,
        language,
        tone,
      });

      if (!response.success || !response.ideas) {
        setGenerationError({
          message: response.error || "Unable to generate content ideas. Please try again.",
          quotaDetails: response.quotaDetails,
          retryAfterMs: response.retryAfterMs,
        });
        return;
      }

      setIdeas(response.ideas);
      setScriptWarning(response.scriptWarning || null);
      // Default each idea card to hook 0
      const initialHooks: Record<string, number> = {};
      response.ideas.forEach((idea) => {
        initialHooks[idea.id] = 0;
      });
      setActiveHookIndex(initialHooks);
    } catch (err) {
      setGenerationError({
        message:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while communicating with the Idea Lab service.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy helper
  const handleCopy = async (id: string, text: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch {
      // Fallback
    }
  };

  // Open Save as Draft modal
  const handleOpenDraftReview = (idea: ContentIdeaCard) => {
    const selectedHook = idea.hooks[activeHookIndex[idea.id] || 0];

    // Format full script for caption draft
    const formattedDraftCaption = `[HOOK]\n${selectedHook}\n\n[CORE LESSON / BREAKDOWN]\n${idea.script.lesson}\n\n[CALL TO ACTION]\n${idea.script.callToAction}\n\n---\nAlternative Hooks:\n1. ${idea.hooks[0]}\n2. ${idea.hooks[1]}\n3. ${idea.hooks[2]}`;

    setDraftReview({
      isOpen: true,
      idea,
      title: idea.title,
      caption: formattedDraftCaption,
      format: idea.format,
      isSaving: false,
      error: null,
      success: null,
    });
  };

  // Commit draft to Supabase via server action
  const handleSaveDraft = async () => {
    if (!draftReview.idea || !draftReview.title.trim()) return;

    setDraftReview((prev) => ({ ...prev, isSaving: true, error: null, success: null }));

    try {
      const response = await createDraftAction({
        title: draftReview.title.trim(),
        caption: draftReview.caption.trim(),
        format: draftReview.format,
        status: "draft",
        metadata: {
          source: "idea_lab",
          model: "gemini-3.5-flash-lite",
          concept: draftReview.idea.concept,
          hooks: draftReview.idea.hooks,
          script: draftReview.idea.script,
          targetAudienceAngle: draftReview.idea.targetAudienceAngle,
          pillar: draftReview.idea.suggestedPillar,
          language: draftReview.idea.language || language,
          tone: draftReview.idea.tone || tone,
          savedAt: new Date().toISOString(),
        },
      });

      if (!response.success || !response.draft) {
        setDraftReview((prev) => ({
          ...prev,
          isSaving: false,
          error: response.error || "Failed to save draft. Please try again.",
        }));
        return;
      }

      setDraftReview((prev) => ({
        ...prev,
        isSaving: false,
        success: "Draft successfully saved to your Vault!",
      }));

      if (onDraftSaved) {
        onDraftSaved(response.draft);
      }
    } catch (err) {
      setDraftReview((prev) => ({
        ...prev,
        isSaving: false,
        error: err instanceof Error ? err.message : "Unable to save draft.",
      }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration & Trigger Card */}
      <div className="p-4 sm:p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white">
                Hook & Reel Idea Lab
              </h2>
              <Badge variant="purple" className="text-[10px]">
                gemini-3.5-flash-lite
              </Badge>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              Generate 3 high-retention post and Reel concepts with 3 hook angles and 3-beat scripts.
            </p>
          </div>

          {hasConfirmedIdentity ? (
            <Badge variant="success" dot className="text-xs self-start sm:self-auto">
              {creatorPreferences?.niche}
            </Badge>
          ) : (
            <Badge variant="neutral" className="text-xs self-start sm:self-auto">
              Unconfirmed Profile
            </Badge>
          )}
        </div>

        <form onSubmit={handleGenerateIdeas} className="space-y-4">
          {/* Optional Topic or Angle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor={`${formId}-topic`}
                className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Creative Angle or Specific Topic (Optional)
              </label>
              <span className="text-[10px] text-zinc-500">{topic.length}/500</span>
            </div>
            <input
              id={`${formId}-topic`}
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 500))}
              placeholder={
                hasConfirmedIdentity
                  ? `e.g. 3 common mistakes junior devs make when deploying Next.js, or leave blank to use your confirmed niche`
                  : "e.g. 5 quick productivity hacks for busy professionals"
              }
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-sans"
            />
          </div>

          {/* Format, Pillar, Language & Tone Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Format Filter */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Target Format
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as "all" | "reel" | "post")}
                className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
              >
                <option value="all">Mix (Reels & Posts)</option>
                <option value="reel">Reels Only (Video)</option>
                <option value="post">Feed Posts Only</option>
              </select>
            </div>

            {/* Content Pillar */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Content Pillar Focus
              </label>
              {subNiches.length > 0 ? (
                <select
                  value={selectedPillar}
                  onChange={(e) => setSelectedPillar(e.target.value)}
                  className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                >
                  <option value="">All Pillars (Balanced)</option>
                  {subNiches.map((niche, idx) => (
                    <option key={idx} value={niche}>
                      {niche}
                    </option>
                  ))}
                  <option value="custom">Custom Pillar...</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={customPillar}
                  onChange={(e) => setCustomPillar(e.target.value.slice(0, 100))}
                  placeholder="e.g. Tips, Tutorials, Behind-the-Scenes"
                  className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              )}
            </div>

            {/* Language / Script */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Language / Script
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
              >
                {CANONICAL_LANGUAGE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Tone / Voice */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Tone / Voice
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
              >
                {creatorPreferences?.brandVoice && creatorPreferences.brandVoice.length > 0 && (
                  <optgroup label="Your Confirmed Voice">
                    {creatorPreferences.brandVoice.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Standard Tones">
                  {CANONICAL_TONE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {selectedPillar === "custom" && subNiches.length > 0 && (
            <div className="space-y-1 animate-in fade-in duration-150">
              <label className="text-[10px] text-zinc-600 dark:text-zinc-400 font-medium">
                Enter Custom Pillar
              </label>
              <input
                type="text"
                value={customPillar}
                onChange={(e) => setCustomPillar(e.target.value.slice(0, 100))}
                placeholder="Custom pillar name"
                className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Submit Trigger */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Strict ₹0 Budget · Generates 3 distinct concepts with 9 hooks & scripts
            </span>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isGenerating}
              disabled={isGenerating}
              className="w-full sm:w-auto h-9 px-5 gap-2"
            >
              <SparklesIcon size={15} />
              <span>{ideas.length > 0 ? "Regenerate Concepts" : "Brainstorm 3 Concepts"}</span>
            </Button>
          </div>
        </form>
      </div>

      {/* Error Alert Box */}
      {generationError && (
        <div className="p-3.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
          <AlertCircleIcon size={16} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <span className="font-semibold block">Idea Generation Feedback</span>
            <p className="leading-relaxed text-zinc-800 dark:text-zinc-300">{generationError.message}</p>
            {generationError.quotaDetails && (
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{generationError.quotaDetails}</p>
            )}
            {generationError.retryAfterMs ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Recommended retry in ~{Math.ceil(generationError.retryAfterMs / 1000)}s.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Script Consistency Advisory Warning (Non-blocking) */}
      {scriptWarning && (
        <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
          <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <span className="font-semibold block">Language / Script Advisory</span>
            <p className="leading-relaxed text-zinc-800 dark:text-zinc-300">{scriptWarning}</p>
          </div>
        </div>
      )}

      {/* Generated Ideas Grid */}
      {ideas.length > 0 && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 flex items-center gap-2">
              <span>Generated Content Concepts</span>
              <Badge variant="neutral" className="text-[10px]">
                {ideas.length} ideas
              </Badge>
            </h3>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Pick your preferred hook angle below or save to Drafts Vault
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {ideas.map((idea, index) => {
              const currentHookIndex = activeHookIndex[idea.id] || 0;
              const activeHookText = idea.hooks[currentHookIndex] || idea.hooks[0];
              const fullScriptText = `[HOOK]\n${activeHookText}\n\n[LESSON]\n${idea.script.lesson}\n\n[CTA]\n${idea.script.callToAction}`;
              const isScriptCopied = copiedId === `script-${idea.id}`;

              return (
                <div
                  key={idea.id}
                  className="flex flex-col justify-between p-4 sm:p-5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700/80 transition-all space-y-4"
                >
                  <div className="space-y-3.5">
                    {/* Header Badges */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 text-[10px] font-bold flex items-center justify-center">
                          {index + 1}
                        </span>
                        <Badge
                          variant={idea.format === "reel" ? "purple" : "info"}
                          className="text-[10px] gap-1"
                        >
                          {idea.format === "reel" ? (
                            <>
                              <VideoIcon size={12} />
                              <span>Reel</span>
                            </>
                          ) : (
                            <>
                              <ImageIcon size={12} />
                              <span>Post</span>
                            </>
                          )}
                        </Badge>
                      </div>

                      {idea.suggestedPillar && (
                        <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 truncate max-w-[130px]">
                          {idea.suggestedPillar}
                        </span>
                      )}
                    </div>

                    {/* Title & Premise */}
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
                        {idea.title}
                      </h4>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                        {idea.concept}
                      </p>
                    </div>

                    {/* Target Audience Resonation */}
                    <div className="p-2 rounded-md bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold block text-[10px] uppercase tracking-wide">
                        Target Audience Angle
                      </span>
                      {idea.targetAudienceAngle}
                    </div>

                    {/* 3 Hook Variations */}
                    <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-300">
                          Hook Angles (1.5s Opening)
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(`hook-${idea.id}-${currentHookIndex}`, activeHookText)}
                          className="h-5 px-1.5 text-[10px] gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                        >
                          {copiedId === `hook-${idea.id}-${currentHookIndex}` ? (
                            <>
                              <CheckIcon size={11} className="text-emerald-500 dark:text-emerald-400" />
                              <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <CopyIcon size={11} />
                              <span>Copy</span>
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Hook Selector Pills */}
                      <div className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-950 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
                        {["Curiosity", "Mistake", "Direct Payoff"].map((label, hIdx) => (
                          <button
                            key={hIdx}
                            type="button"
                            onClick={() =>
                              setActiveHookIndex((prev) => ({
                                ...prev,
                                [idea.id]: hIdx,
                              }))
                            }
                            className={`py-1 text-[10px] font-medium rounded transition-all text-center ${
                              currentHookIndex === hIdx
                                ? "bg-indigo-600 text-white font-semibold shadow-xs"
                                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Active Hook Quote */}
                      <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-indigo-900 dark:text-indigo-200 italic leading-relaxed">
                        &ldquo;{activeHookText}&rdquo;
                      </div>
                    </div>

                    {/* 3-Beat Script Outline */}
                    <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-300">
                          3-Beat Script Framework
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(`script-${idea.id}`, fullScriptText)}
                          className="h-5 px-1.5 text-[10px] gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                        >
                          {isScriptCopied ? (
                            <>
                              <CheckIcon size={11} className="text-emerald-500 dark:text-emerald-400" />
                              <span className="text-emerald-700 dark:text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <CopyIcon size={11} />
                              <span>Copy Script</span>
                            </>
                          )}
                        </Button>
                      </div>

                      <div className="space-y-1.5 text-[11px] bg-zinc-50 dark:bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans">
                        <div>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400 mr-1.5">1. Hook:</span>
                          <span className="text-zinc-800 dark:text-zinc-200">{idea.script.hook}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400 mr-1.5">2. Lesson:</span>
                          <span className="text-zinc-700 dark:text-zinc-300">{idea.script.lesson}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400 mr-1.5">3. CTA:</span>
                          <span className="text-zinc-600 dark:text-zinc-400 italic">{idea.script.callToAction}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenDraftReview(idea)}
                      className="w-full h-8 text-xs gap-1.5"
                    >
                      <BookmarkIcon size={13} className="text-indigo-600 dark:text-indigo-400" />
                      <span>Save as Draft</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save Draft Review Modal */}
      {draftReview.isOpen && draftReview.idea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg p-5 sm:p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl space-y-4 text-zinc-900 dark:text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <BookmarkIcon size={16} className="text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white">
                  Save Concept to Drafts Vault
                </h3>
              </div>
              <Badge variant="purple" className="text-[10px]">
                {draftReview.format}
              </Badge>
            </div>

            <div className="space-y-3 text-xs">
              {/* Draft Title */}
              <div className="space-y-1">
                <label className="font-medium text-zinc-700 dark:text-zinc-300">Draft Title</label>
                <input
                  type="text"
                  value={draftReview.title}
                  onChange={(e) =>
                    setDraftReview((prev) => ({ ...prev, title: e.target.value.slice(0, 200) }))
                  }
                  maxLength={200}
                  className="w-full px-3 py-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>

              {/* Format selection */}
              <div className="space-y-1">
                <label className="font-medium text-zinc-700 dark:text-zinc-300">Format</label>
                <select
                  value={draftReview.format}
                  onChange={(e) =>
                    setDraftReview((prev) => ({
                      ...prev,
                      format: e.target.value as DraftFormat,
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="reel">Reel</option>
                  <option value="post">Post</option>
                  <option value="carousel">Carousel</option>
                  <option value="story">Story</option>
                </select>
              </div>

              {/* Caption / Script text */}
              <div className="space-y-1">
                <label className="font-medium text-zinc-700 dark:text-zinc-300">
                  Script Content & Selected Hook
                </label>
                <textarea
                  value={draftReview.caption}
                  onChange={(e) =>
                    setDraftReview((prev) => ({ ...prev, caption: e.target.value }))
                  }
                  rows={6}
                  className="w-full px-3 py-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Error / Success Feedback */}
            {draftReview.error && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 text-xs">
                {draftReview.error}
              </div>
            )}

            {draftReview.success && (
              <div className="p-2.5 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2Icon size={14} className="text-emerald-600 dark:text-emerald-400" />
                  {draftReview.success}
                </span>
                {onNavigateToDrafts && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftReview((prev) => ({ ...prev, isOpen: false }));
                      onNavigateToDrafts();
                    }}
                    className="underline font-semibold hover:text-emerald-900 dark:hover:text-white"
                  >
                    View Drafts
                  </button>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraftReview((prev) => ({
                    ...prev,
                    isOpen: false,
                    error: null,
                    success: null,
                  }))
                }
                className="h-8 text-xs"
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveDraft}
                isLoading={draftReview.isSaving}
                disabled={!draftReview.title.trim() || draftReview.isSaving}
                className="h-8 text-xs gap-1.5"
              >
                <CheckIcon size={13} />
                <span>Confirm Save</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
