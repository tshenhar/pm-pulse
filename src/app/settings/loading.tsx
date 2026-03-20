import { Card, CardContent, CardHeader } from "@/components/ui/card";

function SkeletonPulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

export default function SettingsLoading() {
  const heights = [96, 120, 140, 112, 80, 80, 80, 96, 80];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                P
              </div>
              <SkeletonPulse className="h-5 w-20" />
            </div>
          </div>
          <SkeletonPulse className="h-8 w-20 rounded-md" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-6 space-y-6">
        {heights.map((h, i) => (
          <Card key={i}>
            <CardHeader>
              <SkeletonPulse className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div
                className="rounded-lg bg-muted animate-pulse"
                style={{ height: h }}
              />
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
