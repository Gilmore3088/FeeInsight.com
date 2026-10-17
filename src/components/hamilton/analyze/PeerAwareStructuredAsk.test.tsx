// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { PeerAwareStructuredAsk } from "./PeerAwareStructuredAsk";
import { PeerListView } from "./PeerListView";
import type { PeerListResponse, PeerListRow } from "@/lib/hamilton/peer-list";

vi.mock("./StructuredAsk", () => ({ StructuredAsk: () => <p>Existing fee-answer path</p> }));
vi.mock("@/app/pro/(hamilton)/settings/actions", () => ({ createPeerSet: vi.fn() }));
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
    expect(screen.getByRole("link", { name: "Alpha CU" }).getAttribute("href")).toBe("/pro/hamilton?instId=202");
    expect(screen.getAllByRole("link", { name: "Public page" })[0].getAttribute("href")).toBe("/institution/202");
    expect(screen.getByText("$1,000,000,000")).toBeTruthy();
    expect(screen.getAllByText("Jun 2026").length).toBe(2);
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
  it("offers the list as a CSV file and no report action (#977, H02-T08)", async () => {
    const created = vi.fn(() => "blob:peer-list");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PeerAwareStructuredAsk {...props} />); await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download this list (CSV)" }));
    expect(created).toHaveBeenCalledTimes(1);
    const blob = (created.mock.calls[0] as unknown as [Blob])[0];
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(text).toContain("Peer list for,Test CU");
    expect(text).toContain("1,202,Alpha CU,Credit union,Orlando,FL,1000000000,2026-06-30,NCUA,,202,No published fees on file");
    expect(text).toContain("3,204,Missing CU,Credit union,Orlando,FL,,,,,,No published fees on file");
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
  it("pages past 50 rows and keeps the shown page for follow-ups and saves (#977, H02-T08)", async () => {
    const page = (offset: number, count: number): PeerListResponse => ({
      kind: "peer_list", shortAnswer: `Page from ${offset + 1}`,
      peerList: {
        ...fixture.peerList,
        criteria: { basis: "explicit_filters", charterType: "credit_union", states: ["FL"], minAssets: null, maxAssets: null, institutionIds: null, assetTiers: [], fedDistricts: [], peerSetId: null, peerSetLabel: null, sort: "largest_assets", referenceAssetsUsd: null, requiresAssets: false, limit: 50, requestedCount: null, descriptions: ["Credit unions; Florida."] },
        rows: Array.from({ length: count }, (_, i) => peer(1000 + offset + i, `Peer ${offset + i + 1}`, 1_000_000)),
        totalMatches: 60, ...(offset ? { offset } : {}),
      },
    });
    fetcher.mockReset().mockResolvedValueOnce(ok(page(0, 50))).mockResolvedValueOnce(ok(page(50, 10)));
    render(<PeerAwareStructuredAsk {...props} question="List all credit unions in Florida" />);
    await screen.findByText("Page from 1");
    expect(screen.queryByRole("button", { name: /Previous/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next 10" }));
    await screen.findByText("Page from 51");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ question: "List all credit unions in Florida", institutionId: "101", peerListOffset: 50 });
    expect(screen.getByRole("link", { name: "Peer 51" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Previous 50" })).toBeTruthy();
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ savedAnalysisId: "s1" }) });
    fireEvent.click(screen.getByRole("button", { name: "Save this peer research" }));
    await screen.findByText(/Research snapshot saved/);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ question: "List all credit unions in Florida", peerListOffset: 50, savePeerResearchSnapshot: true });
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
  it("asks the server about 'compare with us' with no list, sending no peers (#1536)", async () => {
    const noLink: PeerListResponse = { kind: "peer_list", shortAnswer: "No institution is linked to your account, so there is no \"us\" to compare.", peerList: { version: 1, status: "needs_criteria", subject: null, criteria: null, rows: [], totalMatches: null, queriedAt: "2026-10-16T00:00:00Z", notes: [] } };
    fetcher.mockReset().mockResolvedValue(ok(noLink));
    render(<PeerAwareStructuredAsk {...props} question="How does this compare with us?" />);
    expect(await screen.findByText(/No institution is linked to your account/)).toBeTruthy();
    expect(screen.queryByText(/Ask for a peer list first/)).toBeNull();
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ question: "How does this compare with us?", institutionId: "101", previousPeerList: null });
    expect(fallback).not.toHaveBeenCalled();
  });
  it("refuses list-relative questions when there is no list or context changed", () => {
    const view = render(<PeerAwareStructuredAsk {...props} question="Only Florida" />);
    expect(screen.getByRole("alert").textContent).toContain("Ask for a peer list first");
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<PeerAwareStructuredAsk {...props} institutionId="999" question="Only Georgia" nonce={2} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("renders an exact-list NSF comparison without invoking the legacy paid fallback", async () => {
    const compared: PeerListResponse = { ...fixture, shortAnswer: "Published NSF fees for 3 selected peers.", peerList: {
      ...fixture.peerList, feeComparison: { category: "nsf", comparedPeerIds: [202, 203, 204], account: null, includesAccount: false,
        note: "Every charge remains distinct.", fees: [
          { institutionId: 202, id: 51, name: "Returned item", amount: 0, frequency: "per_item", publishedAt: "2026-10-01T00:00:00Z", sourceDocumentId: 5, documentUrl: "https://example.com/fee-schedule", sourceUrl: null },
          { institutionId: 202, id: 52, name: "Second separate fee", amount: 30, frequency: "per_item", publishedAt: "2026-10-01T00:00:00Z", sourceDocumentId: 5, documentUrl: null, sourceUrl: null },
        ] },
    } };
    fetcher.mockReset().mockResolvedValueOnce(ok(fixture)).mockResolvedValueOnce(ok(compared));
    const view = render(<PeerAwareStructuredAsk {...props} />);
    await screen.findByRole("table");
    view.rerender(<PeerAwareStructuredAsk {...props} question="Compare their NSF fees" nonce={2} />);
    await screen.findByText("Published NSF fees for 3 selected peers.");
    expect(within(screen.getByRole("table", { name: "Published NSF charges" })).getByText("$0")).toBeTruthy();
    expect(screen.getByText("Second separate fee")).toBeTruthy();
    expect(screen.getAllByText("No published consumer NSF fee on file")).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
    expect(screen.queryByText("Existing fee-answer path")).toBeNull();
  });
});
