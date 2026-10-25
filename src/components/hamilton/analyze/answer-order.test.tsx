// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { overdraftResearch } from "@/lib/hamilton/workspace/test-fixtures";
import type { AskResponse, Scenario } from "@/lib/hamilton/workspace/types";
import type { PeerFeeEntry, PeerListResponse, PeerListRow, PeerRateFeeEntry } from "@/lib/hamilton/peer-list";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { sampleStoryline } from "@/components/hamilton/storyline/test-fixture";
import { SourceChip } from "@/components/hamilton/memo/exhibit-view";
import { fmtMoney } from "@/components/hamilton/memo/memo";

vi.mock("@/app/pro/(hamilton)/settings/actions", () => ({ createPeerSet: vi.fn(), setPeerSetForAllCharts: vi.fn() }));
import { StructuredAsk } from "./StructuredAsk";
import { PeerListView } from "./PeerListView";

// H05-T04/T05 (#980): the requested result renders first, and data states read the same in every
// answer branch. Every figure here is made up for the test; none is live data.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** True when `a` comes before `b` in the document. */
function before(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function expectOrder(...nodes: Element[]) {
  for (let i = 1; i < nodes.length; i++) expect(before(nodes[i - 1], nodes[i]), `item ${i - 1} renders before item ${i}`).toBe(true);
}

function mockAsk(ask: AskResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/memo") ? { status: "withheld", reason: "Memo held for the test." } : ask), { status: 200 })),
  );
}

const identityContext = {
  version: 1, researchInstitutionId: 8109, accountInstitutionId: null, accountStatus: "unlinked", researchInstitutionName: "Example Bank",
} as AskResponse["identityContext"];

const provenance = { engineVersion: "test", generatedAt: "2026-10-01T00:00:00Z", dataAsOf: {}, sources: [], assumptions: [] };

describe("lookup: the fact and its source first", () => {
  it("leads with the one sentence, then the sourced finding, then the identity record", async () => {
    mockAsk({
      kind: "research",
      shortAnswer: "Example Bank charges $30 for a stop payment.",
      pageChange: { screen: "none" },
      facts: [{ text: "Stop payment fee: $30 per item.", source: { label: "Example Bank fee schedule", asOf: "2026-09-15" } }],
      identityContext,
    });
    render(<StructuredAsk question="What is our stop payment fee?" institutionId="8109" modelHrefFor={() => "/"} />);
    const lead = await screen.findByText("Example Bank charges $30 for a stop payment.");
    const fact = screen.getByText("Stop payment fee: $30 per item.");
    const source = screen.getByText("Example Bank fee schedule · Sep 2026");
    const identity = screen.getByText("Institution and peer group behind this answer");
    expectOrder(lead, fact, source, identity);
    // One intro: the sentence is not repeated below the finding.
    expect(screen.getAllByText("Example Bank charges $30 for a stop payment.")).toHaveLength(1);
  });

  it("leads a fee answer with its headline and figures before the exhibit and the takeaways", async () => {
    const answer = buildFeeAnswer(overdraftResearch());
    mockAsk({ kind: "research", shortAnswer: answer.headline, pageChange: { screen: "research", feeCategory: "overdraft" }, answer: { ...answer, storyline: undefined }, identityContext });
    const { container } = render(<StructuredAsk question="How does our overdraft fee compare?" institutionId="8109" modelHrefFor={() => "/"} />);
    const headline = await screen.findByText("Summary");
    const exhibit = screen.getByText(/Exhibit 1/);
    const takeaways = screen.getByText("What the data says");
    const identity = screen.getByText("Institution and peer group behind this answer");
    expectOrder(headline, exhibit, takeaways, identity);
    // The headline is written once, inside the memo, not again as a separate intro above it.
    expect(within(container).getAllByText(answer.headline)).toHaveLength(1);
    // A report is offered as a link; its sections are not drawn into the answer.
    expect(screen.queryByText(/Executive summary/i)).toBeNull();
  });
});

