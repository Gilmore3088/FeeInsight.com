export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="admin-card overflow-hidden">
      <div className="border-b bg-gray-50/80 dark:bg-white/[0.03] px-4 py-3 flex gap-6">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton
                key={j}
                className={`h-3.5 ${j === 0 ? "w-32" : j === 1 ? "w-40" : "w-16"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="admin-card p-4 space-y-3">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </div>
  );
}
