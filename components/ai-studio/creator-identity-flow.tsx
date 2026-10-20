"use client";

import React, { useState, useTransition, useCallback } from "react";
import {
  SparklesIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  InfoIcon,
  InstagramIcon,
  ChevronRightIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Avatar } from "../ui/avatar";
import type {
  CreatorPreferences,
  AiProfileAnalysis,
  DraftFormat,
} from "../../app/lib/definitions";
import {
  getDefaultCreatorPreferences,
  STANDARD_LANGUAGES,
  STANDARD_VOICE_TONES,
  STANDARD_CONTENT_GOALS,
} from "../../app/lib/creator-profile/validation";
import {
  saveCreatorPreferencesAction,
  analyzeCreatorIdentityAction,
} from "../../app/actions/creator-profile";

export interface CreatorIdentityFlowProps {
  initialPreferences?: CreatorPreferences | null;
  isInstagramConnected?: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  onPreferencesSaved?: (preferences: CreatorPreferences) => void;
}

const COMMON_NICHES = [
  "Tech & Software Development",
  "Fitness, Health & Wellness",
  "Personal Finance & Investing",
  "Creator Economy & Solo Business",
  "Lifestyle & Daily Vlogs",
  "Education & Upskilling",
  "Food, Recipes & Culinary",
  "Fashion, Grooming & Style",
  "Travel, Culture & Photography",
  "Design, 3D & Creative Arts",
];