describe("comparison: rows and deltas before interpretation", () => {
  const scenario: Scenario = {
    feeCategory: "overdraft", current: 30, tested: 25, peerLabel: "Community banks", n: 40,
    peersMore: 10, peersSame: 5, peersLess: 25, positionBefore: 0.6, positionAfter: 0.3,
    per1000ItemsDelta: -5000, revenueEffect: null, evidenceLevel: "market",
    assumptions: ["Item volume stays the same."], factIds: [], missingInput: null, provenance,
  } as unknown as Scenario;
  const ask: AskResponse = { kind: "scenario", shortAnswer: "At $25, 25 of 40 community banks would still charge less.", pageChange: { screen: "model", feeCategory: "overdraft", tested: [25] }, scenario };

  it("keeps the tested-price rows leading when the question goes on to a written answer", async () => {
    mockAsk(ask);
    const onEngineRows = vi.fn();
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="What if we charged $25?" institutionId="8109" modelHrefFor={() => "/"} onEngineRows={onEngineRows} onNoStoryline={onNoStoryline} />);
    await waitFor(() => expect(onNoStoryline).toHaveBeenCalledTimes(1));
    expect(onEngineRows).toHaveBeenCalledWith(true);
    expect(before(screen.getByText(ask.shortAnswer), screen.getByText("Price tested"))).toBe(true);
  });

  it("drops its own intro once the written answer shows its lead, and keeps the rows", async () => {
    mockAsk(ask);
    render(<StructuredAsk question="What if we charged $25?" institutionId="8109" modelHrefFor={() => "/"} proseShown />);
    await screen.findByText("Price tested");
    expect(screen.queryByText(ask.shortAnswer)).toBeNull();
    expect(screen.getByText("$30 to $25")).toBeTruthy();
  });

  it("says a no-fee question has no rows, so the written answer may lead", async () => {
    mockAsk({ kind: "clarifying_question", shortAnswer: "Which fee?", pageChange: { screen: "none" }, question: { fieldKey: "ask.fee_category", prompt: "Which fee?", inputKind: "text", why: "" } } as unknown as AskResponse);
    const onEngineRows = vi.fn();
    render(<StructuredAsk question="How do we compare nationally?" institutionId="8109" modelHrefFor={() => "/"} onEngineRows={onEngineRows} onNoStoryline={() => undefined} />);
    await waitFor(() => expect(onEngineRows).toHaveBeenCalledWith(false));
  });

  it("states an opinion once, not as a lead and again as a callout", async () => {
    mockAsk({ ...ask, kind: "opinion", shortAnswer: "On customer treatment, $25 sits below most peers.", opinion: { opinion: "On customer treatment, $25 sits below most peers." } } as unknown as AskResponse);
    render(<StructuredAsk question="Should we test $25?" institutionId="8109" modelHrefFor={() => "/"} />);
    await screen.findByText("Price tested");
    expect(screen.getAllByText("On customer treatment, $25 sits below most peers.")).toHaveLength(1);
  });

  it("leads a whole-schedule answer with its sentence before the scorecard", async () => {
    mockAsk({
      kind: "research",
      shortAnswer: "2 of 3 fees sit above the peer median.",
      pageChange: { screen: "none" },
      positions: [
        { feeCategory: "overdraft", displayName: "Overdraft", current: 35, peerMedian: 30, peerCount: 40, peerLabel: "Community banks", direction: "higher" },
        { feeCategory: "nsf", displayName: "NSF", current: 0, peerMedian: 28, peerCount: 38, peerLabel: "Community banks", direction: "lower" },
      ],
    });
    render(<StructuredAsk question="How does our whole schedule compare?" institutionId="8109" modelHrefFor={() => "/"} />);
    const lead = await screen.findByText("2 of 3 fees sit above the peer median.");
    expectOrder(lead, screen.getByText("Every fee against its peers"));
    expect(screen.getAllByText("2 of 3 fees sit above the peer median.")).toHaveLength(1);
    // A $0 fee is shown as $0, never as "Free".
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.queryByText(/\bfree\b/i)).toBeNull();
  });

  it("puts the storyline's figures and exhibits before Hamilton's written commentary", () => {
    const { container } = render(
      <StorylineView
        story={sampleStoryline()}
        memo={{ state: "written", memo: { summary: "Commentary sentence.", board: "Board note.", market: "Market note.", questions: [], model: "t", generatedAt: "", figureCheck: { checked: 3, unmatched: [] } } }}
      />,
    );
    const thought = screen.getByText(/one of 6 without a daily cap/);
    const figure = screen.getAllByText("12 of 18")[0];
    const exhibit = within(container).getAllByText(/Exhibit 1/)[0];
    const commentary = screen.getByText("Commentary sentence.");
    const means = screen.getByText("What it means for you");
    expectOrder(thought, figure, exhibit, commentary, means);
    expect(screen.getByText(/Written by Hamilton from the exhibits above; 3 figures checked/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/verified/i);
  });
});

