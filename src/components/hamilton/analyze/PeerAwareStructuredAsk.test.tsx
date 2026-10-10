// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { PeerAwareStructuredAsk } from "./PeerAwareStructuredAsk";
import { PeerListView } from "./PeerListView";
import type { PeerListResponse, PeerListRow } from "@/lib/hamilton/peer-list";

vi.mock("./StructuredAsk", () => ({ StructuredAsk: () => <p>Existing fee-answer path</p> }));
const fetcher = vi.fn();
const fallback = vi.fn();
const lead = vi.fn();
const props = { question: "List ten peers", nonce: 1, institutionId: "101", modelHrefFor: () => "/pro/simulate", onNoStoryline: fallback, onLead: lead };
const peer = (id: number, name: string, assets: number | null): PeerListRow => ({ institutionId: id, name, charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: assets, reportDate: assets === null ? null : "2026-06-30", source: assets === null ? null : "ncua", sourceUrl: null, recordId: assets === null ? null : id, feeCoverage: "not_found", inclusionReason: "Matches the stated criteria." });
const fixture: PeerListResponse = { kind: "peer_list", shortAnswer: "3 of 3 matching institutions for Test CU.", peerList: { version: 1, status: "ready", subject: peer(101, "Test CU", 10_000_000_000), criteria: null, rows: [peer(202, "Alpha CU", 1_000_000_000), peer(203, "Zero CU", 0), peer(204, "Missing CU", null)], totalMatches: 3, queriedAt: "2026-10-10T00:00:00Z", notes: ["Synthetic test data; assets use their stored reporting dates."] } };
const ok = (result = fixture) => ({ ok: true, json: async () => result });
beforeEach(() => { fetcher.mockReset().mockResolvedValue(ok()); fallback.mockReset(); lead.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("peer-first Ask rendering", () => {
  it("renders actual peer rows, assets and dates without the report path or another input", async () => {
    render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: "Alpha CU" }).getAttribute("href")).toBe("/institution/202");
    expect(screen.getByText("$1,000,000,000")).toBeTruthy();
    expect(screen.getAllByText("2026-06-30").length).toBe(2);
    expect(screen.queryByText("Existing fee-answer path")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/hamilton/ask");
  });
  it("distinguishes zero from missing assets and missing fee coverage", async () => {
    render(<PeerAwareStructuredAsk {...props} />); await screen.findByRole("table");
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getAllByText("Not available").length).toBe(2);
    expect(screen.getAllByText("No published fees on file").length).toBe(3);
    expect(screen.queryByText("Free")).toBeNull();
  });
  it("sorts only displayed rows and keeps unknown assets last", () => {
    render(<PeerListView response={fixture} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "assets_asc" } });
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1].textContent).toContain("Zero CU"); expect(rows[3].textContent).toContain("Missing CU");
    expect(fixture.peerList.rows[0].name).toBe("Alpha CU");
  });
  it("keeps a failed list visible and never calls the paid prose fallback", async () => {
    fetcher.mockResolvedValue({ ok: false });
    render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("alert"); expect(fallback).not.toHaveBeenCalled();
    expect(screen.queryByText("Existing fee-answer path")).toBeNull();
    fetcher.mockResolvedValue(ok()); fireEvent.click(screen.getByRole("button", { name: "Retry peer list" }));
    await screen.findByRole("table"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("renders unsupported-criteria guidance without inventing a peer table", async () => {
    fetcher.mockResolvedValue(ok({ ...fixture, shortAnswer: "Choose supported asset criteria.", peerList: { ...fixture.peerList, status: "needs_criteria", rows: [], totalMatches: null } }));
    render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByText("Choose supported asset criteria."); expect(screen.queryByRole("table")).toBeNull(); expect(fallback).not.toHaveBeenCalled();
  });
  it("preserves the existing plain local-competitor view", () => {
    render(<PeerAwareStructuredAsk {...props} question="Who are my local competitors and where are they?" />);
    expect(screen.getByText("Existing fee-answer path")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the legacy path for an explicit fee comparison", () => {
    render(<PeerAwareStructuredAsk {...props} question="Compare our NSF fees with peers" />);
    expect(screen.getByText("Existing fee-answer path")).toBeTruthy(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts the old list request when the institution changes", async () => {
    let release: (value: ReturnType<typeof ok>) => void = () => {};
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<PeerAwareStructuredAsk {...props} institutionId="999" nonce={2} />);
    await screen.findByRole("table"); expect(signal.aborted).toBe(true);
    await act(async () => release(ok({ ...fixture, shortAnswer: "Stale answer must not appear." })));
    expect(screen.queryByText("Stale answer must not appear.")).toBeNull(); expect(lead).toHaveBeenCalledTimes(1);
  });
  it("offers no unsupported export/report action for the new list type", async () => {
    render(<PeerAwareStructuredAsk {...props} />); await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Download|report/i })).toBeNull();
    expect(screen.getByText(/Comparing its fees, saving this list/)).toBeTruthy();
  });
  it("provides a keyboard-focusable horizontal table region", () => {
    render(<PeerListView response={fixture} />);
    expect(screen.getByRole("region", { name: "Peer table; scroll horizontally" }).getAttribute("tabindex")).toBe("0");
  });
});


