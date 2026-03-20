"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Clock, MessageSquare, TrendingUp, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { HourlyHeatmapCell, RoleTargets } from "@/lib/types";

interface DailyTotal {
  date: string;
  hours: number;
  prompts: number;
}

interface CategoryTotal {
  category: string;
  name: string;
  color: string;
  minutes: number;
}

interface TrendsData {
  period: "week" | "month";
  start_date: string;
  end_date: string;
  daily_totals: DailyTotal[];
  category_totals: CategoryTotal[];
  total_hours: number;
  total_prompts: number;
  avg_hours_per_day: number;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

const CATEGORY_COLORS: Record<string, string> = {
  strategy: "#6366f1",
  requirements: "#8b5cf6",
  communication: "#ec4899",
  writing: "#f59e0b",
  analytics: "#10b981",
  development: "#3b82f6",
  productivity: "#6b7280",
};

const CATEGORY_NAMES: Record<string, string> = {
  strategy: "Strategy & Planning",
  requirements: "Requirements",
  communication: "Communication",
  writing: "Writing & Docs",
  analytics: "Analytics",
  development: "Development",
  productivity: "Productivity",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS_RANGE = Array.from({ length: 17 }, (_, i) => i + 6); // 6-22

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

// ---- Heatmap ----

function HourlyHeatmap({ cells }: { cells: HourlyHeatmapCell[] }) {
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (cells.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Not enough data to show heatmap.
      </div>
    );
  }

  // Build lookup: (day_of_week, hour) -> cell
  const lookup = new Map<string, HourlyHeatmapCell>();
  let maxMinutes = 0;
  for (const c of cells) {
    lookup.set(`${c.day_of_week}-${c.hour}`, c);
    if (c.minutes > maxMinutes) maxMinutes = c.minutes;
  }

  // Collect categories that appear
  const seenCategories = new Set<string>();
  for (const c of cells) {
    if (c.dominant_category) seenCategories.add(c.dominant_category);
  }

  const cellW = 28;
  const cellH = 20;
  const gap = 2;

  function getCellColor(cell: HourlyHeatmapCell | undefined): string {
    if (!cell || cell.minutes === 0) return "transparent";
    const cat = cell.dominant_category ?? "productivity";
    const baseColor = CATEGORY_COLORS[cat] ?? "#6b7280";
    // opacity 0.2 at 1min, 1.0 at 60min+
    const opacity = Math.min(1, Math.max(0.2, cell.minutes / 60));
    // Convert hex to rgb for rgba
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  function handleMouseEnter(
    e: React.MouseEvent<HTMLDivElement>,
    day: number,
    hour: number
  ) {
    const cell = lookup.get(`${day}-${hour}`);
    if (!cell || cell.minutes === 0) {
      setTooltip(null);
      return;
    }
    const cat = cell.dominant_category
      ? (CATEGORY_NAMES[cell.dominant_category] ?? cell.dominant_category)
      : null;
    const dayName = DAY_LABELS[day];
    const hourStr = formatHour(hour);
    const text = `${dayName} ${hourStr} - ${formatMinutes(cell.minutes)}${cat ? ` (${cat})` : ""}`;
    const rect = (e.target as HTMLDivElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    setTooltip({
      text,
      x: rect.left - (containerRect?.left ?? 0) + cellW / 2,
      y: rect.top - (containerRect?.top ?? 0) - 8,
    });
  }

  return (
    <div>
      <div ref={containerRef} className="relative overflow-x-auto">
        {/* Day labels row */}
        <div className="flex" style={{ marginLeft: 40 }}>
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-center text-xs text-muted-foreground font-medium"
              style={{ width: cellW + gap, flexShrink: 0 }}
            >
              {d}
            </div>
          ))}
        </div>
        {/* Grid rows */}
        {HOURS_RANGE.map((hour) => (
          <div key={hour} className="flex items-center">
            <div
              className="text-right text-xs text-muted-foreground shrink-0 pr-2"
              style={{ width: 40 }}
            >
              {formatHour(hour)}
            </div>
            {DAY_LABELS.map((_, day) => {
              const cell = lookup.get(`${day}-${hour}`);
              const color = getCellColor(cell);
              const hasData = cell && cell.minutes > 0;
              return (
                <div
                  key={day}
                  onMouseEnter={(e) => handleMouseEnter(e, day, hour)}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    width: cellW,
                    height: cellH,
                    marginRight: gap,
                    marginBottom: gap,
                    backgroundColor: hasData ? color : "var(--color-muted)",
                    borderRadius: 3,
                    cursor: hasData ? "default" : "default",
                    flexShrink: 0,
                    opacity: hasData ? 1 : 0.3,
                  }}
                />
              );
            })}
          </div>
        ))}
        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
      {/* Legend */}
      {seenCategories.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {Array.from(seenCategories).map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: CATEGORY_COLORS[cat] ?? "#6b7280" }}
              />
              <span className="text-xs text-muted-foreground">
                {CATEGORY_NAMES[cat] ?? cat}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- PM Role Balance ----