// Peer list fixtures: a zero fee, a missing fee, an amount the schedule does not state (variable),
// a stale date and two conflicting lines from one peer.
const peer = (id: number, name: string): PeerListRow => ({
  institutionId: id, name, charterType: "bank", city: "Tampa", stateCode: "FL", totalAssetsUsd: id * 1_000_000,
  reportDate: "2026-06-30", source: "fdic", sourceUrl: null, recordId: id, feeCoverage: "available", inclusionReason: "Matches the stated criteria.",
});
const fee = (institutionId: number, id: number, amount: number | null, publishedAt: string | null, name = "NSF Fee"): PeerFeeEntry => ({
  institutionId, id, name, amount, frequency: "per_item", publishedAt, sourceDocumentId: id, documentUrl: "https://bank.test/fees", sourceUrl: null,
});
const rateFee = (institutionId: number, id: number, rateLabel: string, publishedAt: string | null): PeerRateFeeEntry => ({
  institutionId, id, name: "Foreign transaction", rateLabel, frequency: "per_item", publishedAt, sourceDocumentId: id, documentUrl: "https://bank.test/fees", sourceUrl: null,
});
function peerList(category = "nsf", label = "NSF", fees: PeerFeeEntry[] = []): PeerListResponse {
  return {
    kind: "peer_list",
    shortAnswer: `Published ${label} fees for 4 selected peers.`,
    peerList: {
      version: 1, status: "ready", subject: peer(101, "Example Bank"),
      criteria: { charterType: "bank", states: ["FL"], minAssets: null, maxAssets: null, peerSetLabel: null, institutionIds: [], requestedCount: null, descriptions: ["Banks headquartered in Florida."] } as unknown as PeerListResponse["peerList"]["criteria"],
      rows: [peer(201, "Zero Bank"), peer(202, "Missing Bank"), peer(203, "Variable Bank"), peer(204, "Two Line Bank")],
      totalMatches: 4, queriedAt: "2026-10-10T00:00:00Z", notes: ["Assets are from each institution's latest filing."],
      feeComparison: {
        category, label, comparedPeerIds: [201, 202, 203, 204], account: null, includesAccount: false,
        note: "Each fee a peer publishes is listed on its own line.",
        fees,
      },
    },
  };
}

