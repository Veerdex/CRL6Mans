// Shown the moment a dashboard tab is clicked, while its server render runs.
// Tabs with their own loading.tsx (the fantasy league tabs) override it.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-48 mx-auto rounded-lg bg-zinc-800" />
        <div className="h-32 rounded-xl bg-zinc-800 border border-zinc-700" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-40 rounded-xl bg-zinc-800 border border-zinc-700" />
          <div className="h-40 rounded-xl bg-zinc-800 border border-zinc-700" />
        </div>
      </div>
    </div>
  );
}
