"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileTextIcon,
  Trash2Icon,
  CopyIcon,
  CheckIcon,
  SparklesIcon,
  VideoIcon,
  ImageIcon,
  LayersIcon,
  AlertCircleIcon,
  SearchIcon,
  PlusIcon,
  XIcon,
} from "../ui/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  ContentDraft,
  DraftFormat,
  DraftStatus,
} from "../../app/lib/definitions";
import {
  listDraftsAction,
  updateDraftAction,
  deleteDraftAction,
  createDraftAction,
} from "../../app/actions/drafts";

export interface DraftsManagerProps {
  initialDrafts?: ContentDraft[];
  onDraftSelected?: (draft: ContentDraft) => void;
  className?: string;
}

function getDraftHashtags(draft: ContentDraft): string[] {
  if (draft.metadata && Array.isArray(draft.metadata.hashtags)) {
    return (draft.metadata.hashtags as unknown[]).filter(
      (t): t is string => typeof t === "string"
    );
  }
  return [];
}

export function DraftsManager({
  initialDrafts = [],
  onDraftSelected,
  className = "",
}: DraftsManagerProps) {
  const [drafts, setDrafts] = useState<ContentDraft[]>(initialDrafts);
  const [isLoading, setIsLoading] = useState(initialDrafts.length === 0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Interaction states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ContentDraft | null>(null);
  const [editingHashtags, setEditingHashtags] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // New Draft Modal / Form state
  const [isCreatingManual, setIsCreatingManual] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [newFormat, setNewFormat] = useState<DraftFormat>("post");
  const [newStatus, setNewStatus] = useState<DraftStatus>("draft");
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load drafts from server action
  const loadDrafts = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await listDraftsAction();
      if (!response.success || !response.drafts) {
        setFetchError(response.error || "Failed to load drafts from server.");
      } else {
        setDrafts(response.drafts);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error connecting to draft vault.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    listDraftsAction()
      .then((response) => {
        if (ignore) return;
        if (!response.success || !response.drafts) {
          setFetchError(response.error || "Failed to load drafts from server.");
        } else {
          setDrafts(response.drafts);
        }
      })
      .catch((err) => {
        if (ignore) return;
        setFetchError(err instanceof Error ? err.message : "Error connecting to draft vault.");
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  // Copy draft caption
  const handleCopy = async (draft: ContentDraft) => {
    const hashtags = getDraftHashtags(draft);
    const textToCopy = hashtags.length > 0
      ? `${draft.caption || ""}\n\n${hashtags.join(" ")}`
      : draft.caption || "";

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = textToCopy;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedId(draft.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setCopiedId(draft.id);
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  // Delete draft with explicit confirmation
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await deleteDraftAction(id);
      if (response.success) {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setConfirmDeleteId(null);
        if (editingDraft?.id === id) {
          setEditingDraft(null);
        }
      } else {
        alert(response.error || "Failed to delete draft.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error deleting draft.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (draft: ContentDraft) => {
    setEditingDraft(draft);
    setEditingHashtags(getDraftHashtags(draft).join(" "));
    setEditError(null);
  };

  // Save edited draft
  const handleSaveEdit = async () => {
    if (!editingDraft) return;
    setIsSavingEdit(true);
    setEditError(null);

    const tags = editingHashtags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));

    try {
      const response = await updateDraftAction(editingDraft.id, {
        title: editingDraft.title,
        caption: editingDraft.caption,
        format: editingDraft.format,
        status: editingDraft.status,
        metadata: {
          ...editingDraft.metadata,
          hashtags: tags,
        },
      });

      if (!response.success || !response.draft) {
        setEditError(response.error || "Failed to update draft.");
        return;
      }

      setDrafts((prev) =>
        prev.map((d) => (d.id === editingDraft.id ? response.draft! : d))
      );
      setEditingDraft(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save draft edits.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Create manual draft
  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newCaption.trim()) return;

    setIsCreatingDraft(true);
    setCreateError(null);

    try {
      const response = await createDraftAction({
        title: newTitle.trim(),
        caption: newCaption.trim(),
        format: newFormat,
        status: newStatus,
      });

      if (!response.success || !response.draft) {
        setCreateError(response.error || "Failed to create draft.");
        return;
      }

      setDrafts((prev) => [response.draft!, ...prev]);
      setIsCreatingManual(false);
      setNewTitle("");
      setNewCaption("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Error creating draft.");
    } finally {
      setIsCreatingDraft(false);
    }
  };

  // Filtered drafts calculation
  const filteredDrafts = drafts.filter((d) => {
    if (formatFilter !== "all" && d.format !== formatFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inTitle = d.title.toLowerCase().includes(q);
      const inCaption = (d.caption || "").toLowerCase().includes(q);
      const hashtags = getDraftHashtags(d);
      const inHashtag = hashtags.some((t) => t.toLowerCase().includes(q));
      if (!inTitle && !inCaption && !inHashtag) return false;
    }
    return true;
  });

  const getFormatBadge = (fmt: DraftFormat) => {
    switch (fmt) {
      case "reel":
        return (
          <Badge variant="purple" className="text-[11px] gap-1">
            <VideoIcon size={12} />
            <span>Reel</span>
          </Badge>
        );
      case "post":
        return (
          <Badge variant="neutral" className="text-[11px] gap-1">
            <ImageIcon size={12} />
            <span>Post</span>
          </Badge>
        );
      case "carousel":
        return (
          <Badge variant="info" className="text-[11px] gap-1">
            <LayersIcon size={12} />
            <span>Carousel</span>
          </Badge>
        );
      case "story":
        return (
          <Badge variant="warning" className="text-[11px] gap-1">
            <SparklesIcon size={12} />
            <span>Story</span>
          </Badge>
        );
      default:
        return <Badge variant="neutral">{fmt}</Badge>;
    }
  };

  const getStatusBadge = (status: DraftStatus) => {
    switch (status) {
      case "draft":
        return <Badge variant="neutral" className="text-[10px]">Draft</Badge>;
      case "review":
        return <Badge variant="warning" className="text-[10px]">In Review</Badge>;
      case "scheduled":
        return <Badge variant="info" className="text-[10px]">Scheduled</Badge>;
      case "published":
        return <Badge variant="success" className="text-[10px]">Published</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const formatDate = (iso: string) => {
    try {
      const date = new Date(iso);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "Recent";
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <FileTextIcon size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span>Content Drafts Vault</span>
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">({drafts.length} total)</span>
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
            Your private repository of captions, Reel scripts, and scheduled publishing concepts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadDrafts}
            isLoading={isLoading}
            disabled={isLoading}
          >
            <span>Refresh</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsCreatingManual(true)}
            className="gap-1.5"
          >
            <PlusIcon size={14} />
            <span>New Draft</span>
          </Button>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
        {/* Search */}
        <div className="sm:col-span-2 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 dark:text-zinc-500">
            <SearchIcon size={14} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles, briefs, hashtags..."
            className="w-full pl-9 pr-3 py-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Format Filter */}
        <div>
          <select
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Formats</option>
            <option value="post">Posts</option>
            <option value="reel">Reels</option>
            <option value="carousel">Carousels</option>
            <option value="story">Stories</option>
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Published</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {fetchError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircleIcon size={14} className="shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{fetchError}</span>
        </div>
      )}

      {/* Manual Draft Creation Modal / Drawer */}
      {isCreatingManual && (
        <div className="p-4 sm:p-5 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-zinc-900/90 shadow-lg dark:shadow-none space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <PlusIcon size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>Compose New Content Draft</span>
            </h3>
            <button
              onClick={() => setIsCreatingManual(false)}
              className="text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 p-1"
            >
              <XIcon size={16} />
            </button>
          </div>

          <form onSubmit={handleCreateManual} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Draft Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={200}
                  placeholder="E.g., 5 productivity myths debunked"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Format
                </label>
                <select
                  value={newFormat}
                  onChange={(e) => setNewFormat(e.target.value as DraftFormat)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="post">Post</option>
                  <option value="reel">Reel</option>
                  <option value="carousel">Carousel</option>
                  <option value="story">Story</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Caption / Script <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={newCaption}
                onChange={(e) => setNewCaption(e.target.value)}
                rows={5}
                placeholder="Write your Instagram caption, Reel hooks, and talking points..."
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                required
              />
            </div>

            {createError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 text-xs">
                {createError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCreatingManual(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isCreatingDraft}
                disabled={!newTitle.trim() || !newCaption.trim() || isCreatingDraft}
              >
                Save Draft
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Draft Modal / Drawer */}
      {editingDraft && (
        <div className="p-4 sm:p-5 rounded-xl border border-indigo-200 dark:border-indigo-500/40 bg-white dark:bg-zinc-900/95 space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Edit Draft</h3>
              {getFormatBadge(editingDraft.format)}
            </div>
            <button
              onClick={() => setEditingDraft(null)}
              className="text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 p-1"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Title
                </label>
                <input
                  type="text"
                  value={editingDraft.title}
                  onChange={(e) =>
                    setEditingDraft({ ...editingDraft, title: e.target.value })
                  }
                  maxLength={200}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Status
                </label>
                <select
                  value={editingDraft.status}
                  onChange={(e) =>
                    setEditingDraft({
                      ...editingDraft,
                      status: e.target.value as DraftStatus,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="draft">Draft</option>
                  <option value="review">Review</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Caption
              </label>
              <textarea
                value={editingDraft.caption || ""}
                onChange={(e) =>
                  setEditingDraft({ ...editingDraft, caption: e.target.value })
                }
                rows={6}
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Hashtags (Space separated)
              </label>
              <input
                type="text"
                value={editingHashtags}
                onChange={(e) => setEditingHashtags(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm text-indigo-700 dark:text-indigo-300 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {editError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 text-xs">
                {editError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingDraft(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveEdit}
                isLoading={isSavingEdit}
                disabled={isSavingEdit}
              >
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Drafts List Display */}
      {filteredDrafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-10 text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shadow-2xs dark:shadow-none">
            <FileTextIcon size={20} />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">No content drafts found</h4>
            <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1 max-w-sm mx-auto">
              {searchQuery || formatFilter !== "all" || statusFilter !== "all"
                ? "Try clearing your filters or search terms."
                : "Create a draft above or generate a personalized caption in the Studio to save ideas."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDrafts.map((draft) => {
            const isDeleting = deletingId === draft.id;
            const isCopied = copiedId === draft.id;
            const isConfirming = confirmDeleteId === draft.id;
            const hashtags = getDraftHashtags(draft);

            return (
              <div
                key={draft.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700/80 transition-all p-4 flex flex-col justify-between space-y-3 shadow-xs dark:shadow-sm group"
              >
                <div className="space-y-2">
                  {/* Top Bar with Badges & Date */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {getFormatBadge(draft.format)}
                      {getStatusBadge(draft.status)}
                    </div>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                      {formatDate(draft.created_at)}
                    </span>
                  </div>

                  {/* Title */}
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors">
                    {draft.title}
                  </h4>

                  {/* Caption Preview */}
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-3 leading-relaxed whitespace-pre-line font-sans">
                    {draft.caption || "(No caption text)"}
                  </p>

                  {/* Hashtags Preview if any */}
                  {hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {hashtags.slice(0, 4).map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-950 text-indigo-700 dark:text-indigo-400/90 border border-zinc-200 dark:border-zinc-800 font-mono"
                        >
                          {tag}
                        </span>
                      ))}
                      {hashtags.length > 4 && (
                        <span className="text-[10px] text-zinc-500 font-mono self-center">
                          +{hashtags.length - 4} more
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom Actions Toolbar */}
                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Copy action */}
                    <Button
                      variant={isCopied ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => handleCopy(draft)}
                      className="h-7 px-2.5 text-[11px]"
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

                    {/* Edit action */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(draft)}
                      className="h-7 px-2.5 text-[11px]"
                    >
                      Edit
                    </Button>
                  </div>

                  {/* Delete with explicit confirmation */}
                  {isConfirming ? (
                    <div className="flex items-center gap-1.5 animate-in fade-in duration-100">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(draft.id)}
                        isLoading={isDeleting}
                        disabled={isDeleting}
                        className="h-7 px-2 text-[10px]"
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(null)}
                        className="h-7 px-1.5 text-[10px]"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(draft.id)}
                      className="text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-400 p-1.5 rounded transition-colors"
                      title="Delete draft"
                    >
                      <Trash2Icon size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
