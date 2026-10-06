"use client";

import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  buildHistogramBuckets,
  bucketFor,
  type HistogramBucket,
  type HistogramPoint,
} from "@/lib/fee-histogram-buckets";

interface FeeHistogramProps {
  /** One point per institution: the value the index counts for it. */
  points: HistogramPoint[];
  median: number | null;
  /**
   * Clicking a bar opens this URL (the Institutions tab) with the bar's amounts added
   * as `min` and `max`.
   */
  drillDownBase?: string;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: HistogramBucket; name: string; value: number }[];
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;

  return (
    <div className="rounded-lg border bg-white dark:bg-[oklch(0.24_0_0)] dark:border-white/[0.1] px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-gray-900 dark:text-gray-100 mb-1">{d.label}</p>
      <div className="flex flex-col gap-0.5 text-gray-600">
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />
          Banks: {d.banks}
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />
          Credit Unions: {d.creditUnions}
        </span>
        <span className="font-semibold text-gray-900 mt-0.5">
          Total: {d.total}
        </span>
        {d.total > 0 && <span className="text-blue-600 mt-0.5">Click to see who</span>}
      </div>
    </div>
  );
}

export function FeeHistogram({ points, median, drillDownBase }: FeeHistogramProps) {
  const router = useRouter();
  const buckets = buildHistogramBuckets(points);

  if (buckets.length === 0) return null;

  const medianBucket = median !== null ? bucketFor(buckets, median) : undefined;
  const open = (bucket: HistogramBucket | undefined) => {
    if (!bucket || bucket.total === 0 || !drillDownBase) return;
    const params = new URLSearchParams();
    if (bucket.min !== null) params.set("min", String(bucket.min));
    if (bucket.max !== null) params.set("max", String(Math.round(bucket.max * 100) / 100));
    router.push(`${drillDownBase}${drillDownBase.includes("?") ? "&" : "?"}${params}`);
  };

  return (
    <div className="admin-card mb-6">
      <div className="px-4 py-3 border-b bg-gray-50 dark:bg-white/[0.03] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Fee Distribution
          <span className="ml-2 text-xs font-normal text-gray-400">
            one bar count per institution, at the value the index counts
          </span>
        </h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />
            Banks
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />
            CUs
          </span>
          {median !== null && (
            <span>
              <span className="inline-block w-3 border-t-2 border-dashed border-red-400 mr-1 align-middle" />
              Median
            </span>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={buckets}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="15%"
          >
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
            />
            {median !== null && medianBucket && (
              <ReferenceLine
                x={medianBucket.label}
                stroke="#f87171"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{
                  value: `Median $${median.toFixed(2)}`,
                  position: "top",
                  fill: "#ef4444",
                  fontSize: 10,
                }}
              />
            )}
            <Bar
              dataKey="banks"
              stackId="a"
              fill="#3b82f6"
              radius={[0, 0, 0, 0]}
              cursor={drillDownBase ? "pointer" : undefined}
              onClick={(data: { payload?: HistogramBucket }) => open(data?.payload)}
            />
            <Bar
              dataKey="creditUnions"
              stackId="a"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              cursor={drillDownBase ? "pointer" : undefined}
              onClick={(data: { payload?: HistogramBucket }) => open(data?.payload)}
            />
          </BarChart>
        </ResponsiveContainer>
        {drillDownBase && (
          <p className="mt-1 text-xs text-gray-400">Click a bar to list every institution in that range.</p>
        )}
      </div>
    </div>
  );
}
