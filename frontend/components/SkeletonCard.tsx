export function SkeletonCard() {
  return (
    <div className="glass-card-elevated p-6 animate-pulse">
      <div className="flex justify-between items-start mb-4">
        <div className="space-y-2.5">
          <div className="h-5 w-52 bg-white/[0.06] rounded-lg" />
          <div className="h-3 w-28 bg-white/[0.04] rounded" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="h-6 w-16 bg-white/[0.06] rounded-full" />
          <div className="h-5 w-28 bg-white/[0.04] rounded-full" />
        </div>
      </div>
      <div className="space-y-2 mb-5">
        <div className="h-3 w-full bg-white/[0.04] rounded" />
        <div className="h-3 w-4/5 bg-white/[0.04] rounded" />
      </div>
      <div className="h-3 w-2/3 bg-white/[0.03] rounded mb-5" />
      <div className="flex gap-3">
        <div className="flex-1 h-12 bg-white/[0.04] rounded-xl" />
        <div className="flex-1 h-12 bg-white/[0.04] rounded-xl" />
        <div className="flex-1 h-12 bg-white/[0.04] rounded-xl" />
      </div>
    </div>
  );
}