export function CreatorIdentityFlow({
  initialPreferences = null,
  isInstagramConnected = false,
  username = null,
  avatarUrl = null,
  onPreferencesSaved,
}: CreatorIdentityFlowProps) {
  const [preferences, setPreferences] = useState<CreatorPreferences>(() => {
    return initialPreferences && Object.keys(initialPreferences).length > 0
      ? initialPreferences
      : getDefaultCreatorPreferences();
  });

  const [activeStep, setActiveStep] = useState<"questionnaire" | "review" | "confirmed">(() => {
    return initialPreferences?.isConfirmed ? "confirmed" : "questionnaire";
  });

  const [aiAnalysis, setAiAnalysis] = useState<AiProfileAnalysis | null>(() => {
    return initialPreferences?.aiSuggestions || null;
  });

  const [customLanguage, setCustomLanguage] = useState("");
  const [subNicheInput, setSubNicheInput] = useState("");
  const [topicCoverInput, setTopicCoverInput] = useState("");
  const [topicAvoidInput, setTopicAvoidInput] = useState("");

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "warning" | "info";
    text: string;
    retryAfterMs?: number;
  } | null>(null);

  const [isPending, startTransition] = useTransition();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Toggle helpers
  const toggleFormat = (fmt: DraftFormat) => {
    setPreferences((prev) => {
      const exists = prev.preferredFormats.includes(fmt);
      const updated = exists
        ? prev.preferredFormats.filter((f) => f !== fmt)
        : [...prev.preferredFormats, fmt];
      return { ...prev, preferredFormats: updated };
    });
  };

  const toggleLanguage = (lang: string) => {
    setPreferences((prev) => {
      const exists = prev.languages.includes(lang);
      const updated = exists
        ? prev.languages.filter((l) => l !== lang)
        : [...prev.languages, lang];
      return { ...prev, languages: updated.length > 0 ? updated : ["English"] };
    });
  };

  const toggleGoal = (goal: string) => {
    setPreferences((prev) => {
      const exists = prev.contentGoals.includes(goal);
      const updated = exists
        ? prev.contentGoals.filter((g) => g !== goal)
        : [...prev.contentGoals, goal];
      return { ...prev, contentGoals: updated };
    });
  };

  const toggleVoice = (voice: string) => {
    setPreferences((prev) => {
      const exists = prev.brandVoice.includes(voice);
      const updated = exists
        ? prev.brandVoice.filter((v) => v !== voice)
        : [...prev.brandVoice, voice];
      return { ...prev, brandVoice: updated };
    });
  };

  const addSubNiche = () => {
    const val = subNicheInput.trim();
    if (val && !preferences.subNiches.includes(val)) {
      setPreferences((prev) => ({
        ...prev,
        subNiches: [...prev.subNiches, val],
      }));
      setSubNicheInput("");
    }
  };

  const removeSubNiche = (sub: string) => {
    setPreferences((prev) => ({
      ...prev,
      subNiches: prev.subNiches.filter((s) => s !== sub),
    }));
  };

  const addTopicCover = () => {
    const val = topicCoverInput.trim();
    if (val && !preferences.topicsToCover.includes(val)) {
      setPreferences((prev) => ({
        ...prev,
        topicsToCover: [...prev.topicsToCover, val],
      }));
      setTopicCoverInput("");
    }
  };

  const removeTopicCover = (topic: string) => {
    setPreferences((prev) => ({
      ...prev,
      topicsToCover: prev.topicsToCover.filter((t) => t !== topic),
    }));
  };

  const addTopicAvoid = () => {
    const val = topicAvoidInput.trim();
    if (val && !preferences.topicsToAvoid.includes(val)) {
      setPreferences((prev) => ({
        ...prev,
        topicsToAvoid: [...prev.topicsToAvoid, val],
      }));
      setTopicAvoidInput("");
    }
  };

  const removeTopicAvoid = (topic: string) => {
    setPreferences((prev) => ({
      ...prev,
      topicsToAvoid: prev.topicsToAvoid.filter((t) => t !== topic),
    }));
  };

  const addCustomLanguage = () => {
    const val = customLanguage.trim();
    if (val && !preferences.languages.includes(val)) {
      setPreferences((prev) => ({
        ...prev,
        languages: [...prev.languages, val],
      }));
      setCustomLanguage("");
    }
  };

  // Run AI Identity Analysis
  const handleAnalyzeWithAi = useCallback(async () => {
    setIsAnalyzing(true);
    setStatusMessage(null);

    try {
      const res = await analyzeCreatorIdentityAction(preferences);
      if (res.success && res.analysis) {
        setAiAnalysis(res.analysis);
        setActiveStep("review");
        setStatusMessage({
          type: "success",
          text: "AI identity analysis completed. Review recommendations against your stated answers below.",
        });
      } else {
        if (res.isRateLimited) {
          setStatusMessage({
            type: "warning",
            text: res.error || "AI free-tier generation limit reached. Please try again later or continue by saving your profile manually.",
            retryAfterMs: res.retryAfterMs,
          });
        } else {
          setStatusMessage({
            type: "error",
            text: res.error || "Unable to complete AI analysis at this time. You can still save your profile manually.",
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error during AI analysis.";
      setStatusMessage({
        type: "error",
        text: `Analysis error: ${msg}`,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [preferences]);

  // Persist preferences (save draft or confirm)
  const handleSavePreferences = useCallback(
    (confirm = false) => {
      startTransition(async () => {
        setStatusMessage(null);

        const payload: CreatorPreferences = {
          ...preferences,
          isConfirmed: confirm,
          confirmedAt: confirm ? new Date().toISOString() : preferences.confirmedAt,
          aiSuggestions: aiAnalysis,
          updatedAt: new Date().toISOString(),
        };

        const res = await saveCreatorPreferencesAction(payload);
        if (res.success && res.preferences) {
          setPreferences(res.preferences);
          if (confirm) {
            setActiveStep("confirmed");
            setStatusMessage({
              type: "success",
              text: "Creator profile confirmed by you! Your preferences are locked in and active for planning.",
            });
          } else {
            setStatusMessage({
              type: "success",
              text: "Preferences saved successfully.",
            });
          }
          if (onPreferencesSaved) {
            onPreferencesSaved(res.preferences);
          }
        } else {
          setStatusMessage({
            type: "error",
            text: res.error || "Failed to save creator profile.",
          });
        }
      });
    },
    [preferences, aiAnalysis, onPreferencesSaved]
  );

  // Accept a specific AI suggestion
  const handleAcceptSuggestion = (field: keyof CreatorPreferences, value: unknown) => {
    setPreferences((prev) => ({
      ...prev,
      [field]: value,
    }));
    setStatusMessage({
      type: "info",
      text: `Updated "${String(field)}" with AI suggestion. Review and save when ready.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Status Messages */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-4 text-xs flex items-start gap-3 animate-in fade-in duration-150 ${
            statusMessage.type === "success"
              ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
              : statusMessage.type === "warning"
              ? "border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
              : statusMessage.type === "info"
              ? "border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300"
              : "border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2Icon size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          ) : statusMessage.type === "warning" ? (
            <AlertCircleIcon size={18} className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          ) : statusMessage.type === "info" ? (
            <InfoIcon size={18} className="shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" />
          ) : (
            <AlertCircleIcon size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          )}
          <div className="flex-1 space-y-0.5">
            <p className="font-medium">{statusMessage.text}</p>
            {statusMessage.retryAfterMs ? (
              <p className="text-[11px] opacity-80">
                Provider reported retry window: {Math.ceil(statusMessage.retryAfterMs / 1000)} seconds.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-zinc-400 hover:text-zinc-800 dark:hover:text-white text-sm leading-none p-1"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* Step Navigation Pill Headers */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-zinc-200 dark:border-zinc-800/80">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveStep("questionnaire")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeStep === "questionnaire"
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
            }`}
          >
            1. Creator Questionnaire
          </button>

          <ChevronRightIcon size={14} className="text-zinc-400 dark:text-zinc-600" />

          <button
            type="button"
            onClick={() => {
              if (aiAnalysis) setActiveStep("review");
            }}
            disabled={!aiAnalysis}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeStep === "review"
                ? "bg-indigo-600 text-white"
                : !aiAnalysis
                ? "bg-zinc-100 dark:bg-zinc-900/40 text-zinc-400 dark:text-zinc-600 cursor-not-allowed border border-zinc-200 dark:border-zinc-850"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
            }`}
          >
            2. AI Review & Discrepancies
          </button>

          <ChevronRightIcon size={14} className="text-zinc-400 dark:text-zinc-600" />

          <button
            type="button"
            onClick={() => {
              if (preferences.isConfirmed) setActiveStep("confirmed");
            }}
            disabled={!preferences.isConfirmed}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeStep === "confirmed"
                ? "bg-emerald-600 text-white"
                : !preferences.isConfirmed
                ? "bg-zinc-100 dark:bg-zinc-900/40 text-zinc-400 dark:text-zinc-600 cursor-not-allowed border border-zinc-200 dark:border-zinc-850"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
            }`}
          >
            3. Confirmed Profile
          </button>
        </div>

        {preferences.isConfirmed && (
          <Badge variant="success" dot className="text-xs">
            Confirmed by you
          </Badge>
        )}
      </div>

      {/* ===================================================================== */}
      {/* STEP 1: QUESTIONNAIRE FORM */}
      {/* ===================================================================== */}
      {activeStep === "questionnaire" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-6 shadow-sm">
            <div className="flex items-start gap-3.5">
              {avatarUrl && (
                <Avatar
                  src={avatarUrl}
                  alt={username || "Creator Avatar"}
                  initials={(username || "CR").substring(0, 2).toUpperCase()}
                  size="lg"
                  shape="rounded"
                  className="shrink-0 shadow-sm mt-0.5"
                />
              )}
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Creator Identity & Niche Questionnaire</span>
                  {username && (
                    <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400">
                      (@{username})
                    </span>
                  )}
                </h2>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-2xl">
                  Define your creative focus, primary languages, format preferences, and content boundaries. Your choices guide future AI generation and content strategies.
                </p>
              </div>
            </div>

            {/* Primary Niche */}
            <div className="space-y-2.5">
              <label htmlFor="niche-input" className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Primary Niche <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <input
                id="niche-input"
                type="text"
                value={preferences.niche}
                onChange={(e) => setPreferences({ ...preferences, niche: e.target.value })}
                placeholder="e.g. Full-Stack Web Development, Solo SaaS, Home Fitness"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] text-zinc-500 mr-1 self-center">Popular:</span>
                {COMMON_NICHES.slice(0, 5).map((cn) => (
                  <button
                    key={cn}
                    type="button"
                    onClick={() => setPreferences({ ...preferences, niche: cn })}
                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${
                      preferences.niche === cn
                        ? "bg-indigo-50 dark:bg-indigo-900/60 border-indigo-200 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 font-medium"
                        : "bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }`}
                  >
                    {cn}
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-niches */}
            <div className="space-y-2.5">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Sub-Niches & Specific Pillars
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={subNicheInput}
                  onChange={(e) => setSubNicheInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSubNiche();
                    }
                  }}
                  placeholder="e.g. Next.js tutorials, System Design, React 19 tips"
                  className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                />
                <Button variant="outline" size="sm" type="button" onClick={addSubNiche}>
                  <span>Add</span>
                </Button>
              </div>
              {preferences.subNiches.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {preferences.subNiches.map((sub) => (
                    <span
                      key={sub}
                      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800"
                    >
                      {sub}
                      <button
                        type="button"
                        onClick={() => removeSubNiche(sub)}
                        className="text-zinc-400 hover:text-rose-500 dark:hover:text-rose-400"
                        aria-label={`Remove ${sub}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Target Audience */}
            <div className="space-y-1.5">
              <label htmlFor="target-audience" className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Target Audience Profile
              </label>
              <textarea
                id="target-audience"
                rows={2}
                value={preferences.targetAudience}
                onChange={(e) => setPreferences({ ...preferences, targetAudience: e.target.value })}
                placeholder="Who are you creating for? (e.g. CS students and junior software engineers in India wanting practical career advice and project walk-throughs)"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            {/* Languages & Scripts */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Primary Languages & Scripts
              </label>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Supports English, regional languages, and hybrid conversational scripts.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {STANDARD_LANGUAGES.map((lang) => {
                  const active = preferences.languages.includes(lang);
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => toggleLanguage(lang)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        active
                          ? "bg-indigo-50 dark:bg-indigo-600/20 border-indigo-300 dark:border-indigo-500 text-indigo-900 dark:text-indigo-300"
                          : "bg-zinc-100 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      {active ? "✓ " : ""}{lang}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 max-w-sm pt-1">
                <input
                  type="text"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  placeholder="Other language or dialect..."
                  className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                />
                <Button variant="outline" size="sm" type="button" onClick={addCustomLanguage}>
                  <span>Add</span>
                </Button>
              </div>
            </div>

            {/* Preferred Formats */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Preferred Content Formats
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {(["reel", "carousel", "post", "story"] as const).map((fmt) => {
                  const active = preferences.preferredFormats.includes(fmt);
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => toggleFormat(fmt)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-colors ${
                        active
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/60 text-indigo-950 dark:text-indigo-200 font-medium"
                          : "bg-zinc-50 dark:bg-zinc-950/60 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      <span className="capitalize text-xs">{fmt}s</span>
                      <span className={`text-xs ${active ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-zinc-400 dark:text-zinc-600"}`}>
                        {active ? "✓" : "+"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Brand Voice & Tone */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Brand Voice & Communication Tone
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                {STANDARD_VOICE_TONES.map((voice) => {
                  const active = preferences.brandVoice.includes(voice);
                  return (
                    <button
                      key={voice}
                      type="button"
                      onClick={() => toggleVoice(voice)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        active
                          ? "bg-indigo-50 dark:bg-indigo-600/20 border-indigo-300 dark:border-indigo-500 text-indigo-900 dark:text-indigo-300"
                          : "bg-zinc-100 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      {active ? "✓ " : ""}{voice}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Core Content Goals */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Core Content Goals
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                {STANDARD_CONTENT_GOALS.map((goal) => {
                  const active = preferences.contentGoals.includes(goal);
                  return (
                    <button
                      key={goal}
                      type="button"
                      onClick={() => toggleGoal(goal)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        active
                          ? "bg-indigo-50 dark:bg-indigo-600/20 border-indigo-300 dark:border-indigo-500 text-indigo-900 dark:text-indigo-300"
                          : "bg-zinc-100 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      {active ? "✓ " : ""}{goal}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Topics to Cover & Topics to Avoid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Cover */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  Topics to Focus On
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={topicCoverInput}
                    onChange={(e) => setTopicCoverInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTopicCover();
                      }
                    }}
                    placeholder="e.g. Next.js 16, TypeScript, Supabase"
                    className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                  />
                  <Button variant="outline" size="sm" type="button" onClick={addTopicCover}>
                    <span>Add</span>
                  </Button>
                </div>
                {preferences.topicsToCover.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {preferences.topicsToCover.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-zinc-950 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => removeTopicCover(t)}
                          className="text-zinc-400 hover:text-rose-500 dark:hover:text-rose-400"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Avoid */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  Topics to Avoid (Boundaries)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={topicAvoidInput}
                    onChange={(e) => setTopicAvoidInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTopicAvoid();
                      }
                    }}
                    placeholder="e.g. Politics, gossip, unverified leaks"
                    className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
                  />
                  <Button variant="outline" size="sm" type="button" onClick={addTopicAvoid}>
                    <span>Add</span>
                  </Button>
                </div>
                {preferences.topicsToAvoid.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {preferences.topicsToAvoid.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 dark:bg-zinc-950 px-2 py-0.5 text-[11px] font-medium text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => removeTopicAvoid(t)}
                          className="text-zinc-400 hover:text-rose-500 dark:hover:text-rose-400"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Other Notes */}
            <div className="space-y-1.5">
              <label htmlFor="other-notes" className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Additional Creator Notes (Optional)
              </label>
              <textarea
                id="other-notes"
                rows={2}
                value={preferences.otherNotes || ""}
                onChange={(e) => setPreferences({ ...preferences, otherNotes: e.target.value })}
                placeholder="Any special guidelines (e.g. 'Keep hooks under 3 seconds', 'Never use clickbait claims')"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            {/* Action Bar */}
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  type="button"
                  isLoading={isAnalyzing}
                  onClick={handleAnalyzeWithAi}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  <SparklesIcon size={14} />
                  <span>Analyze with AI</span>
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  isLoading={isPending}
                  onClick={() => handleSavePreferences(false)}
                >
                  <span>Save Draft</span>
                </Button>
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                {isInstagramConnected ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-[11px]">
                    <InstagramIcon size={13} />
                    <span>@{username || "creator"} telemetry linked</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-500">
                    Instagram unlinked — AI will analyze stated answers
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 2: AI REVIEW, DISCREPANCY INSPECTOR & CONFIRMATION */}
      {/* ===================================================================== */}
      {activeStep === "review" && aiAnalysis && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-start gap-3">
                {avatarUrl ? (
                  <Avatar
                    src={avatarUrl}
                    alt={username || "Creator Avatar"}
                    initials={(username || "CR").substring(0, 2).toUpperCase()}
                    size="md"
                    shape="rounded"
                    className="shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0">
                    <SparklesIcon size={18} />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      AI Identity Analysis & Discrepancy Review
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Review how your self-reported preferences align with AI observations. Your explicit choices always take precedence over AI suggestions.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setActiveStep("questionnaire")}
                >
                  <span>Edit Questionnaire</span>
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  isLoading={isPending}
                  onClick={() => handleSavePreferences(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <CheckCircle2Icon size={14} />
                  <span>Confirm Profile</span>
                </Button>
              </div>
            </div>

            {/* Discrepancies & Conflicts Alert Box */}
            {aiAnalysis.discrepancies.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertCircleIcon size={14} />
                  <span>Strategic Discrepancies Detected ({aiAnalysis.discrepancies.length})</span>
                </h3>
                <div className="space-y-2">
                  {aiAnalysis.discrepancies.map((disc, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-amber-900 dark:text-amber-200">{disc.field}</span>
                        <Badge variant={disc.severity === "warning" ? "warning" : "neutral"} className="text-[10px]">
                          {disc.severity}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 rounded bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 font-medium block">Your Stated Answer:</span>
                          <span className="text-zinc-800 dark:text-zinc-200">{disc.creatorAnswer || "None specified"}</span>
                        </div>
                        <div className="p-2 rounded bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800">
                          <span className="text-indigo-600 dark:text-indigo-400 font-medium block">AI Observation:</span>
                          <span className="text-zinc-800 dark:text-zinc-200">{disc.aiObservation}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{disc.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comparison Grid: Stated vs AI Suggestions */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Profile Comparison & Suggestions
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Niche Comparison */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-3">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Niche & Sub-Niches</span>
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-[10px] uppercase text-zinc-500 font-medium">Your Choice:</span>
                      <p className="text-zinc-900 dark:text-zinc-200 font-medium">{preferences.niche || "Not defined"}</p>
                    </div>
                    {aiAnalysis.suggestedNiche && aiAnalysis.suggestedNiche !== preferences.niche && (
                      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        <span className="text-[10px] uppercase text-indigo-600 dark:text-indigo-400 font-medium">AI Recommendation:</span>
                        <p className="text-indigo-900 dark:text-indigo-200 font-medium">{aiAnalysis.suggestedNiche}</p>
                        <button
                          type="button"
                          onClick={() => handleAcceptSuggestion("niche", aiAnalysis.suggestedNiche)}
                          className="mt-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline"
                        >
                          Accept AI Niche
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content Themes */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-3">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Identified Content Themes</span>
                  <div className="flex flex-wrap gap-1.5">
                    {aiAnalysis.contentThemes.map((theme, i) => (
                      <Badge key={i} variant="purple" className="text-[11px]">
                        {theme}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Audience Themes & Demographics Disclaimers */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-3">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Audience Themes</span>
                  <div className="flex flex-wrap gap-1.5">
                    {aiAnalysis.audienceThemes.map((theme, i) => (
                      <Badge key={i} variant="neutral" className="text-[11px]">
                        {theme}
                      </Badge>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <span className="text-[10px] text-zinc-500 block font-medium">Demographics Note:</span>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400 italic">
                      {aiAnalysis.audienceDemographicsNote}
                    </p>
                  </div>
                </div>

                {/* High-Conviction Opportunities */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-3">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">Creative Opportunities</span>
                  <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                    {aiAnalysis.opportunities.map((opp, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-300">
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold">•</span>
                        <span>{opp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Missing Evidence / Data Uncertainty Notes */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950/40 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 font-medium">
                <InfoIcon size={14} className="text-zinc-400 dark:text-zinc-500" />
                <span>Evidence Limitations & Transparency</span>
              </div>
              <ul className="space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400 list-disc list-inside">
                {aiAnalysis.missingEvidenceNotes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>

            {/* Bottom Confirmation Bar */}
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={() => setActiveStep("questionnaire")}
              >
                <span>Back to Questionnaire</span>
              </Button>

              <Button
                variant="primary"
                type="button"
                isLoading={isPending}
                onClick={() => handleSavePreferences(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <CheckCircle2Icon size={15} />
                <span>Confirm & Lock Profile</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 3: CONFIRMED PROFILE VIEW */}
      {/* ===================================================================== */}
      {activeStep === "confirmed" && preferences.isConfirmed && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-white dark:bg-zinc-900/60 p-6 space-y-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-start gap-3.5">
                {avatarUrl ? (
                  <Avatar
                    src={avatarUrl}
                    alt={username || "Creator Avatar"}
                    initials={(username || "CR").substring(0, 2).toUpperCase()}
                    size="lg"
                    shape="rounded"
                    className="shadow-md shadow-emerald-950/40 border-emerald-500/40 shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0 mt-0.5">
                    <CheckCircle2Icon size={20} />
                  </div>
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      Creator Profile & Niche Identity
                    </h2>
                    <Badge variant="success" dot className="text-xs">
                      Confirmed by you
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {preferences.confirmedAt
                      ? `Confirmed on ${new Date(preferences.confirmedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}`
                      : "Confirmed and active"}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setActiveStep("questionnaire")}
              >
                <span>Edit Profile</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Primary Niche</span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mt-0.5 block">{preferences.niche || "Not specified"}</span>
                {preferences.subNiches.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {preferences.subNiches.map((s) => (
                      <span key={s} className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Target Audience</span>
                <p className="text-zinc-700 dark:text-zinc-300 mt-1 line-clamp-3 leading-relaxed">
                  {preferences.targetAudience || "General Instagram community"}
                </p>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Preferred Formats</span>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {preferences.preferredFormats.map((f) => (
                    <Badge key={f} variant="purple" className="text-[10px] capitalize">
                      {f}s
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Brand Voice</span>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {preferences.brandVoice.map((v) => (
                    <span key={v} className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                      {v}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Languages</span>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {preferences.languages.map((l) => (
                    <Badge key={l} variant="neutral" className="text-[10px]">
                      {l}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] uppercase font-semibold text-zinc-500 block">Content Goals</span>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {preferences.contentGoals.map((g) => (
                    <span key={g} className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Strategic Highlights if available */}
            {preferences.aiSuggestions && (
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800/80 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <SparklesIcon size={14} />
                  <span>AI Strategic Opportunities</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {preferences.aiSuggestions.opportunities.map((opp, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800/80 text-zinc-700 dark:text-zinc-300 flex items-start gap-2">
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold">•</span>
                      <span>{opp}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
