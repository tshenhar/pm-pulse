"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Clock,
  MessageSquare,
  Trophy,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  TrendingUp,
  Settings,
  Download,
  BrainCircuit,
  X,
  TrendingDown,
  Calendar,
  Monitor,
  Pencil,
  GripVertical,
  ArrowUpDown,
  ArrowUp,
  AlertTriangle,
  Zap,
  ArrowDown,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import { shiftDate, currentWorkday } from "@/lib/date-utils";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { getCached, setCached, invalidateCache } from "@/lib/client-cache";
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    fontSize: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  },
  itemStyle: { color: "var(--color-popover-foreground)" },
  labelStyle: { color: "var(--color-muted-foreground)", fontWeight: 500 },
};
const DEFAULT_LABELS: Record<string, string> = {
  "title-category": "Time by Category",
  "tooltip-category": "Work split across 7 PM categories. Deduplicated - each minute counted once even if multiple sources overlap.",
  "title-source": "How I Worked",
  "tooltip-source": "Time attributed to each source: Claude prompts, calendar meetings, macOS apps, and browser tabs.",
  "title-activity": "Activity",
  "tooltip-activity": "All tracked events in order. Click any row to inspect its classification or correct the category.",
  "title-total-time": "Total Time",
  "tooltip-total-time": "Deduplicated work time today. Overlapping sources (e.g. Claude + browser) count once, not twice.",
  "title-meetings": "Meetings",
  "tooltip-meetings": "Meetings synced from your calendar. Connect via ICS URL in Settings to populate this.",
  "title-focus-time": "Focus Time",
  "tooltip-focus-time": "Total time minus meetings - your actual heads-down work hours today.",
  "title-focus-score": "Focus Score",
  "tooltip-focus-score": "0-100 score based on context switches and category affinity. High = fewer costly switches. Low = fragmented day.",
  "title-timeline": "Day Timeline",
  "tooltip-timeline": "Horizontal timeline of all tracked events by source. Click a block to inspect it.",
  "title-focus-sessions": "Deep Focus",
  "tooltip-focus-sessions": "Sustained single-app sessions: Deep (≥30 min) and Light (15-30 min).",
  "title-daily-pulse": "Today's Pulse",
  "tooltip-daily-pulse": "Auto-generated insights about your day's working patterns.",
  "title-productivity-score": "Productivity Score",
  "tooltip-productivity-score": "0-100 score based on strategic depth (40%), focus quality (35%), and reactive ratio (25%).",
};

