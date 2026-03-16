"use client";

import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Check, X, SkipForward, ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TrainingBatch, TrainingItem } from "@/lib/types";

interface CategoryMeta {
  id: number;
  slug: string;
  name: string;
  color: string;
  subcategories: { slug: string; name: string }[];
}

type BatchWithCounts = TrainingBatch & { collected_count: number; reviewed_count: number };

interface BatchData {
  batch: BatchWithCounts | null;
  history: (TrainingBatch & { collected_count: number })[];
}

interface BatchDetail {
  batch: BatchWithCounts;
  items: TrainingItem[];
}

type ReviewAction = "approve" | "correct" | "skip";

function formatEventTime(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatBatchDate(ts: string | null | undefined): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

export default function TrainingPage() {
  const [batchData, setBatchData] = useState<BatchData | null>(null);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingBatch, setStartingBatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [pendingItems, setPendingItems] = useState<Map<number, { category: string; subcategory: string }>>(new Map());
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  const [historyDetails, setHistoryDetails] = useState<Map<number, BatchDetail>>(new Map());
  const [loadingHistoryId, setLoadingHistoryId] = useState<number | null>(null);

  const loadBatch = useCallback(async () => {
    try {
      const [statusRes, catRes] = await Promise.all([
        fetch("/api/training/start"),
        fetch("/api/categories"),
      ]);
      const status = await statusRes.json() as BatchData;
      const cats = await catRes.json() as CategoryMeta[];
      setBatchData(status);
      setCategories(cats);

      if (status.batch) {
        const detailRes = await fetch(`/api/training/batch/${status.batch.id}`);
        const detail = await detailRes.json() as BatchDetail;
        setBatchDetail(detail);
      } else {
        setBatchDetail(null);
      }
    } catch {
      setError("Failed to load training data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBatch(); }, [loadBatch]);

  // Auto-refresh every 5s when collecting
  useEffect(() => {
    if (batchData?.batch?.status !== "collecting") return;
    const interval = setInterval(loadBatch, 5000);
    return () => clearInterval(interval);
  }, [batchData?.batch?.status, loadBatch]);

  async function startBatch(targetCount: number) {
    setStartingBatch(true);
    setError(null);
    try {
      const res = await fetch("/api/training/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_count: targetCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start batch");
        return;
      }
      await loadBatch();
    } catch {
      setError("Failed to start batch");
    } finally {
      setStartingBatch(false);
    }
  }

  async function reviewItem(itemId: number, action: ReviewAction, correction?: { category: string; subcategory: string }) {
    setReviewingId(itemId);
    try {
      await fetch(`/api/training/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(correction ? { human_category: correction.category, human_subcategory: correction.subcategory } : {}),
        }),
      });
      setBatchDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          batch: {
            ...prev.batch,
            reviewed_count: prev.batch.reviewed_count + (action !== "skip" ? 1 : 0),
          },
          items: prev.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  human_approved: action === "approve" ? 1 : 0,
                  human_category: action === "correct" ? (correction?.category ?? null) : item.human_category,
                  human_subcategory: action === "correct" ? (correction?.subcategory ?? null) : item.human_subcategory,
                  reviewed_at: action !== "skip" ? new Date().toISOString() : item.reviewed_at,
                }
              : item
          ),
        };
      });
    } finally {
      setReviewingId(null);
    }
  }

  async function applyBatch() {
    if (!batchDetail?.batch) return;
    const res = await fetch(`/api/training/batch/${batchDetail.batch.id}/apply`, { method: "POST" });
    if (res.ok) await loadBatch();
  }

  async function cancelBatch() {
    if (!batch) return;
    setCancelConfirm(false);
    await fetch(`/api/training/batch/${batch.id}/cancel`, { method: "POST" });
    setBatchData(null);
    setBatchDetail(null);
    await loadBatch();
  }

  async function deleteBatch(id: number) {
    setDeletingId(id);
    try {
      await fetch(`/api/training/batch/${id}`, { method: "DELETE" });
      await loadBatch();
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleHistoryBatch(id: number) {
    if (expandedHistoryId === id) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(id);
    if (!historyDetails.has(id)) {
      setLoadingHistoryId(id);
      try {
        const res = await fetch(`/api/training/batch/${id}`);
        if (res.ok) {
          const detail = await res.json() as BatchDetail;
          setHistoryDetails((prev) => new Map(prev).set(id, detail));
        }
      } finally {
        setLoadingHistoryId(null);
      }
    }
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) { next.delete(group); } else { next.add(group); }
      return next;
    });
  }

  function isReviewed(item: TrainingItem) {
    return item.human_approved === 1 || item.human_category !== null;
  }

  function effectiveSubcategory(item: TrainingItem) {
    return item.human_subcategory ?? item.llm_subcategory;
  }
  function wasCorrection(item: TrainingItem) {
    return item.human_category !== null && item.human_category !== item.llm_category;
  }

  const catBySlug = new Map(categories.map((c) => [c.slug, c]));
  function subOptions(catSlug: string) {
    return catBySlug.get(catSlug)?.subcategories ?? [];
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const batch = batchDetail?.batch ?? batchData?.batch ?? null;
  const items = batchDetail?.items ?? [];
  const history = batchData?.history ?? [];

  const groups = new Map<string, TrainingItem[]>();
  for (const item of items) {
    const g = groups.get(item.llm_category) ?? [];
    g.push(item);
    groups.set(item.llm_category, g);
  }

  const reviewedCount = items.filter(isReviewed).length;
  const totalItems = items.length;
  const progressPct = batch ? Math.round((batch.collected_count / batch.target_count) * 100) : 0;
  const reviewPct = totalItems > 0 ? Math.round((reviewedCount / totalItems) * 100) : 0;

  const sourceBadgeClass = (source: string) =>
    source === "prompt"  ? "bg-indigo-100 text-indigo-700" :
    source === "window"  ? "bg-sky-100 text-sky-700" :
    source === "browser" ? "bg-violet-100 text-violet-700" :
                           "bg-emerald-100 text-emerald-700";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-5 py-7 space-y-7">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <ArrowLeft className="size-3.5" /> Back
              </Button>
            </Link>
            <div className="h-4 w-px bg-border" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Classification Training</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Teach PM Pulse to classify your work more accurately</p>
            </div>
          </div>
          {batch && (
            <Badge variant={batch.status === "reviewing" ? "default" : "secondary"} className="capitalize">
              {batch.status}
            </Badge>
          )}
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">{error}</div>
        )}

        {/* No active batch - batch launcher */}
        {!batch && (
          <div className="space-y-5">
            <div className="rounded-2xl border bg-card p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/><path d="M22 12h-4"/><path d="M18 8l4 4-4 4"/>
                  </svg>
                </div>
                <div>
                  <h2 className="font-semibold text-base mb-1 flex items-center gap-1.5">
                    Start a Training Batch
                    <InfoTooltip text="Captures N real activities using LLM classification, then lets you approve or correct each one to improve future accuracy." />
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Temporarily activates LLM classification across all sources - Claude prompts, browser tabs, app windows, and calendar events.
                    Review each result, correct mistakes, and apply to sharpen future accuracy.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { n: 25, label: "Quick", desc: "~5 min", hint: "Good for a spot-check" },
                  { n: 50, label: "Standard", desc: "~10 min", hint: "Recommended starting point" },
                  { n: 100, label: "Deep", desc: "~20 min", hint: "Maximum accuracy improvement" },
                ].map(({ n, label, desc, hint }) => (
                  <button
                    key={n}
                    disabled={startingBatch}
                    onClick={() => startBatch(n)}
                    className="group relative rounded-xl border bg-muted/30 p-4 text-left transition-all hover:bg-muted/60 hover:border-primary/30 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="text-3xl font-bold tabular-nums text-primary mb-1">
                      {startingBatch ? <Loader2 className="size-6 animate-spin" /> : n}
                    </div>
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc} · {hint}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Batch in progress */}
        {batch && (
          <>
            {/* Status card */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-0.5">
                    {batch.status === "collecting" ? "Collecting" : "Reviewing"} · Batch #{batch.id}
                  </p>
                  {batch.status === "collecting" && (
                    <p className="text-sm text-muted-foreground">LLM classification active - capturing live activities</p>
                  )}
                  {batch.status === "reviewing" && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground tabular-nums">{reviewedCount}</span> of {totalItems} reviewed
                      {reviewedCount > 0 && <span className="text-muted-foreground/60"> · {reviewPct}% done</span>}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {cancelConfirm ? (
                    <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-1.5 text-xs">
                      <span className="text-destructive font-medium">Discard batch?</span>
                      <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={cancelBatch}>Yes</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setCancelConfirm(false)}>Keep</Button>
                    </div>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => setCancelConfirm(true)}>
                        <X className="size-3 mr-1" /> Cancel
                      </Button>
                      {batch.status === "reviewing" && (
                        <Button size="sm" onClick={applyBatch} disabled={reviewedCount === 0} className="h-8 text-xs">
                          Apply &amp; Finish
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{batch.status === "collecting" ? "Activities captured" : "Review progress"}</span>
                  <span>
                    {batch.status === "collecting"
                      ? `${batch.collected_count} / ${batch.target_count}`
                      : `${reviewPct}%`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${batch.status === "collecting" ? progressPct : reviewPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Waiting state */}
            {batch.status === "collecting" && items.length === 0 && (
              <div className="rounded-2xl border border-dashed bg-muted/20 py-12 text-center">
                <p className="text-sm text-muted-foreground">Waiting for activities...</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Use Claude Code, browse the web, or switch apps</p>
              </div>
            )}

            {/* Items grouped by category */}
            {items.length > 0 && (
              <div className="space-y-2.5">
                {Array.from(groups.entries()).map(([catSlug, groupItems]) => {
                  const catMeta = catBySlug.get(catSlug);
                  const collapsed = collapsedGroups.has(catSlug);
                  const groupReviewed = groupItems.filter(isReviewed).length;
                  const allReviewed = groupReviewed === groupItems.length;

                  return (
                    <div key={catSlug} className="rounded-xl border overflow-hidden">
                      {/* Group header */}
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => toggleGroup(catSlug)}
                      >
                        <div className="flex items-center gap-2.5">
                          {collapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: catMeta?.color ?? "#94a3b8" }}
                          />
                          <span className="text-sm font-semibold">{catMeta?.name ?? catSlug}</span>
                          <span className="text-xs text-muted-foreground bg-background border rounded-full px-2 py-0.5">{groupItems.length}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {allReviewed && (
                            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                              <Check className="size-3" /> Done
                            </span>
                          )}
                          {!allReviewed && (
                            <span className="text-xs text-muted-foreground tabular-nums">{groupReviewed}/{groupItems.length}</span>
                          )}
                        </div>
                      </button>

                      {/* Items */}
                      {!collapsed && (
                        <div className="divide-y">
                          {groupItems.map((item) => {
                            const reviewed = isReviewed(item);
                            const correction = wasCorrection(item);
                            const pending = pendingItems.get(item.id);
                            const eventTime = formatEventTime(item.event_time ?? item.timestamp);
                            const conf = item.llm_confidence;
                            const confColor = conf >= 0.8 ? "bg-green-400" : conf >= 0.5 ? "bg-amber-400" : "bg-red-400";

                            return (
                              <div
                                key={item.id}
                                className={`px-4 py-3.5 transition-opacity ${reviewed ? "opacity-50" : ""}`}
                              >
                                {/* Main row: source + text + time */}
                                <div className="flex items-start gap-2.5">
                                  <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sourceBadgeClass(item.source)}`}>
                                    {item.source}
                                  </span>
                                  <p className="text-sm text-foreground line-clamp-2 flex-1 leading-snug">
                                    {item.display_text ?? item.prompt_preview ?? item.prompt_text ?? "(no preview)"}
                                  </p>
                                  {eventTime && (
                                    <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums mt-0.5">{eventTime}</span>
                                  )}
                                </div>

                                {/* Meta: subcategory + confidence bar */}
                                <div className="flex items-center gap-3 mt-2 pl-[52px]">
                                  <span className="text-xs text-muted-foreground font-medium">{item.llm_subcategory}</span>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                                      <div className={`h-full rounded-full ${confColor}`} style={{ width: `${conf * 100}%` }} />
                                    </div>
                                    <span className={`text-[11px] tabular-nums font-medium ${conf >= 0.8 ? "text-green-600" : conf >= 0.5 ? "text-amber-600" : "text-red-500"}`}>
                                      {Math.round(conf * 100)}%
                                    </span>
                                  </div>
                                  {item.llm_reasoning && (
                                    <span className="text-xs text-muted-foreground/60 italic truncate max-w-xs">{item.llm_reasoning}</span>
                                  )}
                                </div>

                                {/* Review result */}
                                {reviewed && (
                                  <div className="flex items-center gap-2 mt-2 pl-[52px]">
                                    {item.human_approved === 1 && !correction && (
                                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                                        <Check className="size-3" /> Approved
                                      </span>
                                    )}
                                    {correction && (
                                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                                        Corrected - {effectiveSubcategory(item)}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Actions */}
                                {!reviewed && batch.status === "reviewing" && (
                                  <div className="flex flex-wrap items-center gap-2 mt-2.5 pl-[52px]">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs gap-1 border-green-200 text-green-700 hover:bg-green-50 hover:border-green-300"
                                      disabled={reviewingId === item.id}
                                      onClick={() => reviewItem(item.id, "approve")}
                                    >
                                      <Check className="size-3" /> Approve
                                    </Button>

                                    <div className="flex items-center gap-1">
                                      <Select
                                        value={pending?.category ?? ""}
                                        onValueChange={(val) => {
                                          if (!val) return;
                                          setPendingItems((prev) => new Map(prev).set(item.id, { category: val, subcategory: "" }));
                                        }}
                                      >
                                        <SelectTrigger size="sm" className="h-7 text-xs w-36">
                                          <SelectValue placeholder="Category" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {categories.map((cat) => (
                                            <SelectItem key={cat.slug} value={cat.slug}>{cat.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>

                                      {pending?.category && (
                                        <Select
                                          value={pending.subcategory}
                                          onValueChange={(val) => {
                                            if (!val) return;
                                            setPendingItems((prev) =>
                                              new Map(prev).set(item.id, { category: pending.category, subcategory: val })
                                            );
                                          }}
                                        >
                                          <SelectTrigger size="sm" className="h-7 text-xs w-36">
                                            <SelectValue placeholder="Subcategory" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectGroup>
                                              <SelectLabel>{catBySlug.get(pending.category)?.name}</SelectLabel>
                                              {subOptions(pending.category).map((sub) => (
                                                <SelectItem key={sub.slug} value={sub.slug}>{sub.name}</SelectItem>
                                              ))}
                                            </SelectGroup>
                                          </SelectContent>
                                        </Select>
                                      )}

                                      {pending?.category && pending?.subcategory && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-xs"
                                          disabled={reviewingId === item.id}
                                          onClick={() => reviewItem(item.id, "correct", { category: pending.category, subcategory: pending.subcategory })}
                                        >
                                          Save
                                        </Button>
                                      )}
                                    </div>

                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-muted-foreground"
                                      onClick={() => reviewItem(item.id, "skip")}
                                    >
                                      <SkipForward className="size-3 mr-1" /> Skip
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Past batches - applied only */}
        {history.filter((h) => h.status === "applied").length > 0 && (
          <div className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
              Past Batches
              <InfoTooltip text="Batches you reviewed and applied. Each one improved classification accuracy for future activities." />
            </h2>
            <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden divide-y">
              {history.filter((h) => h.status === "applied").map((h) => {
                const isExpanded = expandedHistoryId === h.id;
                const detail = historyDetails.get(h.id);
                const isLoadingThis = loadingHistoryId === h.id;

                return (
                  <div key={h.id} className="divide-y">
                    {/* Row header */}
                    <div className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors">
                      <button
                        className="flex items-center gap-3 flex-1 text-left"
                        onClick={() => toggleHistoryBatch(h.id)}
                      >
                        {isLoadingThis
                          ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                          : isExpanded
                            ? <ChevronDown className="size-3.5 text-muted-foreground" />
                            : <ChevronRight className="size-3.5 text-muted-foreground" />
                        }
                        <Badge
                          variant="secondary"
                          className={h.status === "applied"
                            ? "text-green-700 bg-green-100 border border-green-200"
                            : "text-muted-foreground"}
                        >
                          {h.status}
                        </Badge>
                        <span className="font-medium">Batch #{h.id}</span>
                        <span className="text-muted-foreground">{h.collected_count} activities</span>
                      </button>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground tabular-nums">{formatBatchDate(h.created_at)}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deletingId === h.id}
                          onClick={() => deleteBatch(h.id)}
                          title="Delete batch"
                        >
                          {deletingId === h.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                        </Button>
                      </div>
                    </div>

                    {/* Expanded items */}
                    {isExpanded && detail && (
                      <div className="bg-muted/20 px-4 py-3 space-y-1">
                        {detail.items.map((item) => {
                          const corrected = item.human_category !== null && item.human_category !== item.llm_category;
                          const approved = item.human_approved === 1 && !corrected;
                          const skipped = !approved && !corrected;
                          return (
                            <div key={item.id} className="flex items-center gap-2.5 py-1 text-xs border-b border-border/40 last:border-0">
                              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sourceBadgeClass(item.source)}`}>
                                {item.source}
                              </span>
                              <span className="flex-1 text-foreground/70 truncate">
                                {item.display_text ?? item.prompt_preview ?? "(no preview)"}
                              </span>
                              <span className="shrink-0 text-muted-foreground/50">{item.llm_subcategory}</span>
                              {approved && <Check className="shrink-0 size-3 text-green-600" />}
                              {corrected && <span className="shrink-0 text-amber-600 font-medium">- {item.human_subcategory}</span>}
                              {skipped && <span className="shrink-0 text-muted-foreground/30">-</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
