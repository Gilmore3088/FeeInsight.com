import { notFound } from "next/navigation";
import { loadAnalysisRecord } from "@/app/pro/(hamilton)/analyze/actions";
import { PeerListView } from "@/components/hamilton/analyze/PeerListView";
import type { PeerListData, PeerListResponse } from "@/lib/hamilton/peer-list";
import type { AnalyzeResponse } from "@/lib/hamilton/types";

/** Only the user who saved this historical snapshot can reopen it. */
export default async function SavedPeerResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // loadAnalysisRecord filters by current user_id and status='active'.
  const record = await loadAnalysisRecord(id);
  const saved = record?.responseJson as (AnalyzeResponse & { peerListSnapshot?: PeerListData }) | undefined;
  const data = saved?.peerListSnapshot;
  if (!record || !data || data.version !== 1 || data.status !== "ready" || !data.subject ||
      String(data.subject.institutionId) !== record.institutionId || !Array.isArray(data.rows))
    notFound();
  const response: PeerListResponse = { kind: "peer_list", shortAnswer: saved?.hamiltonView ?? "Saved peer research", peerList: data };
  return <div className="mx-auto w-full max-w-6xl px-4 py-6">
    <p className="mb-3 text-sm text-warm-700">Saved research snapshot — historical peer and fee evidence, not a refreshed market lookup.</p>
    <PeerListView response={response} savedQuestion={typeof record.prompt === "string" ? record.prompt : ""} />
  </div>;
}
