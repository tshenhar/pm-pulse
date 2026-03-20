"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar,
  BrainCircuit,
  TrendingUp,
  TrendingDown,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shiftDate, currentWorkday } from "@/lib/date-utils";
import type { DigestData, DigestCategoryBreakdown } from "@/lib/types";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatHours(hours: number): string {
  return formatMinutes(hours * 60);
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// Find the Monday of the week that contains today's workday
function currentWeekMonday(): string {
  const today = currentWorkday();
  const d = new Date(today + "T12:00:00");
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  return mon.toISOString().slice(0, 10);
}

function heatmapColor(hours: number): string {
  if (hours === 0) return "bg-muted text-muted-foreground";
  if (hours < 2) return "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";
  if (hours < 4) return "bg-indigo-200 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
  if (hours < 6) return "bg-indigo-400 text-white";
  return "bg-indigo-600 text-white";
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
        positive
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
          : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
      }`}
    >
      {positive ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {positive ? "+" : ""}
      {Math.abs(Math.round(delta * 10) / 10)}h
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-4 pb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-lg font-semibold leading-tight">{value}</p>
            {delta !== undefined && <DeltaBadge delta={delta} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-4 pb-4">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-muted animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          <div className="h-5 w-12 rounded bg-muted animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function DigestPage() {
  // Use the Sunday of the current week as end_date for the API
  // API will compute Mon-Sun from end_date
  const [weekAnchor, setWeekAnchor] = useState<string>(() => {
    const mon = currentWeekMonday();
    // end_date = Sunday of that week
    return shiftDate(mon, 6);
  });
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);

  const todaySunday = shiftDate(currentWeekMonday(), 6);
  const isCurrentWeek = weekAnchor >= todaySunday;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/digest?end_date=${weekAnchor}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [weekAnchor]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const goBack = () => setWeekAnchor((prev) => shiftDate(prev, -7));
  const goForward = () => {
    if (!isCurrentWeek) setWeekAnchor((prev) => shiftDate(prev, 7));
  };

  const weekLabel =
    data
      ? `Week of ${shortDate(data.this_week.start)} – ${shortDate(data.this_week.end)}`
      : loading
        ? "Loading..."
        : `Week of ${shortDate(shiftDate(weekAnchor, -6))} – ${shortDate(weekAnchor)}`;

  const hoursDelta =
    data ? data.this_week.total_hours - data.last_week.total_hours : 0;
  const meetingDelta =
    data ? data.this_week.meeting_hours - data.last_week.meeting_hours : 0;
  const focusDelta =
    data ? data.this_week.focus_hours - data.last_week.focus_hours : 0;

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
              <h1 className="text-lg font-semibold">Weekly Digest</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={goBack}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium min-w-[220px] text-center">
              {weekLabel}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={goForward}
              disabled={isCurrentWeek}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <SummaryCard
                icon={<Clock className="size-4" />}
                label="Total Time"
                value={data ? formatHours(data.this_week.total_hours) : "--"}
                delta={hoursDelta}
              />
              <SummaryCard
                icon={<Calendar className="size-4" />}
                label="Meetings"
                value={data ? formatHours(data.this_week.meeting_hours) : "--"}
                delta={meetingDelta}
              />
              <SummaryCard
                icon={<BrainCircuit className="size-4" />}
                label="Focus Time"
                value={data ? formatHours(data.this_week.focus_hours) : "--"}
                delta={focusDelta}
              />
              <SummaryCard
                icon={<TrendingUp className="size-4" />}
                label="Events"
                value={data ? data.this_week.total_events.toString() : "--"}
              />
            </>
          )}
        </div>

        {/* Narrative */}
        {!loading && data && data.narrative.length > 0 && (
          <Card>
            <CardContent className="py-4 px-5">
              <div className="space-y-1">
                {data.narrative.map((line, i) => (
                  <p
                    key={i}
                    className="text-sm italic text-muted-foreground leading-relaxed"
                  >
                    {line}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Day Heatmap */}
        {!loading && data && (
          <Card>
            <CardHeader>
              <CardTitle>Daily Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {data.daily_hours.map(({ date, hours }) => (
                  <div key={date} className="flex flex-col items-center gap-1">
                    <div
                      className={`flex h-14 w-full items-center justify-center rounded-lg text-sm font-semibold transition-colors ${heatmapColor(hours)}`}
                    >
                      {hours > 0 ? `${hours.toFixed(1)}h` : "–"}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {dayLabel(date)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {shortDate(date).replace(/[A-Za-z]+ /, "")}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {loading && (
          <Card>
            <CardHeader>
              <div className="h-5 w-28 rounded bg-muted animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="h-20 rounded-lg bg-muted animate-pulse" />
            </CardContent>
          </Card>
        )}

        {/* Category Breakdown */}
        {!loading && data && data.category_breakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">
                      Category
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      This Week
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Last Week
                    </th>
                    <th className="px-5 py-2 text-right font-medium">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {data.category_breakdown.map((row: DigestCategoryBreakdown) => (
                    <tr
                      key={row.category}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatMinutes(row.this_week_minutes)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {row.last_week_minutes > 0
                          ? formatMinutes(row.last_week_minutes)
                          : "–"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        <span
                          className={
                            row.delta_minutes > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : row.delta_minutes < 0
                                ? "text-red-500 dark:text-red-400"
                                : "text-muted-foreground"
                          }
                        >
                          {row.delta_minutes > 0 ? "+" : ""}
                          {row.delta_minutes !== 0
                            ? formatMinutes(Math.abs(row.delta_minutes))
                            : "–"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Superlatives */}
        {!loading &&
          data &&
          (data.superlatives.longest_focus ||
            data.superlatives.busiest_meeting_day) && (
            <Card>
              <CardHeader>
                <CardTitle>Highlights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.superlatives.longest_focus && (
                  <div className="flex items-start gap-3 rounded-lg bg-muted/50 px-4 py-3">
                    <BrainCircuit className="size-4 mt-0.5 text-indigo-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Longest Focus Block</p>
                      <p className="text-xs text-muted-foreground">
                        {formatMinutes(data.superlatives.longest_focus.minutes)}{" "}
                        in {data.superlatives.longest_focus.app} on{" "}
                        {shortDate(data.superlatives.longest_focus.date)}
                      </p>
                    </div>
                  </div>
                )}
                {data.superlatives.busiest_meeting_day && (
                  <div className="flex items-start gap-3 rounded-lg bg-muted/50 px-4 py-3">
                    <Calendar className="size-4 mt-0.5 text-blue-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Busiest Meeting Day</p>
                      <p className="text-xs text-muted-foreground">
                        {data.superlatives.busiest_meeting_day.meetings} meeting
                        {data.superlatives.busiest_meeting_day.meetings !== 1
                          ? "s"
                          : ""}{" "}
                        on{" "}
                        {shortDate(data.superlatives.busiest_meeting_day.date)}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

        {!loading && data && data.this_week.total_events === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No activity tracked for this week yet.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
