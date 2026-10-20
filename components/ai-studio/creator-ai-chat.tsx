"use client";

import React, { useState, useRef, useEffect, useId } from "react";
import {
  SparklesIcon,
  SendIcon,
  CopyIcon,
  CheckIcon,
  BookmarkIcon,
  RefreshCwIcon,
  AlertCircleIcon,
  InfoIcon,
  CheckCircle2Icon,
  VideoIcon,
  ImageIcon,
  LayersIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Avatar } from "../ui/avatar";
import type {
  CreatorPreferences,
  ChatMessageTurn,
  DraftFormat,
  ContentDraft,
} from "../../app/lib/definitions";
import { sendCreatorChatMessageAction } from "../../app/actions/chat";
import { createDraftAction } from "../../app/actions/drafts";
import {
  CANONICAL_LANGUAGE_PRESETS,
  CANONICAL_TONE_OPTIONS,
  normalizeLanguagePreset,
} from "../../app/lib/localization/standards";

export interface CreatorAiChatProps {
  creatorPreferences?: CreatorPreferences | null;
  isInstagramConnected?: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  onDraftSaved?: (draft: ContentDraft) => void;
  onNavigateToDrafts?: () => void;
}

interface SavingDraftState {
  messageId: string;
  title: string;
  caption: string;
  format: DraftFormat;
  hashtagsRaw: string;
  model?: string;
  language?: string;
  tone?: string;
  isSaving: boolean;
  error: string | null;
  success: string | null;
}

