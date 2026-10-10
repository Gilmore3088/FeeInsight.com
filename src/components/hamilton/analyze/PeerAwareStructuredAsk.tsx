"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  isPeerListQuestion, isPeerListContinuationQuestion, makePeerListContinuation,
  type PeerListContinuation, type PeerListResponse,
} from "@/lib/hamilton/peer-list";
import { StructuredAsk } from "./StructuredAsk";
import { PeerListView } from "./PeerListView";

type Props = ComponentProps<typeof StructuredAsk>;

/** The answer is list-aware within a conversation; no second input or paid fallback. */
export function PeerAwareStructuredAsk(props: Props) {
  // This snapshot participates in rendering. Queue it before exposing the answer
  // or notifying the parent so an immediate next turn receives the same peers.
  const [continuation, setContinuation] = useState<{ snapshot: PeerListContinuation; answeredNonce: number; answeredQuestion: Props["question"] } | null>(null);
  const isNewList = Boolean(props.question && isPeerListQuestion(props.question));
  const isFollowUp = Boolean(props.question && !isNewList && isPeerListContinuationQuestion(props.question));

  const remember = useCallback((data: PeerListResponse, previous: PeerListContinuation | null) => {
    if (data.peerList.status !== "ready") return;
    if (previous) {
      setContinuation({ snapshot: { ...previous, selectedIds: data.peerList.rows.map(row => row.institutionId) }, answeredNonce: props.nonce ?? 0, answeredQuestion: props.question });
    } else if (props.question) {
      const snapshot = makePeerListContinuation(data, props.question, props.institutionId);
      if (snapshot) setContinuation({ snapshot, answeredNonce: props.nonce ?? 0, answeredQuestion: props.question });
    }
  }, [props.question, props.institutionId, props.nonce]);

  if (!isNewList && !isFollowUp) return <StructuredAsk {...props} />;
  // A resolved follow-up re-renders with its own snapshot. Keep its mounted
  // request visible; the frozen submittedPrior still owns that request body.
  const isCurrentAnswer = continuation?.answeredNonce === (props.nonce ?? 0) && continuation?.answeredQuestion === props.question;
  if (isFollowUp && (!continuation || (!isCurrentAnswer && continuation.answeredNonce + 1 !== (props.nonce ?? 0)) || continuation.snapshot.originInstitutionId !== props.institutionId)) {
    return <p role="alert" className="text-sm text-warm-800">Ask for a peer list first. This question cannot borrow an old or different institution’s peers.</p>;
  }
  return <PeerListRequest
    key={JSON.stringify([props.institutionId, props.question, props.nonce])}
    {...props}
    previousPeerList={isFollowUp ? continuation?.snapshot ?? null : null}
    onResolved={remember}
  />;
}
function PeerListRequest({
  question, institutionId, onBusyChange, onLead, previousPeerList, onResolved,
}: Props & {
  previousPeerList: PeerListContinuation | null;
  onResolved: (data: PeerListResponse, previous: PeerListContinuation | null) => void;
}) {
  // Freeze the submitted context for this question, even after the next list
  // updates the parent. Avoid replaying a request or silently changing its peers.
  const [submittedPrior] = useState(previousPeerList);
  const [response, setResponse] = useState<PeerListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    onBusyChange?.(true);
    setResponse(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/hamilton/ask", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, institutionId, ...(submittedPrior ? { previousPeerList: submittedPrior } : {}) }), signal: controller.signal,
        });
        if (!response.ok) throw new Error("Peer list request failed");
        const data = await response.json() as PeerListResponse;
        if (data.kind !== "peer_list" || data.peerList?.version !== 1 || !Array.isArray(data.peerList.rows)) throw new Error("Unexpected peer list response");
        if (!current) return;
        // Commit the parent conversation snapshot before revealing the table, so
        // an immediate next question has its exact peer IDs and dated sources.
        onResolved(data, submittedPrior);
        setResponse(data);
        onLead?.(data.shortAnswer);
      } catch {
        if (current) setError("The peer list could not be loaded. Retry it; no report or paid fallback was started.");
      } finally { if (current) onBusyChange?.(false); }
    })();
    return () => { current = false; controller.abort(); onBusyChange?.(false); };
  }, [question, institutionId, onBusyChange, onLead, onResolved, retry, submittedPrior]);
  if (error) return <div role="alert" className="text-sm text-terra-text"><p>{error}</p><button type="button" onClick={() => setRetry(n => n + 1)} className="mt-2 min-h-11 rounded-md border border-warm-300 px-3">Retry peer list</button></div>;
  if (response) return <PeerListView response={response} />;
  return onBusyChange ? null : <p role="status" className="text-sm text-warm-700">Loading matching institutions and dated assets…</p>;
}
