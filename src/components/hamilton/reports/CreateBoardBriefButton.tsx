import Link from "next/link";
export function CreateBoardBriefButton({ analysisId }: { analysisId: string }) {
  return <Link className="fi-btn fi-btn-primary min-h-11 no-underline" href={`/pro/reports?from_analysis=${encodeURIComponent(analysisId)}`}>Create board brief</Link>;
}