interface RoleBalanceRowProps {
  name: string;
  slug: string;
  color: string;
  actualPct: number;
  targetPct: number | undefined;
}

function RoleBalanceRow({
  name,
  slug,
  color,
  actualPct,
  targetPct,
}: RoleBalanceRowProps) {
  const delta =
    targetPct !== undefined ? Math.round(actualPct - targetPct) : null;
  const deltaColor =
    delta === null
      ? ""
      : delta > 0
        ? "text-green-600"
        : delta < 0
          ? "text-red-500"
          : "text-muted-foreground";
  const deltaLabel =
    delta === null
      ? null
      : delta > 0
        ? `▲${delta}%`
        : delta < 0
          ? `▼${Math.abs(delta)}%`
          : "on target";

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-36 shrink-0 text-sm text-right text-muted-foreground truncate">
        {name}
      </div>
      <div className="relative flex-1 h-5">
        {/* Actual bar */}
        <div
          className="absolute top-0 left-0 h-full rounded"
          style={{
            width: `${Math.min(100, actualPct)}%`,
            backgroundColor: color,
            opacity: 0.85,
          }}
        />
        {/* Target marker */}
        {targetPct !== undefined && (
          <div
            className="absolute top-0 h-full w-0.5 rounded"
            style={{
              left: `${Math.min(100, targetPct)}%`,
              backgroundColor: "var(--color-foreground)",
              opacity: 0.4,
            }}
          />
        )}
      </div>
      <div className="w-10 shrink-0 text-right text-sm font-medium">
        {Math.round(actualPct)}%
      </div>
      {targetPct !== undefined ? (
        <div className="w-12 shrink-0 text-right text-xs text-muted-foreground">
          target {targetPct}%
        </div>
      ) : (
        <div className="w-12 shrink-0" />
      )}
      {deltaLabel && (
        <div className={`w-14 shrink-0 text-right text-xs font-medium ${deltaColor}`}>
          {deltaLabel}
        </div>
      )}
    </div>
  );
}

function PMRoleBalance({
  categoryTotals,
  roleTargets,
}: {
  categoryTotals: CategoryTotal[];
  roleTargets: RoleTargets;
}) {
  const hasTargets = Object.keys(roleTargets).length > 0;
  const totalMinutes = categoryTotals.reduce((s, c) => s + c.minutes, 0);

  if (!hasTargets) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Set targets in Settings to see balance against your role goals.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {categoryTotals
        .filter((c) => c.minutes > 0)
        .map((c) => {
          const actualPct =
            totalMinutes > 0 ? (c.minutes / totalMinutes) * 100 : 0;
          const targetPct =
            roleTargets[c.category as keyof RoleTargets];
          return (
            <RoleBalanceRow
              key={c.category}
              name={c.name}
              slug={c.category}
              color={c.color}
              actualPct={actualPct}
              targetPct={targetPct}
            />
          );
        })}
    </div>
  );
}

