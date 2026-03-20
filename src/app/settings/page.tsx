"use client";

import React, { useEffect, useRef, useState } from "react";
import { getCached, setCached, invalidateCache } from "@/lib/client-cache";
import { ArrowLeft, Save, Check, Download, RefreshCw, GripVertical, Pencil, Trash2 } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AppSettings, ExclusionRule, Initiative, RoleTargets } from "@/lib/types";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const DEFAULT_CARD_ORDER = [
  "privacy",
  "classification",
  "activity-tracking",
  "calendar",
  "window",
  "browser",
  "initiatives",
  "role-targets",
  "dashboard-settings",
  "exclusions",
  "export",
];

const INITIATIVE_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

const ROLE_TARGET_CATEGORIES: { slug: keyof RoleTargets; label: string; color: string }[] = [
  { slug: "strategy", label: "Strategy & Planning", color: "#6366f1" },
  { slug: "requirements", label: "Requirements", color: "#8b5cf6" },
  { slug: "communication", label: "Communication", color: "#ec4899" },
  { slug: "writing", label: "Writing & Docs", color: "#f59e0b" },
  { slug: "analytics", label: "Analytics", color: "#10b981" },
  { slug: "development", label: "Development", color: "#3b82f6" },
  { slug: "productivity", label: "Personal Productivity", color: "#6b7280" },
];

