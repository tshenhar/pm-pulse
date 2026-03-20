import { Card, CardContent, CardHeader } from "@/components/ui/card";

function SkeletonPulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

export default function TrainingLoading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                P
              </div>
              <SkeletonPulse className="h-5 w-24" />
            </div>
          </div>
          <SkeletonPulse className="h-8 w-28 rounded-md" />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <SkeletonPulse className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              <SkeletonPulse className="h-4 w-full" />
              <SkeletonPulse className="h-4 w-3/4" />
              <div className="flex gap-2 pt-1">
                <SkeletonPulse className="h-7 w-20 rounded-md" />
                <SkeletonPulse className="h-7 w-20 rounded-md" />
                <SkeletonPulse className="h-7 w-20 rounded-md" />
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
