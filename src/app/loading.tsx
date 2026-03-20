import { Card, CardContent, CardHeader } from "@/components/ui/card";

function SkeletonPulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

function SummaryCardSkeleton() {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-muted animate-pulse" />
        <div className="space-y-1.5">
          <SkeletonPulse className="h-3 w-16" />
          <SkeletonPulse className="h-5 w-10" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
              P
            </div>
            <SkeletonPulse className="h-5 w-20" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonPulse className="h-8 w-8 rounded-md" />
            <SkeletonPulse className="h-8 w-8 rounded-md" />
            <SkeletonPulse className="h-8 w-8 rounded-md" />
            <SkeletonPulse className="h-8 w-8 rounded-md" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <SkeletonPulse className="h-5 w-64" />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <SkeletonPulse className="h-5 w-36" />
            </CardHeader>
            <CardContent>
              <SkeletonPulse className="h-56" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <SkeletonPulse className="h-5 w-28" />
            </CardHeader>
            <CardContent>
              <SkeletonPulse className="h-56" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <SkeletonPulse className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <SkeletonPulse className="h-4 w-16" />
                <SkeletonPulse className="h-4 flex-1" />
                <SkeletonPulse className="h-5 w-14 rounded-full" />
                <SkeletonPulse className="h-4 w-10" />
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
