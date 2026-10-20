"use client";

import React, { useState, useEffect, useId } from "react";
import {
  RefreshCwIcon,
  SparklesIcon,
  CopyIcon,
  CheckIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  BookmarkIcon,
  FileTextIcon,
  VideoIcon,
  LayersIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  CreatorPreferences,
  RepurposeMode,
  RewriteGoal,
  RepurposeTargetFormat,
  GeneratedRepurposeResult,
  ContentDraft,
  DraftFormat,
  ReelScriptItem,
  CarouselOutlineSlide,
  StoryFrameItem,
} from "../../app/lib/definitions";
import { repurposeContentAction } from "../../app/actions/ai-studio";
import { listDraftsAction, createDraftAction } from "../../app/actions/drafts";
import {
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
  normalizeLanguagePreset,
} from "../../app/lib/localization/standards";

export interface RepurposingStudioProps {
  creatorPreferences?: CreatorPreferences | null;
  onDraftSaved?: (draft: ContentDraft) => void;
  onNavigateToDrafts?: () => void;
}

interface DraftReviewModalState {
  isOpen: boolean;
  title: string;
  caption: string;
  format: DraftFormat;
  isSaving: boolean;
  error?: string | null;
  success?: string | null;
  metadata?: Record<string, unknown>;
}