function SortableCard({
  id,
  isEditMode,
  children,
}: {
  id: string;
  isEditMode: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="h-full">
      <div className={`relative h-full ${isEditMode ? "ring-1 ring-border rounded-xl" : ""}`}>
        {isEditMode && (
          <div
            className="absolute top-3 right-3 z-10 flex cursor-grab items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3" />
            Drag
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingCal, setSyncingCal] = useState(false);
  const [calSyncResult, setCalSyncResult] = useState<{ inserted: number; updated: number; synced_at: string } | null>(null);
  const [calLastSynced, setCalLastSynced] = useState<string | null>(null);
  const [browserTrackerRunning, setBrowserTrackerRunning] = useState<boolean | null>(null);
  const [windowTrackerRunning, setWindowTrackerRunning] = useState<boolean | null>(null);
  const [browserTrackerError, setBrowserTrackerError] = useState<string | null>(null);
  const [windowTrackerError, setWindowTrackerError] = useState<string | null>(null);
  const [exclusions, setExclusions] = useState<ExclusionRule[]>([]);
  const [newApp, setNewApp] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [newInitiativeName, setNewInitiativeName] = useState("");
  const [newInitiativeKeywords, setNewInitiativeKeywords] = useState("");
  const [newInitiativeColor, setNewInitiativeColor] = useState("#6366f1");

  // Layout edit mode
  const [isEditLayoutMode, setIsEditLayoutMode] = useState(false);
  const [cardOrder, setCardOrder] = useState<string[]>(DEFAULT_CARD_ORDER);
  const [colCount, setColCount] = useState(1);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const savedOrderRef = useRef<string[]>(DEFAULT_CARD_ORDER);
  const savedColCountRef = useRef(1);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    function applySettings(s: AppSettings) {
      setSettings(s);
      const order = Array.isArray(s.settings_card_order) && s.settings_card_order.length > 0
        ? s.settings_card_order
        : DEFAULT_CARD_ORDER;
      setCardOrder(order);
      savedOrderRef.current = order;
      const cols = s.settings_col_count ?? 1;
      setColCount(cols);
      savedColCountRef.current = cols;
    }
    const cachedSettings = getCached<AppSettings>("settings");
    if (cachedSettings) {
      applySettings(cachedSettings);
    } else {
      fetch("/api/settings")
        .then((r) => r.json())
        .then((s: AppSettings) => { applySettings(s); setCached("settings", s, 60_000); })
        .catch(() => setError("Failed to load settings"));
    }
    fetch("/api/calendar/last-synced")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d?.synced_at && setCalLastSynced(d.synced_at))
      .catch(() => {});
    fetch("/api/browser-tracker")
      .then((r) => r.json())
      .then((d) => setBrowserTrackerRunning(d.running))
      .catch(() => setBrowserTrackerRunning(false));
    fetch("/api/window-tracker")
      .then((r) => r.json())
      .then((d) => setWindowTrackerRunning(d.running))
      .catch(() => setWindowTrackerRunning(false));
    const cachedExclusions = getCached<ExclusionRule[]>("exclusions");
    if (cachedExclusions) {
      setExclusions(cachedExclusions);
    } else {
      fetch("/api/exclusions")
        .then((r) => r.json())
        .then((d) => { setExclusions(d); setCached("exclusions", d, 60_000); })
        .catch(() => {});
    }
    fetch("/api/initiatives")
      .then((r) => r.json())
      .then((d) => setInitiatives(d.initiatives || []))
      .catch(() => {});
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCardOrder((prev) => {
        const oldIdx = prev.indexOf(String(active.id));
        const newIdx = prev.indexOf(String(over.id));
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }

  function enterEditLayoutMode() {
    savedOrderRef.current = cardOrder;
    savedColCountRef.current = colCount;
    setIsEditLayoutMode(true);
  }

  async function saveLayout() {
    setIsSavingLayout(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings_card_order: cardOrder, settings_col_count: colCount }),
      });
      invalidateCache("settings");
      savedOrderRef.current = cardOrder;
      savedColCountRef.current = colCount;
      setSettings((s) => s ? { ...s, settings_card_order: cardOrder, settings_col_count: colCount } : s);
      setIsEditLayoutMode(false);
    } finally {
      setIsSavingLayout(false);
    }
  }

  function cancelEditLayout() {
    setCardOrder(savedOrderRef.current);
    setColCount(savedColCountRef.current);
    setIsEditLayoutMode(false);
  }

  async function handleWindowTrackerToggle(enabled: boolean) {
    update("window_tracking_enabled", enabled);
    setWindowTrackerError(null);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ window_tracking_enabled: enabled }),
    });
    const res = await fetch("/api/window-tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: enabled ? "start" : "stop" }),
    });
    const d = await res.json();
    if (!res.ok || d.ok === false) {
      setWindowTrackerError(d.error || "Failed to start window tracker");
      setWindowTrackerRunning(false);
      update("window_tracking_enabled", false);
    } else {
      setWindowTrackerRunning(d.running);
    }
  }

  async function handleBrowserTrackerToggle(enabled: boolean) {
    update("browser_tracking_enabled", enabled);
    setBrowserTrackerError(null);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browser_tracking_enabled: enabled }),
    });
    const res = await fetch("/api/browser-tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: enabled ? "start" : "stop" }),
    });
    const d = await res.json();
    if (!res.ok || d.ok === false) {
      setBrowserTrackerError(d.error || "Failed to start browser tracker");
      setBrowserTrackerRunning(false);
      update("browser_tracking_enabled", false);
    } else {
      setBrowserTrackerRunning(d.running);
    }
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, settings_card_order: cardOrder, settings_col_count: colCount }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidateCache("settings");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  async function addExclusion(rule_type: 'app_name' | 'domain', pattern: string) {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    const res = await fetch("/api/exclusions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_type, pattern: trimmed }),
    });
    if (res.ok) {
      const row = await res.json() as ExclusionRule;
      setExclusions((prev) => {
        const next = [row, ...prev.filter((e) => !(e.rule_type === rule_type && e.pattern === trimmed))];
        setCached("exclusions", next, 60_000);
        return next;
      });
    }
  }

  async function removeExclusion(rule_type: 'app_name' | 'domain', pattern: string) {
    await fetch(`/api/exclusions?type=${rule_type}&pattern=${encodeURIComponent(pattern)}`, { method: "DELETE" });
    setExclusions((prev) => {
      const next = prev.filter((e) => !(e.rule_type === rule_type && e.pattern === pattern));
      setCached("exclusions", next, 60_000);
      return next;
    });
  }

  async function addInitiative() {
    const name = newInitiativeName.trim();
    if (!name) return;
    const keywords = newInitiativeKeywords.split(",").map((k) => k.trim()).filter(Boolean);
    const res = await fetch("/api/initiatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, keywords, color: newInitiativeColor }),
    });
    if (res.ok) {
      const d = await res.json();
      setInitiatives((prev) => [...prev, d.initiative]);
      setNewInitiativeName("");
      setNewInitiativeKeywords("");
      setNewInitiativeColor("#6366f1");
    }
  }

  async function deleteInitiative(id: number) {
    await fetch(`/api/initiatives/${id}`, { method: "DELETE" });
    setInitiatives((prev) => prev.filter((i) => i.id !== id));
  }

  function renderCard(id: string) {
    if (!settings) return null;
    switch (id) {
      case "privacy":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Privacy</CardTitle>
                <InfoTooltip text="Controls what Claude prompt text is saved: full text, 200-char preview, or none. Stays on your machine." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Controls how much prompt text is stored locally.
              </p>
              <RadioGroup
                name="privacy_mode"
                value={settings.privacy_mode}
                onChange={(v) => update("privacy_mode", v as AppSettings["privacy_mode"])}
                options={[
                  { value: "full", label: "Full text", description: "Store complete prompt text" },
                  { value: "preview", label: "Preview only", description: "Store first 200 characters" },
                  { value: "redacted", label: "Redacted", description: "Store no prompt text, only classifications" },
                ]}
              />
            </CardContent>
          </Card>
        );
      case "classification":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Classification</CardTitle>
                <InfoTooltip text="Rules-only is fast and explainable. Hybrid adds an LLM fallback for low-confidence events. Full LLM classifies everything via AI." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                How prompts are classified into PM categories.
              </p>
              <RadioGroup
                name="classification_mode"
                value={settings.classification_mode}
                onChange={(v) => update("classification_mode", v as AppSettings["classification_mode"])}
                options={[
                  { value: "rules", label: "Rules only", description: "Pattern-based classification (fast, local)" },
                  { value: "hybrid", label: "Hybrid", description: "Rules first, Haiku for low-confidence prompts (<40%)" },
                  { value: "llm", label: "Full LLM", description: "All prompts classified by Haiku" },
                ]}
              />
            </CardContent>
          </Card>
        );
      case "activity-tracking":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Activity Tracking</CardTitle>
                <InfoTooltip text="Idle timeout ends a session after N minutes of inactivity. Minimum session filters out accidental micro-events." />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Controls how activity is detected and grouped.
              </p>
              <NumberField
                label="Idle timeout (minutes)"
                description="Stop tracking after this many minutes of inactivity"
                value={settings.idle_threshold_minutes}
                onChange={(v) => update("idle_threshold_minutes", v)}
                min={1}
                max={30}
              />
              <NumberField
                label="Minimum session (seconds)"
                description="Ignore app switches shorter than this"
                value={settings.min_session_seconds}
                onChange={(v) => update("min_session_seconds", v)}
                min={10}
                max={120}
              />
              <NumberField
                label="Calendar sync interval (minutes)"
                description="How often to auto-sync your calendar"
                value={settings.calendar_sync_interval_minutes}
                onChange={(v) => update("calendar_sync_interval_minutes", v)}
                min={5}
                max={240}
              />
              <p className="text-xs text-muted-foreground">
                Changes to idle timeout and minimum session length take effect after restarting the window watcher.
              </p>
            </CardContent>
          </Card>
        );
      case "calendar":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Calendar Integration</CardTitle>
                <InfoTooltip text="Paste a public ICS URL from Google or Outlook to import meetings. Block keywords mark events as focus time, not meetings." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Paste an Outlook or Google Calendar ICS URL to import meetings automatically.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">ICS URL</label>
                <input
                  type="url"
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                  placeholder="https://outlook.office365.com/owa/calendar/..."
                  value={settings.calendar_ics_url}
                  onChange={(e) => update("calendar_ics_url", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Block keywords</label>
                <input
                  type="text"
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm font-mono"
                  placeholder="e.g. BLOCK, OOO, Focus"
                  value={settings.calendar_block_keyword}
                  onChange={(e) => update("calendar_block_keyword", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated keywords. Calendar events matching any keyword are treated as focus blocks, not meetings.
                </p>
              </div>
              {settings.calendar_ics_url && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={syncingCal}
                      onClick={async () => {
                        setSyncingCal(true);
                        setCalSyncResult(null);
                        try {
                          await fetch("/api/settings", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ calendar_ics_url: settings.calendar_ics_url }),
                          });
                          const res = await fetch("/api/calendar/sync", { method: "POST" });
                          if (res.ok) {
                            const data = await res.json();
                            setCalSyncResult(data);
                            setCalLastSynced(data.synced_at);
                          }
                        } finally {
                          setSyncingCal(false);
                        }
                      }}
                    >
                      <RefreshCw className={`size-4 mr-1 ${syncingCal ? "animate-spin" : ""}`} />
                      {syncingCal ? "Syncing..." : "Sync Now"}
                    </Button>
                    {calSyncResult && (
                      <span className="text-xs text-muted-foreground">
                        {calSyncResult.inserted} new · {calSyncResult.updated} updated
                      </span>
                    )}
                  </div>
                  {calLastSynced && !calSyncResult && (
                    <p className="text-xs text-muted-foreground">
                      Last synced {new Date(calLastSynced).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "window":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Window Tracking</CardTitle>
                <InfoTooltip text="Polls the active macOS app every 30s. Requires the window watcher daemon to be running in the background." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Track time spent in macOS apps.
              </p>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.window_tracking_enabled}
                    onChange={(e) => handleWindowTrackerToggle(e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm font-medium">Enable window tracking</span>
                </label>
                {settings.window_tracking_enabled && windowTrackerRunning !== null && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${windowTrackerRunning ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                    {windowTrackerRunning ? "● Running" : "○ Stopped"}
                  </span>
                )}
              </div>
              {windowTrackerError && (
                <p className="text-xs text-destructive">{windowTrackerError}</p>
              )}
            </CardContent>
          </Card>
        );
      case "browser":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Browser Tracking</CardTitle>
                <InfoTooltip text="Polls the active browser tab URL every 2s. Requires the browser tracker daemon. Only captures the frontmost window." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Tracks tab switches in Chrome, Safari, Arc, and Edge.
              </p>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.browser_tracking_enabled}
                    onChange={(e) => handleBrowserTrackerToggle(e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm font-medium">Enable browser tracking</span>
                </label>
                {settings.browser_tracking_enabled && browserTrackerRunning !== null && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${browserTrackerRunning ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                    {browserTrackerRunning ? "● Running" : "○ Stopped"}
                  </span>
                )}
              </div>
              {browserTrackerError && (
                <p className="text-xs text-destructive">{browserTrackerError}</p>
              )}
              <NumberField
                label="Keep browser history (days)"
                description="Browser visit files older than this are deleted on startup"
                value={settings.browser_event_retention_days}
                onChange={(v) => update("browser_event_retention_days", v)}
                min={1}
                max={90}
              />
            </CardContent>
          </Card>
        );
      case "dashboard-settings":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Dashboard</CardTitle>
                <InfoTooltip text="Auto-refresh reloads the dashboard every 30s - useful when running on a second monitor while you work." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.dashboard_auto_refresh}
                    onChange={(e) => {
                      update("dashboard_auto_refresh", e.target.checked);
                      fetch("/api/settings", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ dashboard_auto_refresh: e.target.checked }),
                      });
                    }}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm font-medium">Auto-refresh</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatically reload every 30 seconds. Useful for debugging.
              </p>
            </CardContent>
          </Card>
        );
      case "exclusions":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Tracking Exclusions</CardTitle>
                <InfoTooltip text="Apps and domains listed here are never recorded or stored - useful for personal apps or sensitive sites." />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Events from these apps and domains are silently dropped - never stored.
              </p>
              <div className="space-y-2">
                <p className="text-sm font-medium">Apps</p>
                <div className="flex flex-wrap gap-1.5">
                  {exclusions.filter((e) => e.rule_type === "app_name").map((e) => (
                    <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {e.pattern}
                      <button
                        onClick={() => removeExclusion("app_name", e.pattern)}
                        className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                        aria-label={`Remove ${e.pattern}`}
                      >×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 h-8 rounded-md border bg-background px-3 text-sm"
                    placeholder="App name (e.g. Visual Studio Code)"
                    value={newApp}
                    onChange={(e) => setNewApp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { addExclusion("app_name", newApp); setNewApp(""); } }}
                  />
                  <Button variant="outline" size="sm" onClick={() => { addExclusion("app_name", newApp); setNewApp(""); }}>
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {["Visual Studio Code", "Cursor", "Ghostty", "Warp", "iTerm2", "Terminal", "Xcode"]
                    .filter((s) => !exclusions.some((e) => e.rule_type === "app_name" && e.pattern === s))
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => addExclusion("app_name", s)}
                        className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                      >
                        + {s}
                      </button>
                    ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Domains</p>
                <div className="flex flex-wrap gap-1.5">
                  {exclusions.filter((e) => e.rule_type === "domain").map((e) => (
                    <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {e.pattern}
                      <button
                        onClick={() => removeExclusion("domain", e.pattern)}
                        className="ml-0.5 text-muted-foreground hover:text-foreground leading-none"
                        aria-label={`Remove ${e.pattern}`}
                      >×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 h-8 rounded-md border bg-background px-3 text-sm"
                    placeholder="Domain (e.g. localhost)"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { addExclusion("domain", newDomain); setNewDomain(""); } }}
                  />
                  <Button variant="outline" size="sm" onClick={() => { addExclusion("domain", newDomain); setNewDomain(""); }}>
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {["localhost", "claude.ai", "calendar.google.com"]
                    .filter((s) => !exclusions.some((e) => e.rule_type === "domain" && e.pattern === s))
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => addExclusion("domain", s)}
                        className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                      >
                        + {s}
                      </button>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      case "export":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Data Export</CardTitle>
                <InfoTooltip text="Export your full activity history as CSV (for Excel/Sheets) or JSON (for custom analysis). All data stays local." />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Export all your prompt data. Respects your privacy setting.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { window.location.href = "/api/export?format=csv"; }}>
                  <Download className="size-4 mr-1" />
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => { window.location.href = "/api/export?format=json"; }}>
                  <Download className="size-4 mr-1" />
                  Export JSON
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      case "initiatives":
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>Initiatives</CardTitle>
                <InfoTooltip text="Define project names and keywords to track time by initiative. PM Pulse will automatically tag activities matching these keywords." />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Track time across active projects and initiatives.
              </p>
              {initiatives.length > 0 && (
                <div className="space-y-2">
                  {initiatives.map((initiative) => (
                    <div key={initiative.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                      <span
                        className="size-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: initiative.color }}
                      />
                      <span className="text-sm font-medium flex-1">{initiative.name}</span>
                      {initiative.keywords.length > 0 && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {initiative.keywords.join(", ")}
                        </span>
                      )}
                      <button
                        onClick={() => deleteInitiative(initiative.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                        aria-label={`Delete ${initiative.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">Add initiative</p>
                <input
                  type="text"
                  className="w-full h-8 rounded-md border bg-background px-3 text-sm"
                  placeholder="Initiative name (e.g. Q2 Launch)"
                  value={newInitiativeName}
                  onChange={(e) => setNewInitiativeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addInitiative(); }}
                />
                <input
                  type="text"
                  className="w-full h-8 rounded-md border bg-background px-3 text-sm"
                  placeholder="Keywords, comma-separated (e.g. launch, release)"
                  value={newInitiativeKeywords}
                  onChange={(e) => setNewInitiativeKeywords(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addInitiative(); }}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {INITIATIVE_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setNewInitiativeColor(color)}
                        className={`size-5 rounded-full transition-transform ${newInitiativeColor === color ? "ring-2 ring-offset-1 ring-foreground scale-110" : ""}`}
                        style={{ backgroundColor: color }}
                        aria-label={`Select color ${color}`}
                      />
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={addInitiative} disabled={!newInitiativeName.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      case "role-targets": {
        const targets = settings.role_targets ?? {};
        const total = ROLE_TARGET_CATEGORIES.reduce((sum, c) => sum + (targets[c.slug] ?? 0), 0);
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle>PM Role Targets</CardTitle>
                <InfoTooltip text="Set target time allocations per category. Your actual vs. target split is shown in the Trends page." />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Define how you ideally want to allocate your PM time.
              </p>
              <div className="space-y-2">
                {ROLE_TARGET_CATEGORIES.map((cat) => (
                  <div key={cat.slug} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="size-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                      <p className="text-sm">{cat.label}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Target %</span>
                      <input
                        type="number"
                        value={targets[cat.slug] ?? 0}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 0 && v <= 100) {
                            update("role_targets", { ...targets, [cat.slug]: v });
                          }
                        }}
                        min={0}
                        max={100}
                        step={5}
                        className="h-8 w-16 rounded-md border bg-background px-2 text-sm text-right tabular-nums"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 h-3 rounded-full overflow-hidden">
                  {ROLE_TARGET_CATEGORIES.map((cat) => {
                    const pct = targets[cat.slug] ?? 0;
                    if (pct === 0) return null;
                    return (
                      <div
                        key={cat.slug}
                        title={`${cat.label}: ${pct}%`}
                        className="h-full rounded-full"
                        style={{ backgroundColor: cat.color, width: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                <p className={`text-xs ${total !== 100 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  Total: {total}%{total !== 100 ? " — targets should add up to 100%" : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      }
      default:
        return null;
    }
  }

  const maxWidth = colCount > 1 ? "max-w-6xl" : "max-w-2xl";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className={`mx-auto flex ${maxWidth} items-center justify-between px-6 py-4 transition-all duration-200`}>
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon-sm">
                <ArrowLeft className="size-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                P
              </div>
              <h1 className="text-lg font-semibold">Settings</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEditLayoutMode ? (
              <>
                <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => setColCount(n)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${colCount === n ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {n} col
                    </button>
                  ))}
                </div>
                <Button size="sm" onClick={saveLayout} disabled={isSavingLayout}>
                  {isSavingLayout ? "Saving..." : "Done"}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEditLayout}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="icon-sm" onClick={enterEditLayoutMode} title="Edit layout">
                  <Pencil className="size-4" />
                </Button>
                <Button onClick={handleSave} disabled={saving || !settings} size="sm">
                  {saved ? <Check className="size-4 mr-1" /> : <Save className="size-4 mr-1" />}
                  {saving ? "Saving..." : saved ? "Saved" : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={`mx-auto ${maxWidth} px-6 py-6 transition-all duration-200`}>
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive mb-6">
            {error}
          </div>
        )}

        {!settings && !error && <SettingsSkeleton />}

        {settings && (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
              <div
                className="grid gap-6"
                style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
              >
                {cardOrder.map((id) => {
                  const card = renderCard(id);
                  return (
                    <SortableCard key={id} id={id} isEditMode={isEditLayoutMode}>
                      {card ? React.cloneElement(card, { className: `h-full ${card.props.className ?? ""}`.trim() }) : null}
                    </SortableCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
    </div>
  );
}

function SettingsSkeleton() {
  const heights = [96, 120, 140, 112, 80, 80, 80, 96, 80];
  return (
    <div className="space-y-6">
      {heights.map((h, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="h-5 w-32 rounded bg-muted animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted animate-pulse" style={{ height: h }} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: {
    value: string;
    label: string;
    description: string;
    disabled?: boolean;
    badge?: string;
  }[];
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
            value === opt.value
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/50"
          } ${opt.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input
            type="radio"
            name={name}
            checked={value === opt.value}
            onChange={() => !opt.disabled && onChange(opt.value)}
            disabled={opt.disabled}
            className="mt-0.5 accent-primary"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{opt.label}</span>
              {opt.badge && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {opt.badge}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {opt.description}
            </p>
          </div>
        </label>
      ))}
    </div>
  );
}

function NumberField({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        min={min}
        max={max}
        step={step}
        className="h-8 w-20 rounded-md border bg-background px-2 text-sm text-right tabular-nums"
      />
    </div>
  );
}