describe("peer list: criteria and table before anything optional", () => {
  const fees = [fee(201, 1, 0, "2026-09-01T00:00:00Z"), fee(203, 3, null, "2026-09-01T00:00:00Z"), fee(204, 4, 30, "2024-01-15T00:00:00Z"), fee(204, 5, 35, "2026-09-01T00:00:00Z", "NSF Fee (business)")];

  it("renders the answer, criteria, fee table and peer table before saving and help text", () => {
    render(<PeerListView response={peerList("nsf", "NSF", fees)} saveContext={{ question: "List Florida banks", institutionId: "101", previousPeerList: null }} />);
    expectOrder(
      screen.getByRole("heading", { name: "Published NSF fees for 4 selected peers." }),
      screen.getByText(/Selection criteria: banks · FL/),
      screen.getByRole("table", { name: "Published NSF charges" }),
      screen.getByRole("table", { name: "Peer table" }),
      screen.getByRole("button", { name: "Save this peer research" }),
      screen.getByText(/Refine this list by state/),
    );
    // No report, summary or second question field comes with a peer list.
    expect(screen.queryByText(/board brief|executive|summary/i)).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("tells zero, missing, unstated and conflicting fees apart", () => {
    render(<PeerListView response={peerList("nsf", "NSF", fees)} />);
    const table = screen.getByRole("table", { name: "Published NSF charges" });
    const row = (name: string) => within(table).getAllByRole("row").filter((r) => r.textContent?.includes(name));
    expect(row("Zero Bank")[0].textContent).toContain("$0");
    expect(row("Missing Bank")[0].textContent).toContain("No published consumer NSF fee on file");
    expect(row("Variable Bank")[0].textContent).toContain("Amount not stated");
    // Two lines from one peer stay two lines; nothing is averaged into one price.
    expect(row("Two Line Bank").map((r) => r.textContent)).toEqual([expect.stringContaining("$30"), expect.stringContaining("$35")]);
    // A stale line keeps its own date, in the same form as every answer's source dates.
    expect(row("Two Line Bank")[0].textContent).toContain("Jan 2024");
    expect(table.textContent).not.toMatch(/\bfree\b|verified/i);
  });

  it("lists a peer's rate fee on its own line as a rate, never as dollars or missing", () => {
    const response = peerList("card_foreign_txn", "foreign transaction", [fee(201, 1, 0, "2026-09-01T00:00:00Z", "Foreign transaction fee")]);
    response.peerList.feeComparison!.rateFees = [
      rateFee(201, 2, "1.1% of the transaction", "2026-09-01T00:00:00Z"),
      rateFee(203, 3, "3% of the transaction ($10 minimum)", "2026-08-01T00:00:00Z"),
    ];
    render(<PeerListView response={response} />);
    const table = screen.getByRole("table", { name: "Published foreign transaction charges" });
    const row = (name: string) => within(table).getAllByRole("row").filter((r) => r.textContent?.includes(name));
    // The $0 dollar line and the rate line from one peer stay two lines; neither is merged into the other.
    expect(row("Zero Bank").map((r) => r.textContent)).toEqual([expect.stringContaining("$0"), expect.stringContaining("1.1% of the transaction")]);
    expect(row("Zero Bank")[1].textContent).not.toMatch(/\$/);
    expect(row("Variable Bank")[0].textContent).toContain("3% of the transaction ($10 minimum)");
    expect(row("Missing Bank")[0].textContent).toContain("No published consumer foreign transaction fee on file");
    expect(within(table).getByRole("columnheader", { name: "Amount or rate" })).toBeTruthy();
    expect(table.textContent).not.toMatch(/not listed here|in dollars is on file|average|median|\bfree\b/i);
  });

  it("says a peer with neither a dollar nor a rate fee has none on file, and older snapshots still render", () => {
    render(<PeerListView response={peerList("card_foreign_txn", "foreign transaction", [])} />);
    expect(screen.getAllByText("No published consumer foreign transaction fee on file")).toHaveLength(4);
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeTruthy();
  });

  it("labels an old fee source beside its date and leaves recent and missing dates plain", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    try {
    render(<PeerListView response={peerList("nsf", "NSF", fees.concat(fee(202, 6, 25, null)))} />);
    const table = screen.getByRole("table", { name: "Published NSF charges" });
    const row = (name: string) => within(table).getAllByRole("row").filter((r) => r.textContent?.includes(name));
    expect(row("Two Line Bank")[0].textContent).toContain("Jan 2024 · Source over a year old");
    expect(row("Two Line Bank")[1].textContent).toContain("Sep 2026");
    expect(row("Two Line Bank")[1].textContent).not.toContain("over a year old");
    expect(row("Missing Bank")[0].textContent).toContain("Date not recorded");
    expect(row("Missing Bank")[0].textContent).not.toContain("over a year old");
    } finally { vi.useRealTimers(); }
  });

  it("names the reader's own institution plainly, not as verified", () => {
    const response = peerList("nsf", "NSF", [fee(101, 9, 25, "2026-09-01T00:00:00Z")]);
    response.peerList.feeComparison!.account = { institutionId: 101, name: "Example Bank" };
    render(<PeerListView response={response} />);
    expect(screen.getByText("Example Bank (your institution)")).toBeTruthy();
  });
});

describe("one format for amounts and source dates across answer branches", () => {
  it("formats amounts the same way and keeps missing apart from zero", () => {
    expect(fmtMoney(0)).toBe("$0");
    expect(fmtMoney(30)).toBe("$30");
    expect(fmtMoney(2.5)).toBe("$2.50");
    expect(fmtMoney(null)).toBe("Not published");
  });

  it("writes a source date as month and year in the badge, the fact list and the storyline notes", () => {
    const chip = renderToStaticMarkup(<SourceChip source={{ label: "FDIC call report", asOf: "2026-06-30" }} n={25} />);
    expect(chip).toContain("FDIC call report · Jun 2026 · n=25");
    const story = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);
    expect(story).toContain("Jun 2026");
    expect(story).not.toContain("2026-06-30");
  });
});