describe("exact-list follow-ups within one Ask conversation", () => {
  it("retains the exact snapshot when the parent submits a follow-up as soon as the answer resolves", async () => {
    const filtered: PeerListResponse = {
      ...fixture, shortAnswer: "Immediate refinement completed.",
      peerList: { ...fixture.peerList, rows: [fixture.peerList.rows[0]], totalMatches: 1 },
    };
    fetcher.mockReset().mockResolvedValueOnce(ok(fixture)).mockResolvedValueOnce(ok(filtered));
    function ImmediateFollowUp() {
      const [submitted, setSubmitted] = useState({ question: props.question, nonce: props.nonce });
      const onLead = useCallback((answer: string) => {
        if (answer === fixture.shortAnswer) setSubmitted({ question: "Only Florida", nonce: 2 });
      }, []);
      return <PeerAwareStructuredAsk {...props} {...submitted} onLead={onLead} />;
    }
    render(<ImmediateFollowUp />);
    await screen.findByText("Immediate refinement completed.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(body.previousPeerList.selectedIds).toEqual([202, 203, 204]);
    expect(body.previousPeerList.originInstitutionId).toBe("101");
    expect(body.previousPeerList.originRows).toEqual([
      { institutionId: 202, recordId: 202, reportDate: "2026-06-30", source: "ncua" },
      { institutionId: 203, recordId: 203, reportDate: "2026-06-30", source: "ncua" },
      { institutionId: 204, recordId: null, reportDate: null, source: null },
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
  });
  it("sends previously displayed peer IDs and dated record IDs for Only Florida", async () => {
    const filtered: PeerListResponse = {
      ...fixture, shortAnswer: "1 of 3 previously displayed peers are in FL.",
      peerList: { ...fixture.peerList, rows: [fixture.peerList.rows[0]], totalMatches: 1 },
    };
    fetcher.mockReset().mockResolvedValueOnce(ok(fixture)).mockResolvedValueOnce(ok(filtered));
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Only Florida" nonce={2} />);
    await screen.findByText("1 of 3 previously displayed peers are in FL.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(body.question).toBe("Only Florida");
    expect(body.previousPeerList.originQuestion).toBe("List ten peers");
    expect(body.previousPeerList.originInstitutionId).toBe("101");
    expect(body.previousPeerList.originSubjectId).toBe(101);
    expect(body.previousPeerList.selectedIds).toEqual([202, 203, 204]);
    expect(body.previousPeerList.originRows[0]).toEqual({
      institutionId: 202, recordId: 202, reportDate: "2026-06-30", source: "ncua",
    });
    expect(fallback).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("uses only the filtered peer IDs for the next state refinement", async () => {
    const filtered = { ...fixture, peerList: { ...fixture.peerList, rows: [fixture.peerList.rows[0]], totalMatches: 1 } };
    const none = { ...fixture, peerList: { ...fixture.peerList, rows: [], totalMatches: 0 } };
    fetcher.mockReset().mockResolvedValueOnce(ok(fixture)).mockResolvedValueOnce(ok(filtered)).mockResolvedValueOnce(ok(none));
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Only Florida" nonce={2} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Only Georgia" nonce={3} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const body = JSON.parse(fetcher.mock.calls[2][1].body as string);
    expect(body.previousPeerList.selectedIds).toEqual([202]);
    expect(body.previousPeerList.originRows).toHaveLength(3);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not reuse an old peer list after a new independent list fails", async () => {
    fetcher.mockReset().mockResolvedValueOnce(ok(fixture)).mockResolvedValueOnce({ ok: false });
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="List five peers" nonce={2} />);
    await screen.findByRole("alert");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Only Florida" nonce={3} />);
    expect(screen.getByRole("alert").textContent).toContain("Ask for a peer list first");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not reuse a peer list after an unrelated answer intervenes", async () => {
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Compare our NSF fees with peers" nonce={2} />);
    expect(screen.getByText("Existing fee-answer path")).toBeTruthy();
    view.rerender(<PeerAwareStructuredAsk {...props} question="Only Florida" nonce={3} />);
    expect(screen.getByRole("alert").textContent).toContain("Ask for a peer list first");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses list-relative questions when there is no list or context changed", () => {
    const view = render(<PeerAwareStructuredAsk {...props} question="Only Florida" />);
    expect(screen.getByRole("alert").textContent).toContain("Ask for a peer list first");
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<PeerAwareStructuredAsk {...props} institutionId="999" question="Only Georgia" nonce={2} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shows a deterministic unsupported-fee answer, never the legacy paid fallback", async () => {
    const blocked = { ...fixture, shortAnswer: "Fee comparisons of 'their' fees are not yet supported.", peerList: { ...fixture.peerList, status: "needs_criteria" as const, rows: [], totalMatches: null } };
    fetcher.mockReset().mockResolvedValueOnce(ok(fixture)).mockResolvedValueOnce(ok(blocked));
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Compare their NSF fees" nonce={2} />);
    await screen.findByText("Fee comparisons of 'their' fees are not yet supported.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
    expect(screen.queryByText("Existing fee-answer path")).toBeNull();
  });
});
