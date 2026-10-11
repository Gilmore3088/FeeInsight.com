import Link from "next/link";
export function CreateBoardBriefButton({ analysisId }: { analysisId: string }) {
  return <Link className="inline-flex min-h-11 items-center rounded-md bg-terra px-4 py-2 text-sm font-medium text-white no-underline" href={`/pro/reports?from_analysis=${encodeURIComponent(analysisId)}`}>Create board brief →</Link>;
}
