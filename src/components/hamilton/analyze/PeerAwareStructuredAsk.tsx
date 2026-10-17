"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  isPeerListQuestion, isPeerListContinuationQuestion, makePeerListContinuation, peerListFeeFollowUp,
  type PeerListContinuation, type PeerListResponse,
} from "@/lib/hamilton/peer-list";
import type { ActivePeerSet } from "@/lib/hamilton/conversation-state";
import { StructuredAsk } from "./StructuredAsk";
import { PeerListView } from "./PeerListView";

type Props = ComponentProps<typeof StructuredAsk> & {
  /**
   * The conversation's active peer list (#979, H04-T05). When the page passes `onPeerSet`, the
   * list lives in the page's conversation state, so a reload or reopened answer keeps it;
   * otherwise this component keeps it for the conversation it is mounted for.
   */
  peerSet?: ActivePeerSet | null;
  onPeerSet?: (value: ActivePeerSet) => void;
};

/** The answer is list-aware within a conversation; no second input or paid fallback. */
export function PeerAwareStructuredAsk({ peerSet, onPeerSet, ...props }: Props) {
  // This snapshot participates in rendering. Queue it before exposing the answer
  // or notifying the parent so an immediate next turn receives the same peers.
  const [ownContinuation, setOwnContinuation] = useState<ActivePeerSet | null>(null);
  const continuation = onPeerSet ? peerSet ?? null : ownContinuation;
  const setContinuation = onPeerSet ?? setOwnContinuation;
  const isNewList = Boolean(props.question && isPeerListQuestion(props.question));
  const isFollowUp = Boolean(props.question && !isNewList && isPeerListContinuationQuestion(props.question));

  const remember = useCallback((data: PeerListResponse, previous: PeerListContinuation | null) => {
    if (data.peerList.status !== "ready") return;
    if (previous) {
      setContinuation({ snapshot: { ...previous, selectedIds: data.peerList.rows.map(row => row.institutionId) }, answeredNonce: props.nonce ?? 0, answeredQuestion: props.question ?? "" });
    } else if (props.question) {
      const snapshot = makePeerListContinuation(data, props.question, props.institutionId);
      if (snapshot) setContinuation({ snapshot, answeredNonce: props.nonce ?? 0, answeredQuestion: props.question });
    }
  }, [props.question, props.institutionId, props.nonce, setContinuation]);

  if (!isNewList && !isFollowUp) return <StructuredAsk {...props} />;
  // A resolved follow-up re-renders with its own snapshot. Keep its mounted
  // request visible; the frozen submittedPrior still owns that request body.
  const isCurrentAnswer = continuation?.answeredNonce === (props.nonce ?? 0) && continuation?.answeredQuestion === props.question;
  if (isFollowUp && (!continuation || (!isCurrentAnswer && continuation.answeredNonce + 1 !== (props.nonce ?? 0)) || continuation.snapshot.originInstitutionId !== props.institutionId)) {
    // "Compare with us" without a usable list still asks the server, which says from the account
    // alone whether there is an institution to be "us". No list or old peers are sent.
    if (props.question && peerListFeeFollowUp(props.question) === "with_account") {
      return <PeerListRequest
        key={JSON.stringify([props.institutionId, props.question, props.nonce, "no-list"])}
        {...props}
        previousPeerList={null}
        withoutList
        onResolved={remember}
      />;
    }
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
  question, institutionId, onBusyChange, onLead, onAnswered, previousPeerList, withoutList = false, onResolved,
}: Props & {
  previousPeerList: PeerListContinuation | null;
  withoutList?: boolean;
  onResolved: (data: PeerListResponse, previous: PeerListContinuation | null) => void;
}) {
  // Freeze the submitted context for this question, even after the next list
  // updates the parent. Avoid replaying a request or silently changing its peers.
  const [submittedPrior] = useState(previousPeerList);
  const [response, setResponse] = useState<PeerListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // The page of a new list (#977, H02-T08). A follow-up answers from the displayed rows and has no pages.
  const [offset, setOffset] = useState(0);
  const [paging, setPaging] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    onBusyChange?.(true);
    // Turning a page keeps the current table on screen until the next page arrives.
    if (offset === 0) setResponse(null);
    setPaging(offset > 0);
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/hamilton/ask", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, institutionId, ...(submittedPrior ? { previousPeerList: submittedPrior } : withoutList ? { previousPeerList: null } : offset > 0 ? { peerListOffset: offset } : {}) }), signal: controller.signal,
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
        onAnswered?.({ route: "peer_list", decisionId: null, feeCategory: null, savedAnalysisId: null });
      } catch {
        if (current) setError("The peer list could not be loaded. Retry it; no report or paid fallback was started.");
      } finally { if (current) { onBusyChange?.(false); setPaging(false); } }
    })();
    return () => { current = false; controller.abort(); onBusyChange?.(false); };
    // onAnswered only reports; a new callback must not send the request again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, institutionId, onBusyChange, onLead, onResolved, retry, submittedPrior, withoutList, offset]);
  if (error) return <div role="alert" className="text-sm text-terra-text"><p>{error}</p><button type="button" onClick={() => setRetry(n => n + 1)} className="mt-2 min-h-11 rounded-md border border-warm-300 px-3">Retry peer list</button></div>;
  // A peer request only mounts for a non-empty question; without one there is
  // nothing to save, so render the table read-only rather than save "".
  const shownOffset = response?.peerList.offset ?? 0;
  if (response) return <PeerListView response={response} saveContext={question ? {
    question, institutionId, ...(submittedPrior || withoutList ? { previousPeerList: submittedPrior } : {}), ...(shownOffset > 0 ? { peerListOffset: shownOffset } : {}),
  } : undefined} onPage={submittedPrior || withoutList ? undefined : setOffset} paging={paging} />;
  return onBusyChange ? null : <p role="status" className="text-sm text-warm-700">Loading matching institutions and dated assets…</p>;
}