export function RepurposingStudio({
  creatorPreferences,
  onDraftSaved,
  onNavigateToDrafts,
}: RepurposingStudioProps) {
  const formId = useId();

  // Source Content & Configuration
  const [sourceText, setSourceText] = useState("");
  const [mode, setMode] = useState<RepurposeMode>("rewrite");
  const [goal, setGoal] = useState<RewriteGoal>("improve");
  const [targetFormat, setTargetFormat] = useState<RepurposeTargetFormat>("reel");
  const [language, setLanguage] = useState<string>(
    () =>
      normalizeLanguagePreset(creatorPreferences?.languages?.[0]) ||
      CANONICAL_LANGUAGE_PRESETS[0].id
  );
  const [tone, setTone] = useState<string>(
    () => creatorPreferences?.brandVoice?.[0] || CANONICAL_TONE_OPTIONS[0]
  );

  // Draft picker state
  const [isDraftPickerOpen, setIsDraftPickerOpen] = useState(false);
  const [vaultDrafts, setVaultDrafts] = useState<ContentDraft[]>([]);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // Execution & Feedback states
  const [isGenerating, setIsGenerating] = useState(false);
  const [scriptWarning, setScriptWarning] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<{
    message: string;
    quotaDetails?: string;
    retryAfterMs?: number;
  } | null>(null);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  // Result card states (editable in-place)
  const [result, setResult] = useState<GeneratedRepurposeResult | null>(null);
  const [editableRewrittenText, setEditableRewrittenText] = useState("");
  const [editableHashtags, setEditableHashtags] = useState<string[]>([]);
  const [editableReelScript, setEditableReelScript] = useState<ReelScriptItem | null>(null);
  const [editableCarouselSlides, setEditableCarouselSlides] = useState<CarouselOutlineSlide[]>([]);
  const [activeCarouselSlideIndex, setActiveCarouselSlideIndex] = useState(0);
  const [editableStoryFrames, setEditableStoryFrames] = useState<StoryFrameItem[]>([]);
  const [activeMultiPackTab, setActiveMultiPackTab] = useState<"caption" | "reel" | "carousel" | "story">("caption");

  // Interaction feedback states
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Save as Draft Modal
  const [draftModal, setDraftModal] = useState<DraftReviewModalState>({
    isOpen: false,
    title: "",
    caption: "",
    format: "post",
    isSaving: false,
  });

  // Handle retry countdown timer
  useEffect(() => {
    if (!retryCountdown) return;
    const interval = setInterval(() => {
      setRetryCountdown((prev) => {
        if (!prev || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [retryCountdown]);

  // Load vault drafts when picker is opened
  const handleOpenDraftPicker = async () => {
    setIsDraftPickerOpen(true);
    if (vaultDrafts.length > 0) return;
    setIsLoadingDrafts(true);
    try {
      const response = await listDraftsAction({ limit: 15 });
      if (response.success && response.drafts) {
        setVaultDrafts(response.drafts);
      }
    } catch {
      // Graceful fallback
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  const handleSelectVaultDraft = (draft: ContentDraft) => {
    const text = draft.caption || draft.title || "";
    setSourceText(text);
    setSelectedDraftId(draft.id);
    if (draft.metadata && typeof draft.metadata === "object") {
      const meta = draft.metadata as Record<string, unknown>;
      if (typeof meta.language === "string" && meta.language) {
        setLanguage(normalizeLanguagePreset(meta.language));
      }
      if (typeof meta.tone === "string" && meta.tone) {
        setTone(meta.tone);
      }
    }
    setIsDraftPickerOpen(false);
  };

  // Sync state whenever generation result arrives
  const syncResultToEditor = (res: GeneratedRepurposeResult) => {
    setResult(res);
    setEditableRewrittenText(res.rewrittenText || "");
    setEditableHashtags(res.hashtags || []);

    if (res.reelScript) {
      setEditableReelScript({ ...res.reelScript });
    } else if (res.multiPack?.reelScript) {
      setEditableReelScript({ ...res.multiPack.reelScript });
    } else {
      setEditableReelScript(null);
    }

    if (res.carouselOutline?.slides) {
      setEditableCarouselSlides(res.carouselOutline.slides.map((s) => ({ ...s })));
      setActiveCarouselSlideIndex(0);
    } else if (res.multiPack?.carouselOutline?.slides) {
      setEditableCarouselSlides(res.multiPack.carouselOutline.slides.map((s) => ({ ...s })));
      setActiveCarouselSlideIndex(0);
    } else {
      setEditableCarouselSlides([]);
    }

    if (res.storySequence) {
      setEditableStoryFrames(res.storySequence.map((f) => ({ ...f })));
    } else if (res.multiPack?.storySequence) {
      setEditableStoryFrames(res.multiPack.storySequence.map((f) => ({ ...f })));
    } else {
      setEditableStoryFrames([]);
    }

    if (res.mode === "multipack") {
      setActiveMultiPackTab("caption");
    }
  };

  const handleRepurposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sourceText.trim().length < 10 || isGenerating) return;

    setIsGenerating(true);
    setGenerationError(null);
    setScriptWarning(null);

    try {
      const response = await repurposeContentAction({
        sourceText: sourceText.trim(),
        mode,
        goal: mode === "rewrite" ? goal : undefined,
        targetFormat: mode === "convert" ? targetFormat : undefined,
        tone: tone.trim() || undefined,
        language: language.trim() || undefined,
        sourceDraftId: selectedDraftId || undefined,
      });

      if (!response.success || !response.result) {
        setGenerationError({
          message: response.error || "Failed to repurpose content. Please try again.",
          quotaDetails: response.quotaDetails,
          retryAfterMs: response.retryAfterMs,
        });
        if (response.retryAfterMs) {
          setRetryCountdown(Math.ceil(response.retryAfterMs / 1000));
        }
      } else {
        setScriptWarning(response.scriptWarning || response.result.scriptWarning || null);
        syncResultToEditor(response.result);
      }
    } catch (err) {
      setGenerationError({
        message: err instanceof Error ? err.message : "Error connecting to AI service.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyText = (text: string, key = "default") => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  // Build draft preview and open review modal
  const openDraftReview = (formatToSave: DraftFormat) => {
    if (!result) return;

    let defaultTitle = "Repurposed Content";
    let formattedCaption = "";

    if (formatToSave === "post") {
      const body = result.mode === "multipack" ? result.multiPack?.feedCaption || "" : editableRewrittenText;
      const tags = result.mode === "multipack" ? result.multiPack?.hashtags || [] : editableHashtags;
      defaultTitle = body.split("\n")[0]?.replace(/^[#\s]+/, "").slice(0, 80) || "Polished Feed Caption";
      formattedCaption = `${body}\n\n${tags.join(" ")}`.trim();
    } else if (formatToSave === "reel") {
      const script = editableReelScript || result.multiPack?.reelScript;
      defaultTitle = script?.hook.slice(0, 80) || "Reel Script";
      formattedCaption = `[HOOK]\n${script?.hook || ""}\n\n[LESSON / BEATS]\n${script?.beats || ""}\n\n[CALL TO ACTION]\n${script?.callToAction || ""}${
        script?.visualNotes ? `\n\n[VISUAL NOTES]\n${script.visualNotes}` : ""
      }`;
    } else if (formatToSave === "carousel") {
      const slides = editableCarouselSlides.length > 0 ? editableCarouselSlides : result.multiPack?.carouselOutline?.slides || [];
      const title = result.carouselOutline?.title || result.multiPack?.carouselOutline?.title || slides[0]?.headline || "Carousel Outline";
      defaultTitle = title.slice(0, 80);
      const formattedSlides = slides
        .map((s) => `[SLIDE ${s.slideNumber}: ${s.slideType.toUpperCase()}]\n${s.headline}\n${s.bodyText}${s.visualSuggestion ? `\n(Visual: ${s.visualSuggestion})` : ""}`)
        .join("\n\n---\n\n");
      formattedCaption = `${formattedSlides}\n\n---\nRepurposed for Instagram Carousels`;
    } else if (formatToSave === "story") {
      const frames = editableStoryFrames.length > 0 ? editableStoryFrames : result.multiPack?.storySequence || [];
      defaultTitle = "3-Part Story Sequence";
      formattedCaption = frames
        .map((f) => `[FRAME ${f.frameNumber}: ${f.frameType.toUpperCase()}]\n${f.content}${f.stickerSuggestion ? `\n(Sticker Idea: ${f.stickerSuggestion})` : ""}`)
        .join("\n\n---\n\n");
    }

    setDraftModal({
      isOpen: true,
      title: defaultTitle,
      caption: formattedCaption,
      format: formatToSave,
      isSaving: false,
      error: null,
      success: null,
      metadata: {
        source: "repurposing_studio",
        mode: result.mode,
        goal: result.goal,
        targetFormat: result.targetFormat,
        originalLength: result.originalText.length,
        originalWordCount: result.originalWordCount,
        language: result.language || language,
        tone: result.tone || tone,
        scriptWarning: scriptWarning || result.scriptWarning || undefined,
        sourceDraftId: selectedDraftId || undefined,
      },
    });
  };

  const handleConfirmSaveDraft = async () => {
    if (!draftModal.title.trim() || draftModal.isSaving) return;

    setDraftModal((prev) => ({ ...prev, isSaving: true, error: null }));

    try {
      const response = await createDraftAction({
        title: draftModal.title.trim(),
        caption: draftModal.caption.trim() || null,
        format: draftModal.format,
        status: "draft",
        metadata: draftModal.metadata,
      });

      if (!response.success || !response.draft) {
        setDraftModal((prev) => ({
          ...prev,
          isSaving: false,
          error: response.error || "Failed to save draft to Drafts Vault.",
        }));
      } else {
        setDraftModal((prev) => ({
          ...prev,
          isSaving: false,
          success: "Draft saved successfully to Drafts Vault!",
        }));
        if (onDraftSaved) {
          onDraftSaved(response.draft);
        }
      }
    } catch (err) {
      setDraftModal((prev) => ({
        ...prev,
        isSaving: false,
        error: err instanceof Error ? err.message : "Error saving draft.",
      }));
    }
  };

  const isFormValid = sourceText.trim().length >= 10 && sourceText.trim().length <= 3000;

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="p-5 bg-gradient-to-r from-zinc-50 via-indigo-50/40 to-zinc-50 dark:from-zinc-900 dark:via-indigo-950/20 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCwIcon size={20} className="text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">
                Content Rewriter & Repurposing Studio
              </h2>
              <Badge variant="purple" className="text-[11px]">Milestone 7</Badge>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
              Transform existing captions, bullet notes, and ideas into high-retention Reel scripts, carousel outlines, Story sequences, or polished copy.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenDraftPicker}
              className="text-xs gap-1.5 border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
            >
              <BookmarkIcon size={14} className="text-amber-500 dark:text-amber-400" />
              <span>Load from Drafts Vault</span>
            </Button>
          </div>
        </div>

        {/* Draft Picker Drawer / Modal */}
        {isDraftPickerOpen && (
          <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Select a draft to populate source content:
              </span>
              <button
                type="button"
                onClick={() => setIsDraftPickerOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 p-1"
              >
                <XIcon size={14} />
              </button>
            </div>

            {isLoadingDrafts ? (
              <p className="text-xs text-zinc-500 italic py-2">Loading drafts from vault...</p>
            ) : vaultDrafts.length === 0 ? (
              <p className="text-xs text-zinc-500 italic py-2">No drafts found in your vault.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                {vaultDrafts.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleSelectVaultDraft(d)}
                    className="p-2.5 text-left rounded bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-800/80 hover:border-indigo-500/50 transition-all flex flex-col justify-between"
                  >
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 line-clamp-1">{d.title}</span>
                    <span className="text-[10px] text-zinc-500 line-clamp-1 mt-1 font-mono">
                      {d.caption ? `${d.caption.slice(0, 50)}...` : "(No caption)"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Input Form (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-5 shadow-sm">
          <form id={formId} onSubmit={handleRepurposeSubmit} className="space-y-5">
            {/* Source Content Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Source Content <span className="text-rose-500 dark:text-rose-400">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-mono ${sourceText.length > 3000 ? "text-rose-500 dark:text-rose-400" : "text-zinc-500"}`}>
                    {sourceText.length}/3000 chars
                  </span>
                  {sourceText && (
                    <button
                      type="button"
                      onClick={() => {
                        setSourceText("");
                        setSelectedDraftId(null);
                      }}
                      className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Paste an existing caption, rough notes, bullet points, or video concept to transform..."
                rows={6}
                className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-sans resize-y"
              />
            </div>

            {/* Mode Selector Tabs */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Repurpose Mode
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMode("rewrite")}
                  className={`py-1.5 text-xs font-medium rounded-md transition-all ${
                    mode === "rewrite"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  Rewrite & Polish
                </button>
                <button
                  type="button"
                  onClick={() => setMode("convert")}
                  className={`py-1.5 text-xs font-medium rounded-md transition-all ${
                    mode === "convert"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  Format Converter
                </button>
                <button
                  type="button"
                  onClick={() => setMode("multipack")}
                  className={`py-1.5 text-xs font-medium rounded-md transition-all ${
                    mode === "multipack"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  Multi-Pack
                </button>
              </div>
            </div>

            {/* Mode-Specific Options */}
            {mode === "rewrite" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Refinement Goal
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "improve" as const, label: "Improve & Polish", desc: "Clarity, hook & flow" },
                    { id: "shorten" as const, label: "Shorten & Condense", desc: "50-120 word punchy read" },
                    { id: "expand" as const, label: "Expand & Deepen", desc: "Detailed points & context" },
                    { id: "hooks" as const, label: "Hook Variations", desc: "3 A/B opening hooks" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setGoal(item.id)}
                      className={`p-2 text-left rounded-lg border text-xs transition-all ${
                        goal === item.id
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-500/80 text-indigo-950 dark:text-white"
                          : "bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      <div className="font-semibold">{item.label}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "convert" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Target Instagram Format
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "reel" as const, label: "Reel Script", icon: <VideoIcon size={14} /> },
                    { id: "carousel" as const, label: "5-Slide Deck", icon: <LayersIcon size={14} /> },
                    { id: "story" as const, label: "Story (3-Part)", icon: <SparklesIcon size={14} /> },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTargetFormat(item.id)}
                      className={`p-2.5 flex flex-col items-center justify-center gap-1.5 rounded-lg border text-xs transition-all ${
                        targetFormat === item.id
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-500/80 text-indigo-950 dark:text-white"
                          : "bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      <span className={targetFormat === item.id ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400 dark:text-zinc-500"}>
                        {item.icon}
                      </span>
                      <span className="font-semibold">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "multipack" && (
              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 rounded-lg text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <SparklesIcon size={14} className="text-indigo-600 dark:text-indigo-400" />
                  <span>All-in-One Multi-Repurposing Pack</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Generates a polished Feed Caption, a 3-beat Reel Script, a 5-Slide Carousel Outline, and a 3-Frame Story Sequence in a single operation.
                </p>
              </div>
            )}

            {/* Language & Tone Preferences */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800/80">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Language / Script</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 font-sans"
                >
                  {creatorPreferences?.languages?.length ? (
                    <optgroup label="Creator Preferred">
                      {creatorPreferences.languages.map((l, idx) => (
                        <option key={`cp-${idx}`} value={normalizeLanguagePreset(l)}>
                          {normalizeLanguagePreset(l)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="Standard Presets">
                    {CANONICAL_LANGUAGE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Tone / Brand Voice</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 font-sans"
                >
                  {creatorPreferences?.brandVoice?.length ? (
                    <optgroup label="Creator Brand Voice">
                      {creatorPreferences.brandVoice.map((v, i) => (
                        <option key={`cv-${i}`} value={v}>
                          {v}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
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

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={!isFormValid || isGenerating || Boolean(retryCountdown)}
              className="w-full py-2.5 font-semibold text-xs tracking-wide bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm disabled:opacity-50"
            >
              {isGenerating ? (
                <div className="flex items-center gap-2">
                  <RefreshCwIcon size={14} className="animate-spin" />
                  <span>Transforming Content...</span>
                </div>
              ) : retryCountdown ? (
                <span>Rate limited (retry in {retryCountdown}s)</span>
              ) : (
                <div className="flex items-center gap-2">
                  <SparklesIcon size={14} />
                  <span>Repurpose Content</span>
                </div>
              )}
            </Button>
          </form>
        </div>

        {/* Right Column: Output & In-Place Editor (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-4 min-h-[500px] shadow-sm">
          {/* Error Banner */}
          {generationError && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl space-y-2">
              <div className="flex items-start gap-2.5 text-rose-800 dark:text-rose-300">
                <AlertCircleIcon size={18} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold leading-relaxed">{generationError.message}</p>
                  {generationError.quotaDetails && (
                    <p className="text-[11px] text-rose-700 dark:text-rose-400/90 font-mono leading-relaxed">
                      {generationError.quotaDetails}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Script Consistency Advisory Warning (Non-blocking) */}
          {scriptWarning && (
            <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
              <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <span className="font-semibold block text-amber-900 dark:text-amber-300">Language / Script Advisory</span>
                <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{scriptWarning}</p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!result && !isGenerating && !generationError && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 flex items-center justify-center text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700/50">
                <RefreshCwIcon size={22} />
              </div>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-300">Awaiting Source Content</h3>
              <p className="text-xs text-zinc-500 max-w-sm">
                Paste an existing caption or pick a draft from your vault to rewrite it, improve its hook, or repurpose it into Reel scripts and carousels.
              </p>
            </div>
          )}

          {/* Loading State */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <RefreshCwIcon size={24} className="text-indigo-600 dark:text-indigo-400 animate-spin" />
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Analyzing & Repurposing Content...</p>
              <p className="text-[11px] text-zinc-500 max-w-xs">
                Preserving core facts and voice while generating structured formats.
              </p>
            </div>
          )}

          {/* Render Result Content */}
          {result && !isGenerating && (
            <div className="space-y-5">
              {/* Output Top Bar: Stats & Summary */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <Badge variant="purple" className="text-[11px] uppercase tracking-wider">
                    {result.mode}
                  </Badge>
                  {result.originalWordCount && (
                    <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">
                      Original: {result.originalWordCount} words
                    </span>
                  )}
                  {result.rewrittenWordCount && (
                    <span className="text-[11px] text-indigo-700 dark:text-indigo-400 font-mono">
                      → Rewritten: {result.rewrittenWordCount} words (
                      {result.rewrittenWordCount < result.originalWordCount
                        ? `-${Math.round(((result.originalWordCount - result.rewrittenWordCount) / result.originalWordCount) * 100)}%`
                        : `+${Math.round(((result.rewrittenWordCount - result.originalWordCount) / result.originalWordCount) * 100)}%`}
                      )
                    </span>
                  )}
                </div>

                <div className="text-[10px] text-zinc-500 font-mono">
                  Model: {result.model || "gemini-3.5-flash-lite"}
                </div>
              </div>

              {/* VIEW 1: REWRITE (IMPROVE / SHORTEN / EXPAND) */}
              {result.mode === "rewrite" && result.goal !== "hooks" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                        Rewritten Content (In-Place Editable)
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyText(editableRewrittenText, "rewrite")}
                        className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      >
                        {copiedKey === "rewrite" ? (
                          <>
                            <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="text-emerald-700 dark:text-emerald-300">Copied</span>
                          </>
                        ) : (
                          <>
                            <CopyIcon size={12} />
                            <span>Copy</span>
                          </>
                        )}
                      </Button>
                    </div>
                    <textarea
                      value={editableRewrittenText}
                      onChange={(e) => setEditableRewrittenText(e.target.value)}
                      rows={8}
                      className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-all font-sans leading-relaxed resize-y"
                    />
                  </div>

                  {/* Hashtags */}
                  {editableHashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {editableHashtags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-indigo-700 dark:text-indigo-400 font-mono"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Explanation Callout */}
                  {result.explanation && (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 rounded-lg text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-300">Transformation Summary: </span>
                      {result.explanation}
                    </div>
                  )}

                  {/* Save Draft Action */}
                  <div className="pt-2 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => openDraftReview("post")}
                      className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <BookmarkIcon size={14} />
                      <span>Save as Post Draft</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* VIEW 2: HOOK VARIATIONS */}
              {result.mode === "rewrite" && result.goal === "hooks" && (
                <div className="space-y-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                    Scroll-Stopping Hook Variations
                  </span>
                  <div className="space-y-2.5">
                    {(result.alternativeHooks || []).map((hook, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 hover:border-indigo-400 dark:hover:border-indigo-500/50 rounded-lg transition-all space-y-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 border border-indigo-200 dark:border-indigo-800/50">
                              {idx + 1}
                            </span>
                            <p className="text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 font-medium leading-relaxed">
                              &ldquo;{hook}&rdquo;
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyText(hook, `hook-${idx}`)}
                            className="h-7 text-xs gap-1 shrink-0 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                          >
                            {copiedKey === `hook-${idx}` ? (
                              <>
                                <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
                                <span className="text-emerald-700 dark:text-emerald-300">Copied</span>
                              </>
                            ) : (
                              <>
                                <CopyIcon size={12} />
                                <span>Copy</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {result.explanation && (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 rounded-lg text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-300">Hook Strategy: </span>
                      {result.explanation}
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 3: REEL SCRIPT (CONVERT) */}
              {result.mode === "convert" && result.targetFormat === "reel" && editableReelScript && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      3-Beat Short Video Script
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleCopyText(
                          `[HOOK]\n${editableReelScript.hook}\n\n[LESSON / BEATS]\n${editableReelScript.beats}\n\n[CTA]\n${editableReelScript.callToAction}`,
                          "reel-copy"
                        )
                      }
                      className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    >
                      {copiedKey === "reel-copy" ? (
                        <>
                          <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-300">Copied Script</span>
                        </>
                      ) : (
                        <>
                          <CopyIcon size={12} />
                          <span>Copy Script</span>
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        1. Hook (0-3s)
                      </label>
                      <input
                        type="text"
                        value={editableReelScript.hook}
                        onChange={(e) =>
                          setEditableReelScript({ ...editableReelScript, hook: e.target.value })
                        }
                        className="w-full bg-transparent text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:outline-none"
                      />
                    </div>

                    <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        2. Core Lesson / Value Beats
                      </label>
                      <textarea
                        value={editableReelScript.beats}
                        onChange={(e) =>
                          setEditableReelScript({ ...editableReelScript, beats: e.target.value })
                        }
                        rows={4}
                        className="w-full bg-transparent text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed focus:outline-none resize-y"
                      />
                    </div>

                    <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        3. Call to Action
                      </label>
                      <input
                        type="text"
                        value={editableReelScript.callToAction}
                        onChange={(e) =>
                          setEditableReelScript({ ...editableReelScript, callToAction: e.target.value })
                        }
                        className="w-full bg-transparent text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:outline-none"
                      />
                    </div>

                    {editableReelScript.visualNotes && (
                      <div className="p-3 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/60 rounded-lg text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-300">Camera / Visual Directions: </span>
                        {editableReelScript.visualNotes}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => openDraftReview("reel")}
                      className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <BookmarkIcon size={14} />
                      <span>Save as Reel Draft</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* VIEW 4: CAROUSEL OUTLINE (CONVERT) */}
              {result.mode === "convert" && result.targetFormat === "carousel" && editableCarouselSlides.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      5-Slide Carousel Deck
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const allText = editableCarouselSlides
                          .map((s) => `Slide ${s.slideNumber}: ${s.headline}\n${s.bodyText}`)
                          .join("\n\n");
                        handleCopyText(allText, "carousel-copy");
                      }}
                      className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    >
                      {copiedKey === "carousel-copy" ? (
                        <>
                          <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-300">Copied Deck</span>
                        </>
                      ) : (
                        <>
                          <CopyIcon size={12} />
                          <span>Copy Deck</span>
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Slide Selector Pills */}
                  <div className="flex items-center gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto">
                    {editableCarouselSlides.map((slide, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveCarouselSlideIndex(idx)}
                        className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap transition-all ${
                          activeCarouselSlideIndex === idx
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                        }`}
                      >
                        {idx === 0 ? "1 · Cover" : idx === 4 ? "5 · CTA" : `Slide ${idx + 1}`}
                      </button>
                    ))}
                  </div>

                  {/* Active Slide Card */}
                  {editableCarouselSlides[activeCarouselSlideIndex] && (
                    <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="purple" className="text-[10px] uppercase">
                          {editableCarouselSlides[activeCarouselSlideIndex].slideType}
                        </Badge>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={activeCarouselSlideIndex === 0}
                            onClick={() => setActiveCarouselSlideIndex((prev) => Math.max(0, prev - 1))}
                            className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30"
                          >
                            <ChevronLeftIcon size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={activeCarouselSlideIndex === editableCarouselSlides.length - 1}
                            onClick={() => setActiveCarouselSlideIndex((prev) => Math.min(editableCarouselSlides.length - 1, prev + 1))}
                            className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30"
                          >
                            <ChevronRightIcon size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editableCarouselSlides[activeCarouselSlideIndex].headline}
                          onChange={(e) => {
                            const updated = [...editableCarouselSlides];
                            updated[activeCarouselSlideIndex].headline = e.target.value;
                            setEditableCarouselSlides(updated);
                          }}
                          className="w-full bg-white dark:bg-zinc-900 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded text-sm font-bold text-zinc-900 dark:text-white focus:outline-none"
                        />
                        <textarea
                          value={editableCarouselSlides[activeCarouselSlideIndex].bodyText}
                          onChange={(e) => {
                            const updated = [...editableCarouselSlides];
                            updated[activeCarouselSlideIndex].bodyText = e.target.value;
                            setEditableCarouselSlides(updated);
                          }}
                          rows={3}
                          className="w-full bg-white dark:bg-zinc-900 px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed focus:outline-none resize-y"
                        />
                        {editableCarouselSlides[activeCarouselSlideIndex].visualSuggestion && (
                          <p className="text-[11px] text-zinc-500 italic">
                            Visual: {editableCarouselSlides[activeCarouselSlideIndex].visualSuggestion}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => openDraftReview("carousel")}
                      className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <BookmarkIcon size={14} />
                      <span>Save as Carousel Draft</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* VIEW 5: STORY SEQUENCE (CONVERT) */}
              {result.mode === "convert" && result.targetFormat === "story" && editableStoryFrames.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      3-Frame Story Sequence
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const allFrames = editableStoryFrames
                          .map((f) => `Frame ${f.frameNumber}: ${f.content}${f.stickerSuggestion ? ` (Sticker: ${f.stickerSuggestion})` : ""}`)
                          .join("\n\n");
                        handleCopyText(allFrames, "story-copy");
                      }}
                      className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    >
                      {copiedKey === "story-copy" ? (
                        <>
                          <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-300">Copied Story</span>
                        </>
                      ) : (
                        <>
                          <CopyIcon size={12} />
                          <span>Copy Story</span>
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {editableStoryFrames.map((frame, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2.5 flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                              Frame {frame.frameNumber}
                            </span>
                            <Badge variant="neutral" className="text-[9px] uppercase">
                              {frame.frameType}
                            </Badge>
                          </div>
                          <textarea
                            value={frame.content}
                            onChange={(e) => {
                              const updated = [...editableStoryFrames];
                              updated[idx].content = e.target.value;
                              setEditableStoryFrames(updated);
                            }}
                            rows={4}
                            className="w-full bg-white dark:bg-zinc-900 p-2 border border-zinc-200 dark:border-zinc-800 rounded text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed focus:outline-none resize-none"
                          />
                        </div>

                        {frame.stickerSuggestion && (
                          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800/80 text-[10px] text-amber-600 dark:text-amber-300 font-mono">
                            Sticker: {frame.stickerSuggestion}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => openDraftReview("story")}
                      className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <BookmarkIcon size={14} />
                      <span>Save as Story Draft</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* VIEW 6: MULTIPACK (ALL FORMATS) */}
              {result.mode === "multipack" && result.multiPack && (
                <div className="space-y-4">
                  {/* Multipack Format Sub-Tabs */}
                  <div className="flex items-center gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setActiveMultiPackTab("caption")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        activeMultiPackTab === "caption"
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      Feed Caption
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMultiPackTab("reel")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        activeMultiPackTab === "reel"
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      Reel Script
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMultiPackTab("carousel")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        activeMultiPackTab === "carousel"
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      Carousel Deck
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMultiPackTab("story")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        activeMultiPackTab === "story"
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      Story Sequence
                    </button>
                  </div>

                  {/* Active Sub-Tab View */}
                  {activeMultiPackTab === "caption" && (
                    <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Feed Caption & Hashtags</span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleCopyText(
                                `${result.multiPack?.feedCaption || ""}\n\n${(result.multiPack?.hashtags || []).join(" ")}`,
                                "mp-caption"
                              )
                            }
                            className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                          >
                            {copiedKey === "mp-caption" ? <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon size={12} />}
                            <span>Copy</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openDraftReview("post")}
                            className="h-7 text-xs gap-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            <BookmarkIcon size={12} />
                            <span>Save as Post</span>
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-800 dark:text-zinc-200 whitespace-pre-line leading-relaxed font-sans">
                        {result.multiPack.feedCaption}
                      </p>
                      <div className="flex flex-wrap gap-1 pt-2">
                        {result.multiPack.hashtags.map((h, i) => (
                          <span key={i} className="text-[10px] font-mono text-indigo-700 dark:text-indigo-400 bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded">
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeMultiPackTab === "reel" && (
                    <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Reel Script Breakdown</span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleCopyText(
                                `[HOOK]\n${result.multiPack?.reelScript.hook}\n\n[BEATS]\n${result.multiPack?.reelScript.beats}\n\n[CTA]\n${result.multiPack?.reelScript.callToAction}`,
                                "mp-reel"
                              )
                            }
                            className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                          >
                            {copiedKey === "mp-reel" ? <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon size={12} />}
                            <span>Copy</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openDraftReview("reel")}
                            className="h-7 text-xs gap-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            <BookmarkIcon size={12} />
                            <span>Save as Reel</span>
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="p-2.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800/80">
                          <span className="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400 block mb-0.5">Hook:</span>
                          <span className="text-zinc-900 dark:text-zinc-200">{result.multiPack.reelScript.hook}</span>
                        </div>
                        <div className="p-2.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800/80">
                          <span className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400 block mb-0.5">Beats:</span>
                          <span className="text-zinc-800 dark:text-zinc-300 whitespace-pre-line">{result.multiPack.reelScript.beats}</span>
                        </div>
                        <div className="p-2.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800/80">
                          <span className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400 block mb-0.5">CTA:</span>
                          <span className="text-zinc-900 dark:text-zinc-200">{result.multiPack.reelScript.callToAction}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeMultiPackTab === "carousel" && (
                    <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">
                          {result.multiPack.carouselOutline.title}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const deck = result.multiPack?.carouselOutline.slides
                                .map((s) => `Slide ${s.slideNumber}: ${s.headline}\n${s.bodyText}`)
                                .join("\n\n");
                              handleCopyText(deck || "", "mp-deck");
                            }}
                            className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                          >
                            {copiedKey === "mp-deck" ? <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon size={12} />}
                            <span>Copy</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openDraftReview("carousel")}
                            className="h-7 text-xs gap-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            <BookmarkIcon size={12} />
                            <span>Save as Carousel</span>
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {result.multiPack.carouselOutline.slides.map((s, idx) => (
                          <div key={idx} className="p-2.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800/80 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-zinc-900 dark:text-zinc-200">
                                {s.slideNumber}. {s.headline}
                              </span>
                              <Badge variant="neutral" className="text-[9px] uppercase">
                                {s.slideType}
                              </Badge>
                            </div>
                            <p className="text-zinc-600 dark:text-zinc-400 text-[11px]">{s.bodyText}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeMultiPackTab === "story" && (
                    <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">3-Frame Story Sequence</span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const story = result.multiPack?.storySequence
                                .map((f) => `Frame ${f.frameNumber}: ${f.content}`)
                                .join("\n\n");
                              handleCopyText(story || "", "mp-story");
                            }}
                            className="h-7 text-xs gap-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                          >
                            {copiedKey === "mp-story" ? <CheckIcon size={12} className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon size={12} />}
                            <span>Copy</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openDraftReview("story")}
                            className="h-7 text-xs gap-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            <BookmarkIcon size={12} />
                            <span>Save as Story</span>
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {result.multiPack.storySequence.map((f, idx) => (
                          <div key={idx} className="p-3 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 text-xs space-y-1.5">
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">Frame {f.frameNumber}</span>
                            <p className="text-zinc-800 dark:text-zinc-300 text-[11px] leading-relaxed">{f.content}</p>
                            {f.stickerSuggestion && (
                              <p className="text-[10px] text-amber-600 dark:text-amber-300 font-mono">Sticker: {f.stickerSuggestion}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Review & Save as Draft Modal */}
      {draftModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 w-full max-w-lg space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
              <div className="flex items-center gap-2">
                <BookmarkIcon size={18} className="text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Review & Save as Draft</h3>
              </div>
              <button
                type="button"
                onClick={() => setDraftModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-1"
              >
                <XIcon size={16} />
              </button>
            </div>

            {draftModal.error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
                <AlertCircleIcon size={14} className="shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{draftModal.error}</span>
              </div>
            )}

            {draftModal.success ? (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-lg text-center space-y-3">
                <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2Icon size={18} />
                  <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">{draftModal.success}</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  {onNavigateToDrafts && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setDraftModal((prev) => ({ ...prev, isOpen: false }));
                        onNavigateToDrafts();
                      }}
                      className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      View in Drafts Vault
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraftModal((prev) => ({ ...prev, isOpen: false }))}
                    className="text-xs border-zinc-300 dark:border-zinc-700"
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Draft Title</label>
                  <input
                    type="text"
                    value={draftModal.title}
                    onChange={(e) => setDraftModal({ ...draftModal, title: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Format</label>
                    <Badge variant="purple" className="text-[10px] uppercase">
                      {draftModal.format}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Content Preview</label>
                  <textarea
                    value={draftModal.caption}
                    onChange={(e) => setDraftModal({ ...draftModal, caption: e.target.value })}
                    rows={6}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none resize-y font-mono leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800/80">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraftModal((prev) => ({ ...prev, isOpen: false }))}
                    className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={draftModal.isSaving || !draftModal.title.trim()}
                    onClick={handleConfirmSaveDraft}
                    className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    {draftModal.isSaving ? "Saving to Vault..." : "Save Draft"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
