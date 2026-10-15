/** The page's shape while it loads: header, three cards and the table, with the panel beside them from lg up. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-page animate-pulse px-4 py-8 sm:px-6 sm:py-10">
      <div className="grid gap-y-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="lg:col-start-1 lg:row-start-1">
          <div className="h-3 w-40 rounded bg-surface-200" />
          <div className="mt-3 h-8 w-full max-w-xl rounded bg-surface-200" />
          <div className="mt-3 h-4 w-full max-w-md rounded bg-surface-200" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:col-start-1 lg:row-start-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl border border-border/80 bg-surface-0" />
          ))}
        </div>
        <div className="h-96 rounded-2xl border border-border/80 bg-surface-0 lg:col-start-2 lg:row-span-4 lg:row-start-1" />
        <div className="h-[32rem] rounded-xl border border-border/80 bg-surface-0 lg:col-start-1 lg:row-start-3" />
      </div>
    </div>
  );
}
