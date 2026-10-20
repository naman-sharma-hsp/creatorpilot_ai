"use client";

import React, { useState, useTransition, useId } from "react";
import {
  SparklesIcon,
  CopyIcon,
  CheckIcon,
  AlertCircleIcon,
  InfoIcon,
  BookmarkIcon,
  InstagramIcon,
  VideoIcon,
  ImageIcon,
  CheckCircle2Icon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  CreatorPreferences,
  GeneratedCaptionResult,
  ContentDraft,
  DraftFormat,
} from "../../app/lib/definitions";
import { generateCaptionAction } from "../../app/actions/ai-studio";
import { createDraftAction } from "../../app/actions/drafts";
import {
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
  normalizeLanguagePreset,
} from "../../app/lib/localization/standards";

export interface CaptionGeneratorProps {
  creatorPreferences?: CreatorPreferences | null;
  isInstagramConnected?: boolean;
  username?: string | null;
  onDraftSaved?: (draft: ContentDraft) => void;
}

export function CaptionGenerator({
  creatorPreferences,
  isInstagramConnected = false,
  username = null,
  onDraftSaved,
}: CaptionGeneratorProps) {
  const formId = useId();

  // Generator inputs
  const [format, setFormat] = useState<"post" | "reel">("post");
  const [topic, setTopic] = useState("");
  const [callToAction, setCallToAction] = useState("");
  const [language, setLanguage] = useState<string>(() => {
    return normalizeLanguagePreset(creatorPreferences?.languages?.[0]) || "English";
  });
  const [customLanguage, setCustomLanguage] = useState("");
  const [tone, setTone] = useState<string>(() => {
    return creatorPreferences?.brandVoice?.[0] || CANONICAL_TONE_OPTIONS[0];
  });
  const [customTone, setCustomTone] = useState("");

  // UI & Feedback states
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [generationError, setGenerationError] = useState<{
    message: string;
    quotaDetails?: string;
    retryAfterMs?: number;
  } | null>(null);
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);
  const [saveDraftSuccess, setSaveDraftSuccess] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Result card states (editable by creator)
  const [result, setResult] = useState<GeneratedCaptionResult | null>(null);
  const [editableCaption, setEditableCaption] = useState("");
  const [editableHashtags, setEditableHashtags] = useState<string[]>([]);
  const [editableHashtagsRaw, setEditableHashtagsRaw] = useState("");
  const [draftTitle, setDraftTitle] = useState("");

  // Determine effective language and tone
  const activeLanguage = language === "custom" ? customLanguage.trim() || "English" : language;
  const activeTone = tone === "custom" ? customTone.trim() || "Authentic" : tone;

  const hasConfirmedIdentity = Boolean(
    creatorPreferences?.isConfirmed && creatorPreferences?.niche
  );

  // Character counters
  const topicLength = topic.length;
  const maxTopicLength = 1000;
  const isTopicValid = topicLength >= 3 && topicLength <= maxTopicLength;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTopicValid || isGenerating) return;

    setIsGenerating(true);
    setGenerationError(null);
    setSaveDraftSuccess(null);
    setSaveDraftError(null);

    try {
      const response = await generateCaptionAction({
        format,
        topic: topic.trim(),
        callToAction: callToAction.trim() || undefined,
        language: activeLanguage,
        tone: activeTone,
      });

      if (!response.success || !response.data) {
        setGenerationError({
          message:
            response.error || "Unable to generate caption. Please verify your input and try again.",
          quotaDetails: response.quotaDetails,
          retryAfterMs: response.retryAfterMs,
        });
        return;
      }

      setResult(response.data);
      setEditableCaption(response.data.caption);
      setEditableHashtags(response.data.hashtags || []);
      setEditableHashtagsRaw(response.data.hashtags?.join(" ") || "");

      // Auto-suggest draft title from the first sentence or brief
      const suggestedTitle = topic.trim().slice(0, 60);
      setDraftTitle(suggestedTitle || `${format === "reel" ? "Reel" : "Post"} Concept`);
    } catch (err) {
      setGenerationError({
        message: err instanceof Error ? err.message : "Unexpected connection error. Please try again.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCaption = async () => {
    if (!editableCaption) return;

    const fullText = editableHashtagsRaw.trim()
      ? `${editableCaption.trim()}\n\n${editableHashtagsRaw.trim()}`
      : editableCaption.trim();

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = fullText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      // Fallback
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    }
  };

  const handleSaveToDrafts = async () => {
    if (!editableCaption.trim() || isSavingDraft) return;

    setIsSavingDraft(true);
    setSaveDraftError(null);
    setSaveDraftSuccess(null);

    const titleToSave = draftTitle.trim() || "Untitled Caption Draft";
    const hashtagsArray = editableHashtagsRaw
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

    try {
      const response = await createDraftAction({
        title: titleToSave,
        caption: editableCaption.trim(),
        format,
        status: "draft",
        metadata: {
          hashtags: hashtagsArray,
          generatedByAi: true,
          language: activeLanguage,
          tone: activeTone,
          topic: topic.trim(),
          source: "ai_studio_caption_generator",
          savedAt: new Date().toISOString(),
        },
      });

      if (!response.success || !response.draft) {
        setSaveDraftError(response.error || "Failed to save draft. Please try again.");
        return;
      }

      setSaveDraftSuccess(`Saved "${titleToSave}" to your draft vault!`);
      if (onDraftSaved) {
        onDraftSaved(response.draft);
      }
    } catch (err) {
      setSaveDraftError(
        err instanceof Error ? err.message : "Unexpected error saving draft to vault."
      );
    } finally {
      setIsSavingDraft(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Mode Context Banner */}
      <div className="p-4 sm:p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-sm backdrop-blur-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <SparklesIcon size={18} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
                Personalized Caption Studio
                <Badge variant="purple" className="text-[10px] tracking-wide uppercase">
                  Phase 1A
                </Badge>
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                Generate high-conversion Instagram post and Reel captions tailored to your confirmed niche identity.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            {hasConfirmedIdentity ? (
              <Badge variant="success" dot className="text-xs">
                Identity: Confirmed ({creatorPreferences?.niche})
              </Badge>
            ) : (
              <Badge variant="warning" dot className="text-xs">
                Identity: Unconfirmed (General Mode)
              </Badge>
            )}
            {isInstagramConnected ? (
              <Badge variant="info" className="text-xs">
                @{username || "connected"}
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-xs">
                Independent Workspace
              </Badge>
            )}
          </div>
        </div>

        {/* Informative Guidance Pill */}
        <div className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950/50 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 flex items-start gap-2">
          <InfoIcon size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <span>
            {isInstagramConnected
              ? "Instagram telemetry and confirmed creator pillars automatically steer hook pace, call-to-action alignment, and topic boundaries."
              : "Drafts and captions are securely stored in your private creator vault. Works fully without connecting Instagram."}
          </span>
        </div>
      </div>

      {/* Main Generator Form Card */}
      <form onSubmit={handleGenerate} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 sm:p-6 space-y-6 shadow-sm">
        {/* Format Selector */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-400 mb-2">
            Target Content Format
          </label>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button
              type="button"
              onClick={() => setFormat("post")}
              className={`p-3 rounded-lg border text-left transition-all flex items-center gap-3 ${
                format === "post"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-950 dark:text-white shadow-sm ring-1 ring-indigo-500/50"
                  : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700"
              }`}
            >
              <div
                className={`p-2 rounded-md ${
                  format === "post" ? "bg-indigo-600 text-white" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                <ImageIcon size={18} />
              </div>
              <div>
                <span className="block text-sm font-semibold text-zinc-900 dark:text-white">Instagram Post</span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">Carousel or Single Feed</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFormat("reel")}
              className={`p-3 rounded-lg border text-left transition-all flex items-center gap-3 ${
                format === "reel"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-950 dark:text-white shadow-sm ring-1 ring-indigo-500/50"
                  : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700"
              }`}
            >
              <div
                className={`p-2 rounded-md ${
                  format === "reel" ? "bg-indigo-600 text-white" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                <VideoIcon size={18} />
              </div>
              <div>
                <span className="block text-sm font-semibold text-zinc-900 dark:text-white">Instagram Reel</span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">Fast Hook & Script Pacing</span>
              </div>
            </button>
          </div>
        </div>

        {/* Topic / Creative Brief Input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor={`${formId}-topic`}
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300"
            >
              Creative Brief or Content Idea <span className="text-rose-500 dark:text-rose-400">*</span>
            </label>
            <span
              className={`text-xs ${
                topicLength > maxTopicLength
                  ? "text-rose-500 dark:text-rose-400 font-semibold"
                  : topicLength >= 3
                  ? "text-zinc-600 dark:text-zinc-400"
                  : "text-zinc-500"
              }`}
            >
              {topicLength}/{maxTopicLength} chars
            </span>
          </div>
          <textarea
            id={`${formId}-topic`}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={isGenerating}
            rows={4}
            placeholder={
              format === "reel"
                ? "E.g., 3 morning habits that transformed my productivity as a software developer, emphasizing avoiding phone screens for the first 30 minutes..."
                : "E.g., Breaking down why most creators burn out in their first 6 months, and the exact content calendar framework that fixes it..."
            }
            className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3.5 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors disabled:opacity-50 resize-y"
          />
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Be as specific as you like. Your confirmed niche, tone, and forbidden topics will be merged automatically.
          </p>
        </div>

        {/* Tone, Language & Optional CTA Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Target Language */}
          <div className="space-y-1.5">
            <label
              htmlFor={`${formId}-language`}
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-400"
            >
              Target Language
            </label>
            <select
              id={`${formId}-language`}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isGenerating}
              className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
            >
              {CANONICAL_LANGUAGE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Other / Custom...</option>
            </select>
            {language === "custom" && (
              <input
                type="text"
                value={customLanguage}
                onChange={(e) => setCustomLanguage(e.target.value)}
                placeholder="Enter custom language"
                disabled={isGenerating}
                className="w-full mt-1.5 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>

          {/* Tone / Brand Voice */}
          <div className="space-y-1.5">
            <label
              htmlFor={`${formId}-tone`}
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-400"
            >
              Tone / Voice
            </label>
            <select
              id={`${formId}-tone`}
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              disabled={isGenerating}
              className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
            >
              {/* Prioritize confirmed creator brand voice if present */}
              {creatorPreferences?.brandVoice && creatorPreferences.brandVoice.length > 0 && (
                <optgroup label="Your Confirmed Voice">
                  {creatorPreferences.brandVoice.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Standard Creative Tones">
                {CANONICAL_TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
              <option value="custom">Custom Tone...</option>
            </select>
            {tone === "custom" && (
              <input
                type="text"
                value={customTone}
                onChange={(e) => setCustomTone(e.target.value)}
                placeholder="Enter custom tone (e.g. Sarcastic & witty)"
                disabled={isGenerating}
                className="w-full mt-1.5 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>

          {/* Optional Call-to-Action */}
          <div className="space-y-1.5">
            <label
              htmlFor={`${formId}-cta`}
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-400"
            >
              Call-to-Action <span className="text-zinc-500 dark:text-zinc-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              id={`${formId}-cta`}
              type="text"
              value={callToAction}
              onChange={(e) => setCallToAction(e.target.value)}
              disabled={isGenerating}
              maxLength={150}
              placeholder="E.g., Save this for later, comment 'READY'"
              className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 py-2 text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
            />
          </div>
        </div>

        {/* Error / Quota Alert Box (Preserves user topic) */}
        {generationError && (
          <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300 text-xs flex items-start gap-2.5">
            <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <span className="font-semibold block">Generation Feedback</span>
              <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{generationError.message}</p>
              {generationError.quotaDetails && (
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {generationError.quotaDetails}
                </p>
              )}
              {generationError.retryAfterMs ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  Estimated recovery window from API headers: retry in ~{Math.ceil(generationError.retryAfterMs / 1000)}s.
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Your typed creative brief has been preserved above. You can adjust the topic or retry without losing your work.
              </p>
            </div>
          </div>
        )}

        {/* Generate Action Button */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">
            Strict ₹0 budget • Powered by Gemini 3.5 Flash Lite
          </div>
          <Button
            type="submit"
            variant="primary"
            isLoading={isGenerating}
            disabled={!isTopicValid || isGenerating}
            className="px-6"
          >
            <SparklesIcon size={16} />
            <span>{isGenerating ? "Crafting Caption..." : "Generate Caption"}</span>
          </Button>
        </div>
      </form>

      {/* Generated Result Workspace */}
      {result && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/40 bg-white dark:bg-zinc-900/90 p-5 sm:p-6 space-y-6 shadow-lg shadow-indigo-100 dark:shadow-indigo-950/20 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Badge variant="purple" className="text-xs uppercase tracking-wider font-semibold">
                {format === "reel" ? "Reel Script & Caption" : "Post Caption"}
              </Badge>
              <Badge variant="neutral" className="text-xs">
                {activeLanguage}
              </Badge>
              <Badge variant="neutral" className="text-xs">
                {activeTone}
              </Badge>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant={isCopied ? "secondary" : "outline"}
                size="sm"
                onClick={handleCopyCaption}
                className="gap-1.5"
              >
                {isCopied ? (
                  <>
                    <CheckIcon size={14} className="text-emerald-500 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-300">Copied!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={14} />
                    <span>Copy All</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Non-Blocking Script Consistency Notice */}
          {result.scriptWarning && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
              <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block text-amber-900 dark:text-amber-300">Script Review Advisory</span>
                <p className="leading-relaxed text-amber-800/90 dark:text-amber-200/90">{result.scriptWarning}</p>
              </div>
            </div>
          )}

          {/* Strategic Reasoning & Source Attribution Pill */}
          {result.explanation && (
            <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Strategic Strategy Rationale
                </span>
                <span className="text-[10px] text-zinc-500">• Fact vs Deduction</span>
              </div>
              <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">{result.explanation}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800/80 text-[11px]">
                <div className="text-zinc-600 dark:text-zinc-400">
                  <span className="text-zinc-500 font-medium">Creator Facts: </span>
                  {hasConfirmedIdentity
                    ? `${creatorPreferences?.niche} • Tone: ${activeTone}`
                    : "Generic profile fallback"}
                </div>
                <div className="text-zinc-600 dark:text-zinc-400">
                  <span className="text-zinc-500 font-medium">AI Strategy: </span>
                  {format === "reel" ? "Visual hook + retention loop" : "Value delivery + conversation trigger"}
                </div>
              </div>
            </div>
          )}

          {/* Editable Caption Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Generated Caption (Fully Editable)
              </label>
              <span className="text-[11px] text-zinc-500">
                {editableCaption.length} chars • Feel free to customize before saving
              </span>
            </div>
            <textarea
              value={editableCaption}
              onChange={(e) => setEditableCaption(e.target.value)}
              rows={8}
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3.5 py-3 text-sm text-zinc-900 dark:text-zinc-100 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-y"
            />
          </div>

          {/* Editable Hashtags */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Hashtags (Space or comma separated)
            </label>
            <input
              type="text"
              value={editableHashtagsRaw}
              onChange={(e) => setEditableHashtagsRaw(e.target.value)}
              placeholder="#instagram #creator #growth"
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3.5 py-2.5 text-xs text-indigo-700 dark:text-indigo-300 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
            />
          </div>

          {/* Save to Drafts Vault Section */}
          <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/90 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookmarkIcon size={16} className="text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                  Save to Creator Draft Vault
                </h4>
              </div>
              <span className="text-[11px] text-zinc-500">
                Explicit action • Not saved automatically
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Draft Title / Working Headline
                </label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  maxLength={200}
                  placeholder="E.g., Morning routine Reel script v1"
                  className="w-full rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <Button
                variant="primary"
                onClick={handleSaveToDrafts}
                isLoading={isSavingDraft}
                disabled={!editableCaption.trim() || isSavingDraft}
                className="w-full"
              >
                <BookmarkIcon size={14} />
                <span>Save to Drafts</span>
              </Button>
            </div>

            {/* Save Status / Feedback */}
            {saveDraftSuccess && (
              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in duration-150">
                <CheckCircle2Icon size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{saveDraftSuccess}</span>
              </div>
            )}

            {saveDraftError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2 animate-in fade-in duration-150">
                <AlertCircleIcon size={14} className="text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{saveDraftError}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