export function CreatorAiChat({
  creatorPreferences,
  isInstagramConnected = false,
  username = null,
  avatarUrl = null,
  onDraftSaved,
  onNavigateToDrafts,
}: CreatorAiChatProps) {
  const inputId = useId();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // In-memory conversation history (Stateless, never persisted to Supabase/cookies/localStorage)
  const [messages, setMessages] = useState<ChatMessageTurn[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Error feedback (preserves input)
  const [chatError, setChatError] = useState<{
    message: string;
    quotaDetails?: string;
    retryAfterMs?: number;
    isModelRestricted?: boolean;
  } | null>(null);

  // Draft review / conversion state
  const [activeDraftReview, setActiveDraftReview] = useState<SavingDraftState | null>(null);

  // Localization controls (compact quick toggles)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    return normalizeLanguagePreset(creatorPreferences?.languages?.[0]) || "English";
  });
  const [selectedTone, setSelectedTone] = useState<string>(() => {
    return creatorPreferences?.brandVoice?.[0] || CANONICAL_TONE_OPTIONS[0];
  });

  const hasConfirmedIdentity = Boolean(
    creatorPreferences?.isConfirmed && creatorPreferences?.niche
  );

  const niche = creatorPreferences?.niche || "Content Creation";
  const audience = creatorPreferences?.targetAudience || "Instagram Audience";

  // Auto-scroll to latest turn
  useEffect(() => {
    if (messages.length > 0) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isPending]);

  // Starter prompts tailored to confirmed identity
  const starterPrompts = React.useMemo(() => {
    return [
      {
        label: "Viral Hook Ideas",
        prompt: `Give me 5 punchy 1.5-second visual hook ideas for an Instagram Reel about ${niche}.`,
      },
      {
        label: "30-Sec Reel Script",
        prompt: `Outline a 30-second high-retention Reel script for ${audience} following: Hook -> Problem -> Concrete Tip -> Call to Action.`,
      },
      {
        label: "Content Pillars Strategy",
        prompt: `Help me structure 4 weekly content pillars for ${niche} that drive authentic engagement.`,
      },
      {
        label: "High-Saves Carousel",
        prompt: `Give me a 5-slide carousel breakdown on a common mistake creators in ${niche} make, with captions for each slide.`,
      },
    ];
  }, [niche, audience]);

  // Clear in-memory conversation
  const handleNewChat = () => {
    setMessages([]);
    setInputMessage("");
    setChatError(null);
    setActiveDraftReview(null);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Submit chat message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const textToSend = inputMessage.trim();
    if (!textToSend || isPending) return;

    if (textToSend.length > 2000) {
      setChatError({
        message: `Your message exceeds the 2000-character limit (${textToSend.length} characters). Please shorten your message and try again.`,
      });
      return;
    }

    // Build the user turn
    const userTurn: ChatMessageTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: textToSend,
      createdAt: new Date().toISOString(),
    };

    // Optimistically update conversation
    const updatedMessages = [...messages, userTurn];
    setMessages(updatedMessages);
    setInputMessage("");
    setIsPending(true);
    setChatError(null);

    // Prepare bounded history payload for stateless server request (max 12 recent turns, safe 2000-char bound)
    const historyPayload = messages.slice(-12).map((m) => ({
      role: m.role,
      content: m.content.length > 2000 ? m.content.slice(0, 2000) : m.content,
    }));

    try {
      const response = await sendCreatorChatMessageAction({
        message: textToSend,
        history: historyPayload,
        language: selectedLanguage,
        tone: selectedTone,
      });

      if (!response.success || !response.message) {
        setChatError({
          message: response.error || "Unable to receive AI response. Please try again.",
          quotaDetails: response.quotaDetails,
          retryAfterMs: response.retryAfterMs,
          isModelRestricted: response.isModelRestricted,
        });
        // Restore typed text into input so creator doesn't lose their thought
        setInputMessage(textToSend);
        return;
      }

      const assistantTurn: ChatMessageTurn = {
        id: `model-${Date.now()}`,
        role: "model",
        content: response.message,
        createdAt: new Date().toISOString(),
        model: response.model || "gemini-3.5-flash-lite",
        language: response.language || selectedLanguage,
        tone: response.tone || selectedTone,
        scriptWarning: response.scriptWarning,
      };

      setMessages((prev) => [...prev, assistantTurn]);
    } catch (err) {
      setChatError({
        message: err instanceof Error ? err.message : "Connection failed. Please retry your question.",
      });
      setInputMessage(textToSend);
    } finally {
      setIsPending(false);
    }
  };

  // Copy assistant response
  const handleCopy = async (id: string, text: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  // Open "Save as Draft" review panel
  const handleInitiateSaveDraft = (msg: ChatMessageTurn) => {
    // Attempt to extract hashtags from the content
    const hashtagMatches = msg.content.match(/#[a-zA-Z0-9_]+/g) || [];
    const suggestedTitle = msg.content
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.replace(/^[#*-\s]+/, "")
      .slice(0, 60) || "Chat Concept Draft";

    const isReelLikely = /reel|script|hook|seconds/i.test(msg.content);

    setActiveDraftReview({
      messageId: msg.id,
      title: suggestedTitle,
      caption: msg.content,
      format: isReelLikely ? "reel" : "post",
      hashtagsRaw: hashtagMatches.join(" "),
      model: msg.model || "gemini-3.5-flash-lite",
      language: msg.language || selectedLanguage,
      tone: msg.tone || selectedTone,
      isSaving: false,
      error: null,
      success: null,
    });
  };

  // Commit draft to Supabase using createDraftAction
  const handleCommitDraft = async () => {
    if (!activeDraftReview || !activeDraftReview.title.trim()) return;

    setActiveDraftReview((prev) => (prev ? { ...prev, isSaving: true, error: null } : null));

    const tags = activeDraftReview.hashtagsRaw
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));

    try {
      const response = await createDraftAction({
        title: activeDraftReview.title.trim(),
        caption: activeDraftReview.caption.trim(),
        format: activeDraftReview.format,
        status: "draft",
        metadata: {
          hashtags: tags,
          source: "creator_ai_chat",
          model: activeDraftReview.model || "gemini-3.5-flash-lite",
          language: activeDraftReview.language || selectedLanguage,
          tone: activeDraftReview.tone || selectedTone,
          convertedAt: new Date().toISOString(),
        },
      });

      if (!response.success || !response.draft) {
        setActiveDraftReview((prev) =>
          prev
            ? {
                ...prev,
                isSaving: false,
                error: response.error || "Failed to persist draft to vault.",
              }
            : null
        );
        return;
      }

      setActiveDraftReview((prev) =>
        prev
          ? {
              ...prev,
              isSaving: false,
              success: `Saved "${response.draft?.title}" to Drafts Vault!`,
            }
            : null
      );

      if (onDraftSaved) {
        onDraftSaved(response.draft);
      }
    } catch (err) {
      setActiveDraftReview((prev) =>
        prev
          ? {
              ...prev,
              isSaving: false,
              error: err instanceof Error ? err.message : "Unexpected error saving draft.",
            }
          : null
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Context & Temporary State Banner */}
      <div className="p-4 sm:p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 backdrop-blur-sm space-y-3 shadow-xs dark:shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
              <SparklesIcon size={18} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
                Creator AI Chat
                <Badge variant="purple" className="text-[10px] tracking-wide uppercase">
                  gemini-3.5-flash-lite
                </Badge>
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                Brainstorm hooks, structure Reel scripts, and explore content pillars with your strategic Instagram co-pilot.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            {hasConfirmedIdentity ? (
              <Badge variant="success" dot className="text-xs">
                Context: {creatorPreferences?.niche}
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-xs">
                General Creator Mode
              </Badge>
            )}
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleNewChat}
                className="gap-1.5 h-7 px-2.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <RefreshCwIcon size={12} />
                <span>New Chat</span>
              </Button>
            )}
          </div>
        </div>

        {/* Temporary State Footnote */}
        <div className="text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 flex items-start gap-2">
          <InfoIcon size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <span>
            <strong>Stateless & Private:</strong> Chat history is stored in memory only and is never saved to the database. Starting a new chat or reloading the page resets the session. Save any valuable concepts directly to your Drafts Vault.
          </span>
        </div>
      </div>

      {/* Main Conversation Canvas */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/80 min-h-[460px] flex flex-col justify-between overflow-hidden shadow-xs dark:shadow-inner">
        {/* Messages Transcript */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 max-h-[580px]">
          {messages.length === 0 ? (
            /* Empty State with Tailored Starter Prompts */
            <div className="py-8 sm:py-12 max-w-2xl mx-auto text-center space-y-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center">
                <SparklesIcon size={24} />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white">
                  {hasConfirmedIdentity
                    ? `Ready to brainstorm for ${niche}?`
                    : "What are we creating today?"}
                </h3>
                <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                  {hasConfirmedIdentity
                    ? `I have your confirmed niche, ${audience} audience context, and tone ready. Pick a starter prompt or ask any creative question.`
                    : "Ask for Reel concepts, caption frameworks, hook variations, or storytelling advice tailored to Instagram."}
                </p>
              </div>

              {/* Starter Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-left">
                {starterPrompts.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setInputMessage(item.prompt);
                      if (textareaRef.current) textareaRef.current.focus();
                    }}
                    className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800/90 bg-zinc-50 dark:bg-zinc-900/60 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 text-left transition-all space-y-1 shadow-2xs dark:shadow-none group"
                  >
                    <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 block group-hover:text-indigo-800 dark:group-hover:text-indigo-200">
                      {item.label}
                    </span>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Active Message Bubbles */
            messages.map((msg) => {
              const isUser = msg.role === "user";
              const isCopied = copiedId === msg.id;
              const isReviewingThis = activeDraftReview?.messageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} animate-in fade-in duration-150`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shrink-0 flex items-center justify-center mt-0.5">
                      <SparklesIcon size={16} />
                    </div>
                  )}

                  <div className={`space-y-2 max-w-[85%] sm:max-w-[75%]`}>
                    <div
                      className={`p-4 rounded-xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words shadow-xs ${
                        isUser
                          ? "bg-indigo-50 border border-indigo-200 text-indigo-950 dark:bg-indigo-950/40 dark:border-indigo-500/40 dark:text-zinc-100 rounded-tr-none font-sans"
                          : "bg-zinc-100/90 border border-zinc-200 text-zinc-900 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 rounded-tl-none font-sans"
                      }`}
                    >
                      {msg.content}
                    </div>

                    {/* Script Advisory Notice on AI output */}
                    {!isUser && msg.scriptWarning && (
                      <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-1.5 animate-in fade-in duration-150">
                        <AlertCircleIcon size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <span className="leading-snug">{msg.scriptWarning}</span>
                      </div>
                    )}

                    {/* Assistant Message Actions */}
                    {!isUser && (
                      <div className="flex items-center gap-2 pt-0.5">
                        <Button
                          variant={isCopied ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="h-6 px-2 text-[10px] gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                        >
                          {isCopied ? (
                            <>
                              <CheckIcon size={12} className="text-emerald-500 dark:text-emerald-400" />
                              <span className="text-emerald-700 dark:text-emerald-300">Copied</span>
                            </>
                          ) : (
                            <>
                              <CopyIcon size={12} />
                              <span>Copy</span>
                            </>
                          )}
                        </Button>

                        <Button
                          variant={isReviewingThis ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => handleInitiateSaveDraft(msg)}
                          className="h-6 px-2 text-[10px] gap-1 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300"
                        >
                          <BookmarkIcon size={12} />
                          <span>Save as Draft</span>
                        </Button>

                        {msg.model && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-mono ml-auto">
                            {msg.model}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Inline Draft Review & Confirmation Form */}
                    {isReviewingThis && activeDraftReview && (
                      <div className="p-3.5 rounded-lg border border-indigo-200 dark:border-indigo-500/40 bg-zinc-50 dark:bg-zinc-900/95 space-y-3 mt-2 shadow-lg animate-in fade-in duration-150">
                        <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-[11px] font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                            <BookmarkIcon size={12} className="text-indigo-600 dark:text-indigo-400" />
                            <span>Save Response to Drafts Vault</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveDraftReview(null)}
                            className="text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 text-xs"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase">
                              Draft Title
                            </label>
                            <input
                              type="text"
                              value={activeDraftReview.title}
                              onChange={(e) =>
                                setActiveDraftReview({
                                  ...activeDraftReview,
                                  title: e.target.value,
                                })
                              }
                              maxLength={200}
                              className="w-full px-2.5 py-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase">
                              Format
                            </label>
                            <select
                              value={activeDraftReview.format}
                              onChange={(e) =>
                                setActiveDraftReview({
                                  ...activeDraftReview,
                                  format: e.target.value as DraftFormat,
                                })
                              }
                              className="w-full px-2.5 py-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="reel">Reel</option>
                              <option value="post">Post</option>
                              <option value="carousel">Carousel</option>
                              <option value="story">Story</option>
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase">
                            Caption / Script Content
                          </label>
                          <textarea
                            value={activeDraftReview.caption}
                            onChange={(e) =>
                              setActiveDraftReview({
                                ...activeDraftReview,
                                caption: e.target.value,
                              })
                            }
                            rows={4}
                            className="w-full px-2.5 py-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        {activeDraftReview.error && (
                          <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 text-xs">
                            {activeDraftReview.error}
                          </div>
                        )}

                        {activeDraftReview.success && (
                          <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <CheckCircle2Icon size={14} className="text-emerald-600 dark:text-emerald-400" />
                              {activeDraftReview.success}
                            </span>
                            {onNavigateToDrafts && (
                              <button
                                type="button"
                                onClick={onNavigateToDrafts}
                                className="underline font-semibold hover:text-emerald-900 dark:hover:text-white"
                              >
                                View Drafts
                              </button>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveDraftReview(null)}
                            className="h-7 text-xs"
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleCommitDraft}
                            isLoading={activeDraftReview.isSaving}
                            disabled={!activeDraftReview.title.trim() || activeDraftReview.isSaving}
                            className="h-7 text-xs"
                          >
                            Confirm Save
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {isUser && avatarUrl && (
                    <Avatar
                      src={avatarUrl}
                      alt={username || "User"}
                      initials={(username || "U").substring(0, 2).toUpperCase()}
                      size="sm"
                      className="shrink-0 mt-0.5"
                    />
                  )}
                </div>
              );
            })
          )}

          {/* Assistant In-Flight Typing Indicator */}
          {isPending && (
            <div className="flex gap-3 justify-start animate-in fade-in duration-150">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shrink-0 flex items-center justify-center mt-0.5">
                <SparklesIcon size={16} />
              </div>
              <div className="p-3.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                <span>Strategizing creative response...</span>
              </div>
            </div>
          )}

          <div ref={transcriptEndRef} />
        </div>

        {/* Error Alert Box (Preserves prompt) */}
        {chatError && (
          <div className="mx-4 sm:mx-6 mb-3 p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
            <AlertCircleIcon size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <span className="font-semibold block">Generation Feedback</span>
              <p className="leading-relaxed text-zinc-800 dark:text-zinc-300">{chatError.message}</p>
              {chatError.quotaDetails && (
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {chatError.quotaDetails}
                </p>
              )}
              {chatError.retryAfterMs ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  Estimated recovery window from API headers: retry in ~{Math.ceil(chatError.retryAfterMs / 1000)}s.
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Your message has been preserved in the input box below so you can retry without retyping.
              </p>
            </div>
          </div>
        )}

        {/* Input Bar Form */}
        <form
          onSubmit={handleSendMessage}
          className="p-3 sm:p-4 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2"
        >
          {/* Compact Style Controls (Language & Tone) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-medium flex items-center gap-1">
                <SparklesIcon size={12} className="text-indigo-600 dark:text-indigo-400" />
                <span>Persona:</span>
              </span>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                disabled={isPending}
                aria-label="Chat Language"
                className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
              >
                {CANONICAL_LANGUAGE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>

              <select
                value={selectedTone}
                onChange={(e) => setSelectedTone(e.target.value)}
                disabled={isPending}
                aria-label="Chat Tone"
                className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
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
            <span className="text-[10px] text-zinc-500 hidden sm:inline">
              Defaulted to Creator Profile
            </span>
          </div>

          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              id={inputId}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isPending}
              rows={2}
              maxLength={2000}
              placeholder="Ask for Reel hooks, script breakdowns, caption advice, or content pillars... (Press Enter to send)"
              className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors disabled:opacity-50 resize-none font-sans"
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isPending}
              disabled={!inputMessage.trim() || isPending}
              className="h-10 px-4 shrink-0"
              title="Send message"
            >
              <SendIcon size={16} />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
            <span>
              Shift+Enter for new line • Strictly ₹0 budget • Powered by Gemini 3.5 Flash Lite
            </span>
            <span>{inputMessage.length}/2000 chars</span>
          </div>
        </form>
      </div>
    </div>
  );
}
