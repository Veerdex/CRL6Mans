import { PoolSkeleton } from "./pool-section";

export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <p className="text-sm text-zinc-400 text-center">Every player in the season, as they come off the real draft.</p>
      <PoolSkeleton />
    </div>
  );
}
