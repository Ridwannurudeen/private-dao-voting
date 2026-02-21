export function SkeletonCard() {
  return (
    <div className="glass-card neon-border p-6 animate-pulse">
      <div className="flex justify-between items-start mb-3">
        <div className="space-y-2">
          <div className="h-5 w-48 bg-white/10 rounded" />
          <div className="h-3 w-24 bg-white/5 rounded" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="h-6 w-16 bg-white/10 rounded-full" />
          <div className="h-5 w-28 bg-white/5 rounded-full" />
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-3 w-full bg-white/5 rounded" />
        <div className="h-3 w-3/4 bg-white/5 rounded" />
      </div>
      <div className="h-3 w-2/3 bg-white/5 rounded mb-4" />
      <div className="flex gap-3">
        <div className="flex-1 h-12 bg-white/5 rounded-xl" />
        <div className="flex-1 h-12 bg-white/5 rounded-xl" />
        <div className="flex-1 h-12 bg-white/5 rounded-xl" />
      </div>
    </div>
  );
}
