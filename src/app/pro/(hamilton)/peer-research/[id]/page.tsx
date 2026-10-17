import { notFound } from "next/navigation";
import { loadAnalysisRecord } from "@/app/pro/(hamilton)/analyze/actions";
import { PeerListView } from "@/components/hamilton/analyze/PeerListView";
import { LocalDate } from "@/components/hamilton/common/LocalDate";
import { LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";
import type { PeerListData, PeerListResponse } from "@/lib/hamilton/peer-list";
import type { AnalyzeResponse } from "@/lib/hamilton/types";

const SAVED_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

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
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const savedOn = record.savedAt ?? data.queriedAt ?? null;
  // A peer list is a lookup, not a written answer, so asking it again costs nothing.
  const rerunHref = prompt && record.institutionId
    ? `/pro/analyze?${new URLSearchParams({ q: prompt.slice(0, 500), instId: record.institutionId, send: "1" })}`
    : null;
  return (
    <MemoPage>
      <MemoHeader
        kicker="Saved peer research"
        title={prompt || "Saved peer research"}
        compact={prompt.length > 120}
        dek={<>
          {savedOn ? <>Saved research from <LocalDate iso={savedOn} options={SAVED_DATE} />. </> : "Saved research. "}
          It shows the peers and fees as they were on that date.
        </>}
        actions={rerunHref ? <LinkButton href={rerunHref} primary>Run this question again</LinkButton> : undefined}
      />
      <PeerListView response={response} savedQuestion={prompt} />
    </MemoPage>
  );
}
