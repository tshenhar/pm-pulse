"use client";

import { useEffect, useState, useCallback } from "react";
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

export default function TrendsPage() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trends?period=${period}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
              <CardHeader><div className="h-5 w-28 rounded bg-muted animate-pulse" /></CardHeader>
              <CardContent><div className="h-56 rounded-lg bg-muted animate-pulse" /></CardContent>
            </Card>
            <Card>
              <CardHeader><div className="h-5 w-40 rounded bg-muted animate-pulse" /></CardHeader>
              <CardContent><div className="h-64 rounded-lg bg-muted animate-pulse" /></CardContent>
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