function getLabel(key: string, labels: Record<string, string>): string {
  return labels[key]?.trim() || DEFAULT_LABELS[key] || key;
}

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashboardData, ActivitySummary, SourceBreakdown, FocusSessions } from "@/lib/types";
import { computeFocusScore } from "@/lib/focus-score";
import { generateDailyPulse } from "@/lib/daily-pulse";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface CategoryOption {
  slug: string;
  name: string;
  subcategories: { slug: string; name: string }[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function greetingDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = d.getTime() === today.getTime();
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  if (isToday) return `${weekday} - Here's your PM work breakdown for today`;
  return `${weekday}, ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })} - Your PM work breakdown`;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDirectDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function confidenceBadgeVariant(
  confidence: number
): "default" | "secondary" | "outline" {
  if (confidence >= 0.7) return "default";
  if (confidence >= 0.4) return "secondary";
  return "outline";
}

function exportToCsv(data: DashboardData, limit?: number) {
  const items = limit ? data.activities.slice(-limit) : data.activities;
  const rows = [
    ["Time", "Source", "Title", "Category", "Subcategory", "Confidence", "Duration (min)"],
    ...items.map((a) => [
      a.timestamp,
      a.source,
      (a.title ?? "").replace(/"/g, '""'),
      a.primary_category,
      a.primary_subcategory,
      String(Math.round(a.primary_confidence * 100)),
      String(Math.round(a.attributed_minutes)),
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pm-pulse-${data.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SourceBadge({ source }: { source: ActivitySummary["source"] }) {
  if (source === "calendar") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
        <Calendar className="size-2.5" />
        Meeting
      </span>
    );
  }
  if (source === "window") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        <Monitor className="size-2.5" />
        Window
      </span>
    );
  }
  if (source === "browser") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        🌐 Browser
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Claude
    </span>
  );
}

function EditableLabel({
  labelKey,
  isEditMode,
  labels,
  onUpdate,
  className,
}: {
  labelKey: string;
  isEditMode: boolean;
  labels: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
  className?: string;
}) {
  const value = getLabel(labelKey, labels);
  if (!isEditMode) return <>{value}</>;
  return (
    <input
      className={`border-b border-dashed bg-transparent focus:outline-none focus:border-primary min-w-0 ${className ?? ""}`}
      value={value}
      onChange={(e) => onUpdate(labelKey, e.target.value)}
    />
  );
}

function EditableTooltip({
  labelKey,
  isEditMode,
  labels,
  onUpdate,
}: {
  labelKey: string;
  isEditMode: boolean;
  labels: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = getLabel(labelKey, labels);
  if (!isEditMode) return <InfoTooltip text={text} />;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="p-0.5 text-muted-foreground hover:text-foreground rounded"
        title="Edit tooltip text"
      >
        <Pencil className="size-3" />
      </button>
      {editing && (
        <div className="absolute left-0 top-6 z-20 w-64">
          <textarea
            className="w-full rounded border bg-popover p-2 text-xs shadow-lg focus:outline-none"
            rows={4}
            value={text}
            onChange={(e) => onUpdate(labelKey, e.target.value)}
            onBlur={() => setEditing(false)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

function SortableCard({
  id,
  isEditMode,
  disabled,
  span,
  maxSpan,
  onSpanChange,
  children,
}: {
  id: string;
  isEditMode: boolean;
  disabled?: boolean;
  span: number;
  maxSpan: number;
  onSpanChange: (id: string, span: number) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !isEditMode || disabled });
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : undefined,
    gridColumn: `span ${Math.min(span, maxSpan)}`,
  };

  function handleResizeMouseDown(e: React.MouseEvent) {
    if (!isEditMode || maxSpan <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startSpan = span;
    const colWidth = cardRef.current ? cardRef.current.offsetWidth / startSpan : 300;

    function onMove(ev: MouseEvent) {
      const deltaX = ev.clientX - startX;
      const newSpan = Math.max(1, Math.min(maxSpan, Math.round((startSpan * colWidth + deltaX) / colWidth)));
      onSpanChange(id, newSpan);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={(node) => { setNodeRef(node); cardRef.current = node; }}
      style={style}
      className="flex flex-col"
    >
      {isEditMode && (
        <div className="flex items-center gap-2 mb-1 px-1">
          <button
            type="button"
            className="touch-none cursor-grab p-1 text-muted-foreground hover:text-foreground rounded"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground">Drag to reorder</span>
        </div>
      )}
      <div className="flex-1 relative">
        {children}
        {isEditMode && maxSpan > 1 && (
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute right-0 top-0 bottom-0 w-4 flex items-center justify-center cursor-col-resize z-10 group"
            title="Drag to resize width"
          >
            <div className="h-10 w-1.5 rounded-full bg-border group-hover:bg-primary transition-colors" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [date, setDate] = useState(currentWorkday);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivitySummary | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [pageSize, setPageSize] = useState<10 | 50 | 100>(10);
  const [sortCol, setSortCol] = useState<"time" | "source" | "category" | "confidence" | "duration" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [isEditMode, setIsEditMode] = useState(false);
  const [cardOrder, setCardOrder] = useState(["daily-pulse", "timeline", "focus-sessions", "category", "source", "activity"]);
  const [dashColCount, setDashColCount] = useState(2);
  const [cardSpans, setCardSpans] = useState<Record<string, number>>({});
  const [pendingSpans, setPendingSpans] = useState<Record<string, number>>({});
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [pendingLabels, setPendingLabels] = useState<Record<string, string>>({});
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const savedCardOrderRef = React.useRef(["daily-pulse", "timeline", "focus-sessions", "category", "source", "activity"]);
  const savedSpansRef = React.useRef<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setAutoRefresh(json.auto_refresh ?? false);
      setLastRefreshed(new Date());
      // Background ingestion was triggered — re-fetch once it completes
      if (json.needs_refresh) {
        setTimeout(fetchData, 1500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  useEffect(() => {
    const cachedCats = getCached<CategoryOption[]>("categories");
    if (cachedCats) {
      setCategories(cachedCats);
    } else {
      fetch("/api/categories")
        .then((r) => r.json())
        .then((d) => { setCategories(d); setCached("categories", d, 3_600_000); })
        .catch(() => {});
    }
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d) => {
        if (d.is_first_run && !d.onboarding_dismissed) setShowOnboarding(true);
      })
      .catch(() => {});
    function applySettings(s: Record<string, unknown>) {
      const validIds = new Set(["category", "source", "activity", "timeline", "focus-sessions", "daily-pulse", "productivity-score"]);
      const raw: unknown = s.dashboard_card_order;
      const DEFAULT_CARD_ORDER = ["daily-pulse", "productivity-score", "timeline", "focus-sessions", "category", "source", "activity"];
      const order =
        Array.isArray(raw) &&
        raw.length >= 1 &&
        raw.every((id) => typeof id === "string" && validIds.has(id)) &&
        new Set(raw).size === raw.length
          ? (raw as string[])
          : DEFAULT_CARD_ORDER;
      setCardOrder(order);
      if ([2, 3].includes(s.dashboard_col_count as number)) setDashColCount(s.dashboard_col_count as number);
      if (s.dashboard_card_spans && typeof s.dashboard_card_spans === "object") {
        setCardSpans(s.dashboard_card_spans as Record<string, number>);
        savedSpansRef.current = s.dashboard_card_spans as Record<string, number>;
      }
      if (s.dashboard_labels && typeof s.dashboard_labels === "object") {
        setCustomLabels(s.dashboard_labels as Record<string, string>);
      }
    }
    const cachedSettings = getCached<Record<string, unknown>>("settings");
    if (cachedSettings) {
      applySettings(cachedSettings);
    } else {
      fetch("/api/settings")
        .then((r) => r.json())
        .then((s) => { applySettings(s); setCached("settings", s, 60_000); })
        .catch(() => {});
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowLeft") {
        setDate((d) => shiftDate(d, -1));
      } else if (e.key === "ArrowRight") {
        setDate((d) => {
          const next = shiftDate(d, 1);
          return next <= currentWorkday() ? next : d;
        });
      } else if (e.key === "t" || e.key === "T") {
        setDate(currentWorkday());
      } else if (e.key === "Escape") {
        setSelectedActivity(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCardOrder((items) => {
        const oldIdx = items.indexOf(active.id as string);
        const newIdx = items.indexOf(over.id as string);
        return arrayMove(items, oldIdx, newIdx);
      });
    }
  }

  function enterEditMode() {
    setIsEditMode(true);
    savedCardOrderRef.current = [...cardOrder];
    savedSpansRef.current = { ...cardSpans };
    setPendingLabels({ ...customLabels });
    setPendingSpans({ ...cardSpans });
    setSelectedActivity(null);
  }

  async function saveLayout() {
    setIsSavingLayout(true);
    try {
      const labelsToSave: Record<string, string> = {};
      for (const [k, v] of Object.entries(pendingLabels)) {
        if (v.trim()) labelsToSave[k] = v.trim();
      }
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_card_order: cardOrder, dashboard_labels: labelsToSave, dashboard_col_count: dashColCount, dashboard_card_spans: pendingSpans }),
      });
      invalidateCache("settings");
      setCustomLabels(labelsToSave);
      setCardSpans(pendingSpans);
      savedSpansRef.current = pendingSpans;
      setIsEditMode(false);
      setPendingLabels({});
      setPendingSpans({});
    } finally {
      setIsSavingLayout(false);
    }
  }

  function cancelEditMode() {
    setCardOrder([...savedCardOrderRef.current]);
    setCardSpans({ ...savedSpansRef.current });
    setPendingLabels({});
    setPendingSpans({});
    setIsEditMode(false);
  }

  const activeLabels = isEditMode ? pendingLabels : customLabels;
  const updateLabel = (key: string, value: string) =>
    setPendingLabels((prev) => ({ ...prev, [key]: value }));
  const activeSpans = isEditMode ? pendingSpans : cardSpans;
  const getSpan = (id: string) => activeSpans[id] ?? 1;
  const updateSpan = (id: string, span: number) =>
    setPendingSpans((prev) => ({ ...prev, [id]: span }));

  const isToday = date === currentWorkday();
  const sidebarOpen = selectedActivity !== null;
  const totalEvents = data?.total_events ?? 0;

  const focusScore = React.useMemo(
    () => computeFocusScore(data?.activities ?? [], data?.total_hours ?? 0),
    [data]
  );
  const dailyPulse = React.useMemo(
    () => data ? generateDailyPulse(data, focusScore, !!(data.yesterday)) : [],
    [data, focusScore]
  );

  // Feature 5: Daily Pulse Card
  function renderDailyPulseCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-32 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent><div className="h-16 rounded-lg bg-muted animate-pulse" /></CardContent>
        </Card>
      );
    }
    if (!data || totalEvents === 0) return null;
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <EditableLabel labelKey="title-daily-pulse" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </CardTitle>
            <EditableTooltip labelKey="tooltip-daily-pulse" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {dailyPulse.map((sentence, i) => (
              <p key={i} className="text-sm italic text-muted-foreground leading-relaxed">{sentence}</p>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Feature 3: Focus Sessions Card
  function renderFocusSessionsCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-32 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent><div className="h-28 rounded-lg bg-muted animate-pulse" /></CardContent>
        </Card>
      );
    }
    const fs: FocusSessions | undefined = data?.focus_sessions;
    if (!data || !fs || (fs.deep_count === 0 && fs.light_count === 0)) return null;
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <EditableLabel labelKey="title-focus-sessions" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </CardTitle>
            <EditableTooltip labelKey="tooltip-focus-sessions" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Deep (≥30m)</p>
                <p className="text-lg font-semibold">{fs.deep_count > 0 ? formatMinutes(fs.deep_minutes) : "—"}</p>
                {fs.deep_count > 0 && <p className="text-xs text-muted-foreground">{fs.deep_count} session{fs.deep_count > 1 ? "s" : ""}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Light (15–30m)</p>
                <p className="text-lg font-semibold">{fs.light_count > 0 ? formatMinutes(fs.light_minutes) : "—"}</p>
                {fs.light_count > 0 && <p className="text-xs text-muted-foreground">{fs.light_count} session{fs.light_count > 1 ? "s" : ""}</p>}
              </div>
            </div>
            {fs.longest_app && (
              <p className="text-xs text-muted-foreground">
                Longest: <span className="font-medium text-foreground">{fs.longest_app}</span> ({formatMinutes(fs.longest_minutes)})
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Feature: Productivity Score Card
  function renderProductivityScoreCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-40 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent><div className="h-24 rounded-lg bg-muted animate-pulse" /></CardContent>
        </Card>
      );
    }
    const ps = data?.productivity_score;
    if (!ps) return null;
    const labelColor = ps.label === "Focus Day" ? "text-emerald-600 dark:text-emerald-400"
      : ps.label === "Reactive Day" ? "text-amber-600 dark:text-amber-400"
      : "text-blue-600 dark:text-blue-400";
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <EditableLabel labelKey="title-productivity-score" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </CardTitle>
            <EditableTooltip labelKey="tooltip-productivity-score" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-bold">{ps.score}</span>
              <span className="text-muted-foreground text-sm mb-1">/100</span>
              <span className={`ml-auto text-sm font-medium ${labelColor}`}>{ps.label}</span>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Strategic depth</span>
                <span className="font-medium text-foreground">{ps.strategic_pct}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Focus time</span>
                <span className="font-medium text-foreground">{formatMinutes(ps.focus_minutes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Reactive work</span>
                <span className="font-medium text-foreground">{ps.reactive_pct}%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Feature 2: Day Timeline Card
  function renderTimelineCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-32 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent><div className="h-36 rounded-lg bg-muted animate-pulse" /></CardContent>
        </Card>
      );
    }
    if (!data || totalEvents === 0) return null;
    const dayStartIso = data.day_start_iso || new Date(date + "T08:00:00").toISOString();
    const dayStartMs = new Date(dayStartIso).getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    const nowMs = Math.min(Date.now(), dayEndMs);
    const totalMs = nowMs - dayStartMs;

    const SOURCE_ROWS: { source: ActivitySummary["source"]; label: string; color: string }[] = [
      { source: "prompt", label: "Claude", color: "bg-indigo-500" },
      { source: "calendar", label: "Meetings", color: "bg-blue-500" },
      { source: "window", label: "Apps", color: "bg-amber-500" },
      { source: "browser", label: "Browser", color: "bg-emerald-500" },
    ];

    const activitiesBySource = new Map<ActivitySummary["source"], ActivitySummary[]>();
    for (const a of data.activities) {
      if (!activitiesBySource.has(a.source)) activitiesBySource.set(a.source, []);
      activitiesBySource.get(a.source)!.push(a);
    }

    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <EditableLabel labelKey="title-timeline" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </CardTitle>
            <EditableTooltip labelKey="tooltip-timeline" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {SOURCE_ROWS.map(({ source, label, color }) => {
              const evts = activitiesBySource.get(source) ?? [];
              return (
                <div key={source} className="flex items-center gap-2">
                  <span className="w-16 text-xs text-muted-foreground shrink-0 text-right">{label}</span>
                  <div className="relative flex-1 h-6 bg-muted rounded overflow-hidden">
                    {evts.map((a) => {
                      const startMs = new Date(a.timestamp).getTime();
                      const durationMs = a.attributed_minutes * 60 * 1000;
                      const left = Math.max(0, ((startMs - dayStartMs) / totalMs) * 100);
                      const width = Math.max(0.5, (durationMs / totalMs) * 100);
                      if (left > 100) return null;
                      return (
                        <button
                          key={`${a.source}-${a.id}`}
                          className={`absolute top-0 h-full ${color} opacity-80 hover:opacity-100 cursor-pointer transition-opacity`}
                          style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                          onClick={() => setSelectedActivity(a)}
                          title={`${a.title} (${formatMinutes(a.attributed_minutes)})`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="flex pl-[4.5rem] text-[10px] text-muted-foreground/60 justify-between">
              <span>{new Date(dayStartIso).toLocaleTimeString("en-US", { hour: "numeric", hour12: true })}</span>
              <span>{new Date(nowMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderCategoryCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-32 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent><div className="h-52 rounded-lg bg-muted animate-pulse" /></CardContent>
        </Card>
      );
    }
    if (!data || totalEvents === 0) return null;
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <EditableLabel labelKey="title-category" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </CardTitle>
            <EditableTooltip labelKey="tooltip-category" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="h-52 w-52 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.category_breakdown}
                    dataKey="minutes"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {data.category_breakdown.map((entry) => (
                      <Cell key={entry.category} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatMinutes(Number(value))} {...TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-1.5">
              {data.category_breakdown.map((cat) => (
                <div key={cat.category} className="flex items-center gap-2 text-sm">
                  <div className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-muted-foreground truncate">{cat.name}</span>
                  <span className="ml-auto font-medium tabular-nums">{Math.round(cat.percentage)}%</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderSourceCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-32 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent><div className="h-52 rounded-lg bg-muted animate-pulse" /></CardContent>
        </Card>
      );
    }
    if (!data || totalEvents === 0) return null;
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>
              <EditableLabel labelKey="title-source" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </CardTitle>
            <EditableTooltip labelKey="tooltip-source" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
          </div>
        </CardHeader>
        <CardContent>
          <SourceBreakdownChart breakdown={data.source_breakdown} />
        </CardContent>
      </Card>
    );
  }

  function renderActivityCard() {
    if (loading) {
      return (
        <Card>
          <CardHeader><div className="h-5 w-16 rounded bg-muted animate-pulse" /></CardHeader>
          <CardContent className="px-0">
            <div className="space-y-0">
              {Array.from({ length: 6 }).map((_, i) => {
                const style = { animationDelay: `${i * 50}ms` };
                return (
                  <div key={i} className="flex gap-4 px-4 py-3 border-b last:border-0">
                    <div className="h-4 w-4 rounded bg-muted animate-pulse shrink-0" style={style} />
                    <div className="h-4 w-16 rounded bg-muted animate-pulse shrink-0" style={style} />
                    <div className="h-4 flex-1 rounded bg-muted animate-pulse" style={style} />
                    <div className="h-4 w-24 rounded bg-muted animate-pulse shrink-0" style={style} />
                    <div className="h-4 w-10 rounded bg-muted animate-pulse shrink-0" style={style} />
                    <div className="h-4 w-10 rounded bg-muted animate-pulse shrink-0" style={style} />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      );
    }
    if (!data || !data.activities || data.activities.length === 0) return null;
    return (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CardTitle>
                <EditableLabel labelKey="title-activity" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
              </CardTitle>
              <EditableTooltip labelKey="tooltip-activity" isEditMode={isEditMode} labels={activeLabels} onUpdate={updateLabel} />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
                {([10, 50, 100] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPageSize(n)}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      pageSize === n
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Export current view as CSV"
                title={`Export ${pageSize} rows as CSV`}
                onClick={() => data && exportToCsv(data, pageSize)}
              >
                <Download className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4 w-8" />
                <SortableHead col="time" label="Time" sortCol={sortCol} sortDir={sortDir} onSort={(c) => { if (sortCol === c) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(c); setSortDir("asc"); } }} />
                <SortableHead col="source" label="Source" sortCol={sortCol} sortDir={sortDir} onSort={(c) => { if (sortCol === c) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(c); setSortDir("asc"); } }} />
                <TableHead>Activity</TableHead>
                <SortableHead col="category" label="Category" sortCol={sortCol} sortDir={sortDir} onSort={(c) => { if (sortCol === c) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(c); setSortDir("asc"); } }} />
                <SortableHead col="confidence" label="Confidence" sortCol={sortCol} sortDir={sortDir} onSort={(c) => { if (sortCol === c) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(c); setSortDir("asc"); } }} />
                <SortableHead col="duration" label="Duration" className="text-right pr-4" sortCol={sortCol} sortDir={sortDir} onSort={(c) => { if (sortCol === c) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(c); setSortDir("desc"); } }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const catColorMap = new Map(data.category_breakdown.map((c) => [c.category, c.color]));
                const sorted = sortCol
                  ? sortActivities(data.activities, sortCol, sortDir).slice(0, pageSize)
                  : data.activities.slice(-pageSize);
                return sorted.map((activity) => (
                  <ActivityTableRow
                    key={`${activity.source}-${activity.id}`}
                    activity={activity}
                    selected={selectedActivity?.source === activity.source && selectedActivity?.id === activity.id}
                    categoryColor={catColorMap.get(activity.primary_category)}
                    onSelect={() =>
                      setSelectedActivity(
                        selectedActivity?.source === activity.source && selectedActivity?.id === activity.id
                          ? null
                          : activity
                      )
                    }
                  />
                ));
              })()}
            </TableBody>
          </Table>
          {data.activities.length > pageSize && (
            <p className="px-4 py-2 text-xs text-muted-foreground text-center">
              {sortCol
                ? `Showing top ${pageSize} of ${data.activities.length} (sorted)`
                : `Showing latest ${pageSize} of ${data.activities.length}`}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                P
              </div>
              <h1 className="text-lg font-semibold">PM Pulse</h1>
            </div>
            {data && (
              <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                data.total_events > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}>
                <span className={`size-1.5 rounded-full ${
                  data.total_events > 0
                    ? autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-emerald-500"
                    : "bg-muted-foreground/40"
                }`} />
                {data.total_events > 0
                  ? `${data.total_events} event${data.total_events === 1 ? "" : "s"} today`
                  : "No events yet"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/trends">
              <Button variant="ghost" size="icon-sm" aria-label="Trends">
                <TrendingUp className="size-4" />
              </Button>
            </Link>
            <Link href="/digest">
              <Button variant="ghost" size="icon-sm" aria-label="Weekly Digest">
                <BookOpen className="size-4" />
              </Button>
            </Link>
            <Link href="/training">
              <Button variant="ghost" size="icon-sm" aria-label="Training">
                <BrainCircuit className="size-4" />
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="ghost" size="icon-sm" aria-label="Settings">
                <Settings className="size-4" />
              </Button>
            </Link>
            {isEditMode ? (
              <>
                <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
                  {([2, 3] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setDashColCount(n)}
                      className={`px-2 py-0.5 rounded transition-colors ${dashColCount === n ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
                      title={`${n} columns`}
                    >
                      {n} col
                    </button>
                  ))}
                </div>
                <Button size="sm" onClick={saveLayout} disabled={isSavingLayout}>
                  {isSavingLayout ? "Saving..." : "Done"}
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEditMode} disabled={isSavingLayout}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit dashboard layout"
                title="Edit dashboard layout"
                onClick={enterEditMode}
              >
                <Pencil className="size-4" />
              </Button>
            )}
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous day"
              onClick={() => setDate((d) => shiftDate(d, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-48 text-center text-sm font-medium">
              {formatDate(date)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next day"
              onClick={() => setDate((d) => shiftDate(d, 1))}
              disabled={isToday}
            >
              <ChevronRight className="size-4" />
            </Button>
            {!isToday && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDate(currentWorkday())}
              >
                Today
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
            {autoRefresh ? (
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            ) : lastRefreshed ? (
              <span className="text-xs text-muted-foreground">
                {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Main content */}
        <main
          className={`flex-1 min-w-0 mx-auto max-w-6xl px-6 py-6 space-y-6 transition-all duration-300 ${sidebarOpen ? "pr-6" : ""}`}
        >
          {showOnboarding && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <h2 className="text-base font-semibold">Welcome to PM Pulse</h2>
                    <p className="text-sm text-muted-foreground">
                      PM Pulse tracks how you spend your time by monitoring Claude Code prompts.
                      Make sure hooks are registered by running <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">npm run setup</code> in the project directory.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={loadingDemo}
                        onClick={async () => {
                          setLoadingDemo(true);
                          try {
                            const res = await fetch("/api/onboarding", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "load_demo" }),
                            });
                            if (res.ok) {
                              setShowOnboarding(false);
                              fetchData();
                            }
                          } finally {
                            setLoadingDemo(false);
                          }
                        }}
                      >
                        {loadingDemo ? "Loading..." : "Load Demo Data"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setShowOnboarding(false);
                          await fetch("/api/onboarding", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "dismiss" }),
                          });
                        }}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
              Failed to load dashboard: {error}
            </div>
          )}

          {/* Day Greeting */}
          <div>
            <h2 className="text-sm text-muted-foreground">{greetingDate(date)}</h2>
          </div>

          {/* Anomaly Alerts */}
          {data?.anomaly_alerts && data.anomaly_alerts.length > 0 && (
            <div className="space-y-2">
              {data.anomaly_alerts.map((alert, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${alert.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300" : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300"}`}>
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Parallel Work Banner */}
          {data?.parallel_work_detected && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300">
              <Zap className="size-4 shrink-0" />
              <span>Parallel sessions detected - {formatMinutes(data.parallel_minutes ?? 0)} attributed across {data.parallel_sessions} sessions (wall-clock shorter)</span>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {loading ? (
              <>
                <SkeletonCard delay={0} />
                <SkeletonCard delay={75} />
                <SkeletonCard delay={150} />
                <SkeletonCard delay={225} />
              </>
            ) : (
              <>
                <SummaryCard
                  icon={<Clock className="size-4" />}
                  label={getLabel("title-total-time", activeLabels)}
                  value={data ? formatMinutes(data.total_hours * 60) : "--"}
                  subtitle={data && data.tracked_pct !== undefined ? `of ~${Math.round(data.expected_minutes / 60)}h tracked (${data.tracked_pct}%)` : undefined}
                  delta={data?.yesterday ? data.total_hours * 60 - data.yesterday.total_hours * 60 : undefined}
                  deltaFormat="minutes"
                  info={getLabel("tooltip-total-time", activeLabels)}
                  isEditMode={isEditMode}
                  labelKey="title-total-time"
                  tooltipKey="tooltip-total-time"
                  pendingLabels={pendingLabels}
                  onUpdateLabel={updateLabel}
                />
                <SummaryCard
                  icon={<Calendar className="size-4" />}
                  label={getLabel("title-meetings", activeLabels)}
                  value={data?.meeting_count?.toString() ?? "--"}
                  delta={data?.yesterday ? data.meeting_count - data.yesterday.meeting_count : undefined}
                  deltaFormat="count"
                  info={getLabel("tooltip-meetings", activeLabels)}
                  isEditMode={isEditMode}
                  labelKey="title-meetings"
                  tooltipKey="tooltip-meetings"
                  pendingLabels={pendingLabels}
                  onUpdateLabel={updateLabel}
                />
                <SummaryCard
                  icon={<MessageSquare className="size-4" />}
                  label={getLabel("title-focus-time", activeLabels)}
                  value={data ? formatMinutes(data.focus_minutes) : "--"}
                  delta={data?.yesterday ? data.focus_minutes - data.yesterday.focus_minutes : undefined}
                  deltaFormat="minutes"
                  info={getLabel("tooltip-focus-time", activeLabels)}
                  isEditMode={isEditMode}
                  labelKey="title-focus-time"
                  tooltipKey="tooltip-focus-time"
                  pendingLabels={pendingLabels}
                  onUpdateLabel={updateLabel}
                />
                <SummaryCard
                  icon={<Trophy className="size-4" />}
                  label={getLabel("title-focus-score", activeLabels)}
                  value={data ? `${focusScore.score}/100` : "--"}
                  subtitle={data ? `${focusScore.transitions} switch${focusScore.transitions === 1 ? "" : "es"}` : undefined}
                  info={getLabel("tooltip-focus-score", activeLabels)}
                  isEditMode={isEditMode}
                  labelKey="title-focus-score"
                  tooltipKey="tooltip-focus-score"
                  pendingLabels={pendingLabels}
                  onUpdateLabel={updateLabel}
                />
              </>
            )}
          </div>

          {/* Sortable Cards */}
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(${dashColCount}, minmax(0, 1fr))` }}
              >
                {cardOrder.map((id) => (
                  <SortableCard key={id} id={id} isEditMode={isEditMode} disabled={loading} span={getSpan(id)} maxSpan={dashColCount} onSpanChange={updateSpan}>
                    {id === "category" && renderCategoryCard()}
                    {id === "source" && renderSourceCard()}
                    {id === "activity" && renderActivityCard()}
                    {id === "timeline" && renderTimelineCard()}
                    {id === "focus-sessions" && renderFocusSessionsCard()}
                    {id === "daily-pulse" && renderDailyPulseCard()}
                    {id === "productivity-score" && renderProductivityScoreCard()}
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Empty State */}
          {data && totalEvents === 0 && !loading && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No activity recorded for this day.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Use Claude Code, add a calendar ICS URL, or run <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">npm run watch-windows</code> to start tracking.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Keyboard hint */}
          <p className="text-xs text-muted-foreground/50 text-center pb-2">
            ← → navigate dates · T jump to today · Esc close panel
          </p>
        </main>

        {/* Detail Sidebar */}
        <aside
          className={`shrink-0 border-l bg-card overflow-y-auto sticky top-[57px] h-[calc(100vh-57px)] transition-all duration-200 ease-out ${
            sidebarOpen ? "w-80 opacity-100" : "w-0 opacity-0 border-l-0 overflow-hidden"
          }`}
        >
          {selectedActivity && (
            <div className="w-80">
              <DetailSidebar
                key={`${selectedActivity.source}-${selectedActivity.id}`}
                activity={selectedActivity}
                activities={data?.activities ?? []}
                categories={categories}
                onClose={() => setSelectedActivity(null)}
                onReclassified={() => {
                  fetchData();
                  setSelectedActivity(null);
                }}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

type SortCol = "time" | "source" | "category" | "confidence" | "duration";

function SortableHead({ col, label, sortCol, sortDir, onSort, className }: {
  col: SortCol;
  label: string;
  sortCol: SortCol | null;
  sortDir: "asc" | "desc";
  onSort: (col: SortCol) => void;
  className?: string;
}) {
  const active = sortCol === col;
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(col)}
        className="flex items-center gap-1 hover:text-foreground transition-colors group"
      >
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-40 transition-opacity" />
        )}
      </button>
    </TableHead>
  );
}

function sortActivities(activities: ActivitySummary[], col: SortCol | null, dir: "asc" | "desc"): ActivitySummary[] {
  if (!col) return activities;
  const mult = dir === "asc" ? 1 : -1;
  return [...activities].sort((a, b) => {
    switch (col) {
      case "time": return mult * a.timestamp.localeCompare(b.timestamp);
      case "source": return mult * a.source.localeCompare(b.source);
      case "category": return mult * `${a.primary_category}/${a.primary_subcategory}`.localeCompare(`${b.primary_category}/${b.primary_subcategory}`);
      case "confidence": return mult * (a.primary_confidence - b.primary_confidence);
      case "duration": return mult * (a.attributed_minutes - b.attributed_minutes);
      default: return 0;
    }
  });
}

function ActivityTableRow({
  activity,
  selected,
  onSelect,
  categoryColor,
}: {
  activity: ActivitySummary;
  selected: boolean;
  onSelect: () => void;
  categoryColor?: string;
}) {
  const isLowConfidence = activity.source !== "calendar" && activity.primary_confidence < LOW_CONFIDENCE_THRESHOLD;
  return (
    <TableRow
      className={`cursor-pointer ${isLowConfidence ? "opacity-70" : ""} ${selected ? "bg-muted/50" : ""}`}
      onClick={onSelect}
      style={categoryColor ? { boxShadow: `inset 3px 0 0 ${categoryColor}` } : undefined}
    >
      <TableCell className="pl-4 w-8">
        <ChevronDown
          className={`size-3.5 text-muted-foreground transition-transform ${
            selected ? "rotate-0" : "-rotate-90"
          }`}
        />
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {formatTime(activity.timestamp)}
      </TableCell>
      <TableCell>
        <SourceBadge source={activity.source} />
      </TableCell>
      <TableCell className="max-w-xs truncate">
        {activity.title || (
          <span className="text-muted-foreground italic">redacted</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-xs">
          {activity.primary_category}/{activity.primary_subcategory}
        </span>
      </TableCell>
      <TableCell>
        {activity.source !== "calendar" ? (
          <div className="flex items-center gap-1.5">
            <Badge variant={confidenceBadgeVariant(activity.primary_confidence)}>
              {Math.round(activity.primary_confidence * 100)}%
            </Badge>
            {isLowConfidence && (
              <span className="text-[10px] text-muted-foreground">Low</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">exact</span>
        )}
      </TableCell>
      <TableCell className="text-right pr-4 tabular-nums">
        {formatMinutes(activity.attributed_minutes)}
      </TableCell>
    </TableRow>
  );
}

function DetailSidebar({
  activity,
  activities,
  categories,
  onClose,
  onReclassified,
}: {
  activity: ActivitySummary;
  activities: ActivitySummary[];
  categories: { slug: string; name: string; subcategories: { slug: string; name: string }[] }[];
  onClose: () => void;
  onReclassified: () => void;
}) {
  const [selectedCat, setSelectedCat] = useState(activity.primary_category);
  const [selectedSub, setSelectedSub] = useState(activity.primary_subcategory);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const subcategories =
    categories.find((c) => c.slug === selectedCat)?.subcategories ?? [];

  // Gap inference: find window/browser events between this prompt and the next prompt
  const gapActivities = React.useMemo(() => {
    if (activity.source !== "prompt") return null;
    const sorted = [...activities].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const idx = sorted.findIndex(a => a.source === "prompt" && a.id === activity.id);
    if (idx === -1) return null;
    const nextPromptIdx = sorted.findIndex((a, i) => i > idx && a.source === "prompt");
    const gapEnd = nextPromptIdx === -1 ? null : sorted[nextPromptIdx].timestamp;
    const gapStart = activity.timestamp;
    // Filter window + browser events in the gap
    const gapEvents = sorted.filter(a =>
      (a.source === "window" || a.source === "browser") &&
      a.timestamp >= gapStart &&
      (gapEnd === null || a.timestamp < gapEnd)
    );
    if (gapEvents.length === 0) return null;
    // Group by app/domain and sum minutes
    const byKey = new Map<string, number>();
    for (const e of gapEvents) {
      const key = e.source === "browser"
        ? (e.title || "Browser")
        : e.title.split(" - ")[0]; // app name only
      byKey.set(key, (byKey.get(key) ?? 0) + e.attributed_minutes);
    }
    return Array.from(byKey.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, mins]) => ({ key, mins }));
  }, [activity, activities]);

  const hasChanged =
    selectedCat !== activity.primary_category ||
    selectedSub !== activity.primary_subcategory;

  async function handleReclassify() {
    if (activity.source === "calendar") return;
    setSaving(true);
    try {
      const res = await fetch(`/api/activities/${activity.source}/${activity.id}/reclassify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: selectedCat,
          subcategory: selectedSub,
          reason: reason || undefined,
        }),
      });
      if (res.ok) {
        setReason("");
        onReclassified();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <SourceBadge source={activity.source} />
          <span className="text-sm font-medium text-muted-foreground tabular-nums">
            {formatTime(activity.timestamp)}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Sidebar content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Title / prompt */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            {activity.source === "prompt" ? "Prompt" : activity.source === "calendar" ? "Meeting" : activity.source === "browser" ? "Domain" : "App"}
          </p>
          <p className="text-sm bg-background rounded-md p-3 border leading-relaxed">
            {activity.title}
          </p>
        </div>

        {/* Source-specific extras */}
        {activity.source === "window" && activity.window_title && (
          <div className="grid grid-cols-1 gap-2">
            <SidebarDetailItem label="Window Title" value={activity.window_title} />
          </div>
        )}
        {activity.source === "calendar" && (
          <div className="grid grid-cols-2 gap-2">
            {activity.attendee_count !== undefined && (
              <SidebarDetailItem label="Attendees" value={String(activity.attendee_count)} />
            )}
            {activity.end_time && (
              <SidebarDetailItem label="Ends" value={formatTime(activity.end_time)} />
            )}
            {activity.location && (
              <SidebarDetailItem label="Location" value={activity.location} />
            )}
          </div>
        )}

        {/* Classification details */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Classification</p>
          <div className="grid grid-cols-2 gap-2">
            <SidebarDetailItem label="Category" value={activity.primary_category} />
            <SidebarDetailItem label="Subcategory" value={activity.primary_subcategory} />
            {activity.source === "prompt" && activity.classification_method && (
              <SidebarDetailItem label="Method" value={activity.classification_method} />
            )}
            {activity.source !== "calendar" && (
              <SidebarDetailItem label="Confidence" value={`${Math.round(activity.primary_confidence * 100)}%`} />
            )}
          </div>
          {activity.classification_reasoning && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Reasoning</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{activity.classification_reasoning}</p>
            </div>
          )}
        </div>

        {/* Time attribution — only for prompts */}
        {activity.source === "prompt" && activity.attribution_method && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Time Attribution</p>
            <div className="grid grid-cols-2 gap-2">
              <SidebarDetailItem
                label="Duration"
                value={
                  activity.attribution_method === "direct" && activity.response_duration_seconds != null
                    ? formatDirectDuration(activity.response_duration_seconds)
                    : formatMinutes(activity.attributed_minutes)
                }
              />
              <SidebarDetailItem label="Method" value={activity.attribution_method} />
              {activity.time_confidence && (
                <SidebarDetailItem label="Quality" value={activity.time_confidence} />
              )}
            </div>
          </div>
        )}

        {/* Gap Activity — between this prompt and the next */}
        {gapActivities && gapActivities.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Between this and next prompt</p>
            <div className="flex flex-wrap gap-1.5">
              {gapActivities.map(({ key, mins }) => (
                <span key={key} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{formatMinutes(mins)}</span>
                  {key}
                </span>
              ))}
            </div>
          </div>
        )}
        {activity.source === "prompt" && (!gapActivities || gapActivities.length === 0) && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Between this and next prompt</p>
            <p className="text-xs text-muted-foreground/60">No app activity captured in gap.</p>
          </div>
        )}

        {/* Duration for non-prompt sources */}
        {activity.source !== "prompt" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Duration</p>
            <p className="text-sm font-medium">{formatMinutes(activity.attributed_minutes)}</p>
          </div>
        )}

        {/* Reclassify — all sources except calendar */}
        {activity.source !== "calendar" && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Reclassify</p>
              {(activity.source === "browser" || activity.source === "window") && (
                <span className="text-[10px] text-primary bg-primary/10 rounded px-1.5 py-0.5">
                  saves a rule
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Category</label>
                <Select
                  value={selectedCat}
                  onValueChange={(val) => {
                    if (!val) return;
                    setSelectedCat(val);
                    const subs = categories.find((c) => c.slug === val)?.subcategories ?? [];
                    setSelectedSub(subs[0]?.slug ?? "");
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Subcategory</label>
                <Select value={selectedSub} onValueChange={(val) => val && setSelectedSub(val)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subcategories.map((s) => (
                      <SelectItem key={s.slug} value={s.slug}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Reason (optional)</label>
                <input
                  className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                  placeholder="Why reclassify?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <Button
                size="sm"
                className="w-full"
                onClick={handleReclassify}
                disabled={!hasChanged || saving}
              >
                {saving ? "Saving..." : (activity.source === "browser" || activity.source === "window") ? "Save & Learn" : "Save Classification"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  );
}

function SourceBreakdownChart({ breakdown }: { breakdown: SourceBreakdown }) {
  const total = breakdown.claude_minutes + breakdown.calendar_minutes + breakdown.window_minutes + (breakdown.browser_minutes ?? 0);
  const rows = [
    { label: "Claude", minutes: breakdown.claude_minutes, color: "bg-muted-foreground/60", icon: "🤖" },
    { label: "Meetings", minutes: breakdown.calendar_minutes, color: "bg-blue-500", icon: "📅" },
    { label: "Apps", minutes: breakdown.window_minutes, color: "bg-purple-500", icon: "🖥" },
    { label: "Browser", minutes: breakdown.browser_minutes ?? 0, color: "bg-emerald-500", icon: "🌐" },
  ];

  if (total === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No data yet</p>;
  }

  return (
    <div className="space-y-4 py-1">
      {rows.map((row) => {
        const pct = total > 0 ? (row.minutes / total) * 100 : 0;
        return (
          <div key={row.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span>{row.icon}</span>
                {row.label}
              </span>
              <span className="tabular-nums font-medium">
                {row.minutes > 0 ? formatMinutes(row.minutes) : <span className="text-muted-foreground/50">—</span>}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${row.color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SkeletonCard({ delay = 0 }: { delay?: number }) {
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-muted animate-pulse" style={style} />
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded bg-muted animate-pulse" style={style} />
          <div className="h-5 w-10 rounded bg-muted animate-pulse" style={style} />
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaBadge({ delta, format }: { delta: number; format: "minutes" | "count" }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  const label = format === "minutes"
    ? `${positive ? "+" : "-"}${formatMinutes(Math.abs(delta))}`
    : `${positive ? "+" : ""}${delta}`;

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
      {positive ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
      {label}
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  delta,
  deltaFormat,
  subtitle,
  info,
  isEditMode,
  labelKey,
  tooltipKey,
  pendingLabels,
  onUpdateLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: number;
  deltaFormat?: "minutes" | "count";
  subtitle?: string;
  info?: string;
  isEditMode?: boolean;
  labelKey?: string;
  tooltipKey?: string;
  pendingLabels?: Record<string, string>;
  onUpdateLabel?: (key: string, value: string) => void;
}) {
  const editActive = isEditMode && labelKey && pendingLabels && onUpdateLabel;
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-1">
            {editActive ? (
              <input
                className="text-xs text-muted-foreground bg-transparent border-b border-dashed focus:outline-none focus:border-primary w-24"
                value={getLabel(labelKey, pendingLabels)}
                onChange={(e) => onUpdateLabel(labelKey, e.target.value)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{label}</p>
            )}
            {editActive && tooltipKey ? (
              <EditableTooltip
                labelKey={tooltipKey}
                isEditMode={true}
                labels={pendingLabels}
                onUpdate={onUpdateLabel}
              />
            ) : info ? (
              <InfoTooltip text={info} />
            ) : null}
          </div>
          <p className="text-lg font-semibold leading-tight">{value}</p>
          {subtitle && (
            <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">{subtitle}</p>
          )}
          {delta !== undefined && deltaFormat && (
            <DeltaBadge delta={delta} format={deltaFormat} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