// ---- Work Pattern Insights ----

interface Insight {
  type: "warn" | "good" | "info";
  text: string;
}

function deriveInsights(data: TrendsData): Insight[] {
  const insights: Insight[] = [];
  const totalMinutes = data.category_totals.reduce(
    (s, c) => s + c.minutes,
    0
  );
  if (totalMinutes === 0) return insights;

  const activeDays = data.daily_totals.filter((d) => d.hours > 0).length;
  if (activeDays < 2) return insights;

  function pct(slug: string): number {
    const cat = data.category_totals.find((c) => c.category === slug);
    return cat ? (cat.minutes / totalMinutes) * 100 : 0;
  }

  const commPct = Math.round(pct("communication"));
  const stratPct = Math.round(pct("strategy"));
  const reqPct = Math.round(pct("requirements"));
  const highLeveragePct = stratPct + reqPct;

  if (commPct > 40) {
    insights.push({
      type: "warn",
      text: `High communication week - ${commPct}% of tracked time in meetings and stakeholder work`,
    });
  }

  if (highLeveragePct > 50) {
    insights.push({
      type: "good",
      text: `Strong strategic focus - ${highLeveragePct}% in high-leverage work`,
    });
  } else if (highLeveragePct < 20) {
    insights.push({
      type: "warn",
      text: `Low strategic work - only ${highLeveragePct}% in strategy and requirements`,
    });
  }

  if (data.period === "month" && data.total_hours > 45) {
    insights.push({
      type: "info",
      text: `You tracked ${Math.round(data.total_hours)}h this month - your most active period`,
    });
  }

  if (data.avg_hours_per_day > 7) {
    insights.push({
      type: "warn",
      text: `Averaging ${data.avg_hours_per_day.toFixed(1)}h/day - watch for burnout signals`,
    });
  } else if (data.avg_hours_per_day < 3) {
    insights.push({
      type: "info",
      text: `Light week - only ${data.avg_hours_per_day.toFixed(1)}h/day tracked on average`,
    });
  }

  return insights;
}

function InsightIcon({ type }: { type: Insight["type"] }) {
  if (type === "warn") return <span className="text-amber-500">⚠</span>;
  if (type === "good") return <span className="text-green-500">✓</span>;
  return <span className="text-blue-400">●</span>;
}

// ---- Main Page ----

