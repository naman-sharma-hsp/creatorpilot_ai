"use client";

import React, { useState, useId } from "react";
import {
  LayersIcon,
  SparklesIcon,
  CopyIcon,
  CheckIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  RefreshCwIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  CreatorPreferences,
  CarouselSlideItem,
  GeneratedCarouselResult,
  ContentDraft,
  DraftFormat,
} from "../../app/lib/definitions";
import { generateCarouselAction } from "../../app/actions/ai-studio";
import { createDraftAction } from "../../app/actions/drafts";
import {
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
  normalizeLanguagePreset,
} from "../../app/lib/localization/standards";

export interface CarouselGeneratorProps {
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
}

export function CarouselGenerator({
  creatorPreferences,
  onDraftSaved,
  onNavigateToDrafts,
}: CarouselGeneratorProps) {
  const formId = useId();

  // Generator inputs
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState<5 | 7 | 10>(5);
  const [selectedPillar, setSelectedPillar] = useState<string>("");
  const [customPillar, setCustomPillar] = useState("");
  const [tone, setTone] = useState<string>(() => {
    return creatorPreferences?.brandVoice?.[0] || CANONICAL_TONE_OPTIONS[0];
  });
  const [goal, setGoal] = useState<string>("");
  const [language, setLanguage] = useState<string>(() => {
    return (
      normalizeLanguagePreset(creatorPreferences?.languages?.[0]) ||
      CANONICAL_LANGUAGE_PRESETS[0].id
    );
  });

  // State management
  const [isGenerating, setIsGenerating] = useState(false);
  const [carouselDeck, setCarouselDeck] = useState<GeneratedCarouselResult | null>(null);
  const [scriptWarning, setScriptWarning] = useState<string | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<{
    message: string;
    quotaDetails?: string;
    retryAfterMs?: number;
  } | null>(null);

  // Editable slide deck state (persists user inline modifications)
  const [editedSlides, setEditedSlides] = useState<CarouselSlideItem[]>([]);
  const [editedCompanionCaption, setEditedCompanionCaption] = useState("");
  const [editedHashtags, setEditedHashtags] = useState<string[]>([]);
  const [deckTitle, setDeckTitle] = useState("");

  // Draft review modal state
  const [draftReview, setDraftReview] = useState<DraftReviewModalState>({
    isOpen: false,
    title: "",
    caption: "",
    format: "carousel",
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

  // Generate carousel deck handler
  const handleGenerateDeck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!topic.trim() || isGenerating) return;

    setIsGenerating(true);
    setGenerationError(null);
    setScriptWarning(null);

    try {
      const response = await generateCarouselAction({
        topic: topic.trim(),
        slideCount,
        pillar: effectivePillar || undefined,
        tone: tone.trim() || undefined,
        goal: goal.trim() || undefined,
        language,
      });

      if (!response.success || !response.carousel) {
        setGenerationError({
          message: response.error || "Unable to generate carousel deck. Please try again.",
          quotaDetails: response.quotaDetails,
          retryAfterMs: response.retryAfterMs,
        });
        return;
      }

      setCarouselDeck(response.carousel);
      setScriptWarning(response.scriptWarning || response.carousel.scriptWarning || null);
      setDeckTitle(response.carousel.title);
      setEditedSlides(response.carousel.slides);
      setEditedCompanionCaption(response.carousel.companionCaption);
      setEditedHashtags(response.carousel.hashtags);
      setActiveSlideIndex(0);
    } catch (err) {
      setGenerationError({
        message:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while communicating with the Carousel Studio service.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Inline edit handlers for the active slide
  const handleSlideChange = (
    field: "headline" | "bodyText" | "visualSuggestion",
    value: string
  ) => {
    setEditedSlides((prev) => {
      const updated = [...prev];
      if (updated[activeSlideIndex]) {
        updated[activeSlideIndex] = {
          ...updated[activeSlideIndex],
          [field]: value,
        };
      }
      return updated;
    });
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

  // Build full formatted text of the current edited deck
  const buildFullCarouselText = (): string => {
    const slideBlocks = editedSlides.map((slide) => {
      const typeLabel =
        slide.slideType === "cover"
          ? "COVER HOOK"
          : slide.slideType === "cta"
          ? "OUTRO / CTA"
          : "VALUE";
      return `--- SLIDE ${slide.slideNumber}: [${typeLabel}] ---\nHEADLINE: ${slide.headline}\nCONTENT:\n${slide.bodyText}\nVISUAL CUE: ${slide.visualSuggestion}`;
    });

    const hashtagsFormatted = editedHashtags.length > 0 ? `\n\n${editedHashtags.join(" ")}` : "";

    return `${slideBlocks.join("\n\n")}\n\n====================\nFEED CAPTION:\n${editedCompanionCaption}${hashtagsFormatted}`;
  };

  // Open Save as Draft modal
  const handleOpenDraftReview = () => {
    const readableDraftContent = buildFullCarouselText();

    setDraftReview({
      isOpen: true,
      title: deckTitle || `${topic.slice(0, 80)} (${slideCount} Slides)`,
      caption: readableDraftContent,
      format: "carousel",
      isSaving: false,
      error: null,
      success: null,
    });
  };

  // Commit carousel draft to Supabase
  const handleSaveDraft = async () => {
    if (!draftReview.title.trim()) return;

    setDraftReview((prev) => ({ ...prev, isSaving: true, error: null, success: null }));

    try {
      const response = await createDraftAction({
        title: draftReview.title.trim(),
        caption: draftReview.caption.trim(),
        format: "carousel",
        status: "draft",
        metadata: {
          source: "carousel_studio",
          model: "gemini-3.5-flash-lite",
          slideCount: editedSlides.length,
          slides: editedSlides,
          companionCaption: editedCompanionCaption,
          hashtags: editedHashtags,
          topic: topic.trim(),
          pillar: effectivePillar || undefined,
          tone: tone || undefined,
          language,
          scriptWarning: scriptWarning || undefined,
          savedAt: new Date().toISOString(),
        },
      });

      if (!response.success || !response.draft) {
        setDraftReview((prev) => ({
          ...prev,
          isSaving: false,
          error: response.error || "Failed to save carousel draft. Please try again.",
        }));
        return;
      }

      setDraftReview((prev) => ({
        ...prev,
        isSaving: false,
        success: "Carousel deck saved to your Drafts Vault!",
      }));

      if (onDraftSaved) {
        onDraftSaved(response.draft);
      }
    } catch (err) {
      setDraftReview((prev) => ({
        ...prev,
        isSaving: false,
        error: err instanceof Error ? err.message : "Unable to save carousel draft.",
      }));
    }
  };

  const currentSlide = editedSlides[activeSlideIndex];

  return (
    <div className="space-y-6">
      {/* Configuration & Form Card */}
      <div className="p-4 sm:p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white">
                Carousel Studio
              </h2>
              <Badge variant="purple" className="text-[10px]">
                gemini-3.5-flash-lite
              </Badge>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              Design high-retention 5, 7, or 10-slide Instagram carousel decks with visual cues and companion captions.
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

        <form onSubmit={handleGenerateDeck} className="space-y-4">
          {/* Topic / Brief Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor={`${formId}-topic`}
                className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Carousel Topic or Core Angle <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <span className="text-[10px] text-zinc-500">{topic.length}/500</span>
            </div>
            <textarea
              id={`${formId}-topic`}
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="e.g. 5 costly Next.js performance mistakes and how to fix them with React 19"
              className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3.5 py-2 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-none font-sans"
            />
          </div>

          {/* Slide Count, Pillar, Tone & Language Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Slide Count Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Number of Slides
              </label>
              <div className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-950 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
                {[5, 7, 10].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setSlideCount(count as 5 | 7 | 10)}
                    className={`py-1.5 text-xs font-medium rounded transition-all text-center ${
                      slideCount === count
                        ? "bg-indigo-600 text-white font-semibold shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }`}
                  >
                    {count} Slides
                  </button>
                ))}
              </div>
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
                  className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                  placeholder="e.g. Architecture, Tutorials, Case Studies"
                  className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              )}
            </div>

            {/* Tone / Brand Voice */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Tone / Brand Voice
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                  {CANONICAL_TONE_OPTIONS.map((t, i) => (
                    <option key={`st-${i}`} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Language / Script */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Language / Script
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
              />
            </div>
          )}

          {/* Submit Trigger */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-zinc-500">
              Strict ₹0 Budget · Generates {slideCount} structured slides + companion caption
            </span>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isGenerating}
              disabled={!topic.trim() || isGenerating}
              className="w-full sm:w-auto h-9 px-5 gap-2"
            >
              <LayersIcon size={15} />
              <span>{carouselDeck ? "Regenerate Carousel" : `Generate ${slideCount}-Slide Deck`}</span>
            </Button>
          </div>
        </form>
      </div>

      {/* Error Alert Box */}
      {generationError && (
        <div className="p-3.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
          <AlertCircleIcon size={16} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <span className="font-semibold block">Carousel Generation Feedback</span>
            <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{generationError.message}</p>
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
            <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{scriptWarning}</p>
          </div>
        </div>
      )}

      {/* Interactive Carousel Preview & Editor */}
      {carouselDeck && editedSlides.length > 0 && currentSlide && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Deck Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
                {deckTitle || "Carousel Deck"}
              </span>
              <Badge variant="info" className="text-[10px]">
                {editedSlides.length} Slides
              </Badge>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy("complete-deck", buildFullCarouselText())}
                className="h-8 text-xs gap-1.5"
              >
                {copiedId === "complete-deck" ? (
                  <>
                    <CheckIcon size={13} className="text-emerald-500 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400">Deck Copied!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={13} />
                    <span>Copy Complete Deck</span>
                  </>
                )}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleOpenDraftReview}
                className="h-8 text-xs gap-1.5 text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white"
              >
                <BookmarkIcon size={13} className="text-indigo-600 dark:text-indigo-400" />
                <span>Save Carousel as Draft</span>
              </Button>
            </div>
          </div>

          {/* Slide Deck Card Container */}
          <div className="p-5 sm:p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-5">
            {/* Slide Navigation Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 pb-3">
              {/* Slide Number Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-[70%]">
                {editedSlides.map((slide, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveSlideIndex(idx)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all shrink-0 ${
                      activeSlideIndex === idx
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    {slide.slideType === "cover"
                      ? "1 · Cover"
                      : slide.slideType === "cta"
                      ? `${slide.slideNumber} · CTA`
                      : `${slide.slideNumber}`}
                  </button>
                ))}
              </div>

              {/* Prev / Next Buttons */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={activeSlideIndex === 0}
                  onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                  className="h-7 w-7 p-0"
                  title="Previous slide"
                >
                  <ChevronLeftIcon size={15} />
                </Button>
                <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 px-1">
                  {activeSlideIndex + 1}/{editedSlides.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={activeSlideIndex === editedSlides.length - 1}
                  onClick={() =>
                    setActiveSlideIndex((prev) => Math.min(editedSlides.length - 1, prev + 1))
                  }
                  className="h-7 w-7 p-0"
                  title="Next slide"
                >
                  <ChevronRightIcon size={15} />
                </Button>
              </div>
            </div>

            {/* Active Slide Visual Card Mockup & Editor */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Column: Visual Mobile Slide Mockup Preview */}
              <div className="lg:col-span-5 flex flex-col items-center">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Mobile Preview (Slide {currentSlide.slideNumber})
                </span>
                <div className="w-full max-w-[320px] aspect-4/5 rounded-2xl bg-gradient-to-b from-zinc-950 to-zinc-900 border-2 border-zinc-700/80 p-5 flex flex-col justify-between shadow-2xl relative">
                  {/* Top Bar on slide */}
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 border-b border-zinc-800/80 pb-2">
                    <span className="font-semibold text-indigo-400">
                      {currentSlide.slideType === "cover"
                        ? "HOOK CARD"
                        : currentSlide.slideType === "cta"
                        ? "FINAL CTA"
                        : `POINT 0${currentSlide.slideNumber - 1}`}
                    </span>
                    <span className="font-mono text-[10px]">
                      {currentSlide.slideNumber}/{editedSlides.length}
                    </span>
                  </div>

                  {/* Card Center: Headline & Body */}
                  <div className="my-auto space-y-3 py-3">
                    <h3 className="text-base sm:text-lg font-bold text-white leading-snug break-words">
                      {currentSlide.headline}
                    </h3>
                    <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                      {currentSlide.bodyText}
                    </p>
                  </div>

                  {/* Card Footer: Visual Cue Badge */}
                  <div className="pt-2 border-t border-zinc-800/80 text-[10px] text-zinc-400 italic flex items-center justify-between">
                    <span className="truncate max-w-[200px]">
                      {currentSlide.visualSuggestion}
                    </span>
                    <span className="text-zinc-600 font-mono">swipe &gt;</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Inline Slide Editor Fields */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      Edit Slide {currentSlide.slideNumber}
                    </span>
                    <Badge
                      variant={
                        currentSlide.slideType === "cover"
                          ? "purple"
                          : currentSlide.slideType === "cta"
                          ? "warning"
                          : "info"
                      }
                      className="text-[10px] uppercase font-bold"
                    >
                      {currentSlide.slideType}
                    </Badge>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        `slide-${currentSlide.slideNumber}`,
                        `[Slide ${currentSlide.slideNumber}: ${currentSlide.slideType.toUpperCase()}]\nHeadline: ${
                          currentSlide.headline
                        }\nBody: ${currentSlide.bodyText}\nVisual Suggestion: ${currentSlide.visualSuggestion}`
                      )
                    }
                    className="h-6 px-2 text-[10px] gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  >
                    {copiedId === `slide-${currentSlide.slideNumber}` ? (
                      <>
                        <CheckIcon size={11} className="text-emerald-500 dark:text-emerald-400" />
                        <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon size={11} />
                        <span>Copy Slide</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* Headline input */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Slide Headline Hook
                  </label>
                  <input
                    type="text"
                    value={currentSlide.headline}
                    onChange={(e) => handleSlideChange("headline", e.target.value)}
                    maxLength={200}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                </div>

                {/* Body Text input */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Slide Content & Story Beat
                  </label>
                  <textarea
                    value={currentSlide.bodyText}
                    onChange={(e) => handleSlideChange("bodyText", e.target.value)}
                    rows={4}
                    maxLength={600}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                </div>

                {/* Visual Layout Suggestion */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Visual Layout & Design Cue
                  </label>
                  <input
                    type="text"
                    value={currentSlide.visualSuggestion}
                    onChange={(e) => handleSlideChange("visualSuggestion", e.target.value)}
                    maxLength={300}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans italic"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Companion Feed Caption & Hashtags Card */}
          <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <FileTextIcon size={15} className="text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Companion Feed Caption & Hashtags
                </h4>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleCopy(
                    "caption-hashtags",
                    `${editedCompanionCaption}\n\n${editedHashtags.join(" ")}`
                  )
                }
                className="h-6 px-2 text-[10px] gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              >
                {copiedId === "caption-hashtags" ? (
                  <>
                    <CheckIcon size={11} className="text-emerald-500 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={11} />
                    <span>Copy Caption</span>
                  </>
                )}
              </Button>
            </div>

            <textarea
              value={editedCompanionCaption}
              onChange={(e) => setEditedCompanionCaption(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            />

            {/* Hashtag chips */}
            {editedHashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {editedHashtags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-indigo-700 dark:text-indigo-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save as Draft Review Modal */}
      {draftReview.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg p-5 sm:p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <BookmarkIcon size={16} className="text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white">
                  Save Carousel Deck to Drafts Vault
                </h3>
              </div>
              <Badge variant="info" className="text-[10px]">
                {editedSlides.length} Slides
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
                  className="w-full px-3 py-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                />
              </div>

              {/* Full Readable Content Preview */}
              <div className="space-y-1">
                <label className="font-medium text-zinc-700 dark:text-zinc-300">
                  Readable Slide Content & Companion Caption
                </label>
                <textarea
                  value={draftReview.caption}
                  onChange={(e) =>
                    setDraftReview((prev) => ({ ...prev, caption: e.target.value }))
                  }
                  rows={8}
                  className="w-full px-3 py-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-zinc-500">
                  The complete structured slide list is preserved in draft metadata for future editing.
                </p>
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

            {/* Modal Actions */}
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
