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

export default function TrendsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                P
              </div>
              <SkeletonPulse className="h-5 w-16" />
            </div>
          </div>
          <SkeletonPulse className="h-8 w-32 rounded-lg" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
        </div>

        <Card>
          <CardHeader>
            <SkeletonPulse className="h-5 w-28" />
          </CardHeader>
          <CardContent>
            <SkeletonPulse className="h-56" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SkeletonPulse className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <SkeletonPulse className="h-64" />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