export default function TrendsPage() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const [heatmapData, setHeatmapData] = useState<HourlyHeatmapCell[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [roleTargets, setRoleTargets] = useState<RoleTargets>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trends?period=${period}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [period]);

  const fetchHeatmap = useCallback(async () => {
    setHeatmapLoading(true);
    try {
      const days = period === "week" ? 7 : 28;
      const res = await fetch(`/api/insights?heatmap=true&days=${days}`);
      if (res.ok) {
        const json = await res.json();
        setHeatmapData(json.hourly_heatmap ?? []);
      }
    } finally {
      setHeatmapLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
    fetchHeatmap();
  }, [fetchData, fetchHeatmap]);

  // Fetch role targets once
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.role_targets) setRoleTargets(s.role_targets);
      })
      .catch(() => {});
  }, []);

  const insights = data ? deriveInsights(data) : [];
  const activeDays = data
    ? data.daily_totals.filter((d) => d.hours > 0).length
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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
              <h1 className="text-lg font-semibold">Trends</h1>
            </div>
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-0.5">
            <button
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                period === "week"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPeriod("week")}
            >
              Week
            </button>
            <button
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                period === "month"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPeriod("month")}
            >
              Month
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <SummaryCard
                icon={<Clock className="size-4" />}
                label="Total Time"
                value={data ? formatMinutes(data.total_hours * 60) : "--"}
                info="Deduplicated work time for the period. Overlapping sources count once, not twice."
              />
              <SummaryCard
                icon={<MessageSquare className="size-4" />}
                label="Total Prompts"
                value={data?.total_prompts?.toString() ?? "--"}
                info="Number of Claude Code prompts sent during this period."
              />
              <SummaryCard
                icon={<TrendingUp className="size-4" />}
                label="Avg / Active Day"
                value={
                  data ? formatMinutes(data.avg_hours_per_day * 60) : "--"
                }
                info="Average tracked time per day that had at least one activity - excludes days with no data."
              />
            </>
          )}
        </div>

        {loading && (
          <div className="grid gap-4 lg:grid-cols-1">
            <Card>
              <CardHeader>
                <div className="h-5 w-28 rounded bg-muted animate-pulse" />
              </CardHeader>
              <CardContent>
                <div className="h-56 rounded-lg bg-muted animate-pulse" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="h-5 w-40 rounded bg-muted animate-pulse" />
              </CardHeader>
              <CardContent>
                <div className="h-64 rounded-lg bg-muted animate-pulse" />
              </CardContent>
            </Card>
          </div>
        )}

        {data && !loading && data.total_prompts > 0 && (
          <>
            {/* Daily Hours Area Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Daily Hours
                  <InfoTooltip text="Deduplicated work time per day. Each bar is your total tracked time with overlaps removed." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily_totals}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={shortDate}
                        fontSize={11}
                      />
                      <YAxis
                        fontSize={11}
                        tickFormatter={(v) => `${v}h`}
                      />
                      <Tooltip
                        labelFormatter={(label) => shortDate(String(label))}
                        formatter={(value) => [
                          `${Number(value).toFixed(1)}h`,
                          "Hours",
                        ]}
                        {...TOOLTIP_STYLE}
                      />
                      <Area
                        type="monotone"
                        dataKey="hours"
                        fill="var(--color-primary)"
                        fillOpacity={0.15}
                        stroke="var(--color-primary)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Category Totals Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Time by Category ({period === "week" ? "7 days" : "30 days"})
                  <InfoTooltip text="Cumulative time per PM category over the period. Each category is deduplicated - no double-counting across sources." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.category_totals}
                      layout="vertical"
                      margin={{ left: 0, right: 16 }}
                    >
                      <XAxis
                        type="number"
                        tickFormatter={(v) => formatMinutes(v)}
                        fontSize={11}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={180}
                        fontSize={11}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value) => formatMinutes(Number(value))}
                        {...TOOLTIP_STYLE}
                      />
                      <Bar dataKey="minutes" radius={[0, 4, 4, 0]}>
                        {data.category_totals.map((entry) => (
                          <Cell key={entry.category} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Hourly Activity Heatmap */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Hourly Activity Heatmap
                  <InfoTooltip text="When you work, by hour and day of week. Color intensity = minutes. Color = dominant category." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {heatmapLoading ? (
                  <div className="h-40 rounded-lg bg-muted animate-pulse" />
                ) : (
                  <HourlyHeatmap cells={heatmapData} />
                )}
              </CardContent>
            </Card>

            {/* PM Role Balance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  PM Role Balance
                  <InfoTooltip text="Your actual time allocation vs targets. Set targets in Settings to track balance." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PMRoleBalance
                  categoryTotals={data.category_totals}
                  roleTargets={roleTargets}
                />
              </CardContent>
            </Card>

            {/* Work Pattern Insights */}
            {insights.length > 0 && activeDays >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Work Pattern Insights</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.map((ins, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <InsightIcon type={ins.type} />
                        <span>{ins.text}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {data && data.total_prompts === 0 && !loading && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No data for this {period}. Start using Claude Code to track
                your PM work.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  info,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  info?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {label}
            {info && <InfoTooltip text={info} />}
          </div>
          <p className="text-lg font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-muted animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          <div className="h-5 w-10 rounded bg-muted animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
