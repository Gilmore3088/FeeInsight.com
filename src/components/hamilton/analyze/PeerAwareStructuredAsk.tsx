"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { isPeerListQuestion, type PeerListResponse } from "@/lib/hamilton/peer-list";
import { StructuredAsk } from "./StructuredAsk";
import { PeerListView } from "./PeerListView";

type Props = ComponentProps<typeof StructuredAsk>;
/** Select the list task before the legacy local-market/fee/narrative paths. */
export function PeerAwareStructuredAsk(props: Props) {
  if (!props.question || !isPeerListQuestion(props.question)) return <StructuredAsk {...props} />;
  return <PeerListRequest key={JSON.stringify([props.institutionId, props.question, props.nonce])} {...props} />;
}
function PeerListRequest({ question, institutionId, onBusyChange, onLead }: Props) {
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
          body: JSON.stringify({ question, institutionId }), signal: controller.signal,
        });
        if (!response.ok) throw new Error("Peer list request failed");
        const data = await response.json() as PeerListResponse;
        if (data.kind !== "peer_list" || data.peerList?.version !== 1 || !Array.isArray(data.peerList.rows)) throw new Error("Unexpected peer list response");
        if (!current) return;
        setResponse(data);
        onLead?.(data.shortAnswer);
      } catch {
        if (current) setError("The peer list could not be loaded. Retry it; no report or paid fallback was started.");
      } finally { if (current) onBusyChange?.(false); }
    })();
    return () => { current = false; controller.abort(); onBusyChange?.(false); };
  }, [question, institutionId, onBusyChange, onLead, retry]);
  if (error) return <div role="alert" className="text-sm text-terra-text"><p>{error}</p><button type="button" onClick={() => setRetry(n => n + 1)} className="mt-2 min-h-11 rounded-md border border-warm-300 px-3">Retry peer list</button></div>;
  if (response) return <PeerListView response={response} />;
  return onBusyChange ? null : <p role="status" className="text-sm text-warm-700">Loading matching institutions and dated assets…</p>;
}
