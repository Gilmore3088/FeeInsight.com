import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { sampleWorkflowReport } from "./landing-workflow.test-fixture";

/**
 * #1988: the homepage is ISR, so its reads run during the build's prerender too. A read held
 * open by a saturated pool must not hold the render or fail the build: every homepage read is
 * optional under one deadline (HOME_READ_BUDGET_MS), and a render that fell back is cached for
 * a minute (shortenPageLife), not fifteen.
 */
const reads = vi.hoisted(() => ({
  sample: vi.fn(),
  revenue: vi.fn(),
  financial: vi.fn(),
  peers: vi.fn(),
  branches: vi.fn(),
  indexRows: vi.fn(),
  shortenPageLife: vi.fn(async () => undefined),
}));

vi.mock("@/lib/public-stats", () => ({
  getPublicSnapshot: vi.fn(async () => ({
    summary: { complete: true, refreshedOn: "Oct 14, 2026", freshnessLabel: "Data refreshed Oct 14, 2026" },
    categories: [{ fee_category: "monthly_maintenance", institution_count: 40 }],
  })),
}));
vi.mock("@/lib/custom-report/sample-report", () => ({ DEMO_SAMPLE_INSTITUTION_ID: 323, loadSampleReport: reads.sample }));
vi.mock("@/lib/custom-report/revenue-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/custom-report/revenue-context")>()),
  getRevenueContextCached: reads.revenue,
}));
vi.mock("@/lib/custom-report/peer-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/custom-report/peer-context")>()),
  getReportPeerFinancialCached: reads.financial,
  getReportPeerContextCached: reads.peers,
}));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getIndexRowsCached: reads.indexRows,
  getMarketBranchFootprintCached: reads.branches,
}));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife: reads.shortenPageLife,
}));
vi.mock("./landing-serif", () => ({ homeSerif: { variable: "serif" } }));
vi.mock("@/components/consumer-nav", () => ({ ConsumerNav: () => null }));
vi.mock("@/components/customer-footer", () => ({ CustomerFooter: () => null }));
vi.mock("@/components/public/search-modal", () => ({ SearchModal: () => null }));

import LandingPage from "./page";
import { LandingResearch } from "./landing-research-section";
import { LandingHamilton } from "./landing-hamilton";
import { HOME_READ_BUDGET_MS } from "./landing-shared";

/** A query queued behind a saturated pooler: it never answers. */
const hanging = () => new Promise<never>(() => undefined);

function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => collect(child, out));
  else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    out.push(element);
    collect(element.props.children, out);
  }
  return out;
}

const propsOf = <P,>(tree: ReactNode, type: unknown) => collect(tree).find((el) => el.type === type)?.props as P | undefined;

/** Renders the page while the clock runs past the read budget. */
async function renderPastDeadline(): Promise<ReactNode> {
  const page = LandingPage();
  await vi.advanceTimersByTimeAsync(HOME_READ_BUDGET_MS + 1);
  return page;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  reads.shortenPageLife.mockClear();
  reads.sample.mockReset().mockResolvedValue(sampleWorkflowReport());
  for (const read of [reads.revenue, reads.financial, reads.peers, reads.branches]) read.mockReset().mockResolvedValue(null);
  reads.indexRows.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("homepage read deadline", () => {
  it("renders without the sample when its read never answers, and caches that render for a minute", async () => {
    reads.sample.mockImplementation(hanging);
    reads.indexRows.mockImplementation(hanging);
    const tree = await renderPastDeadline();
    expect(propsOf<{ report: unknown }>(tree, LandingResearch)?.report).toBeNull();
    expect(propsOf<{ report: unknown }>(tree, LandingHamilton)?.report).toBeNull();
    expect(reads.shortenPageLife).toHaveBeenCalledTimes(1);
  });

  it("keeps the sample and drops only the One question reads that hang", async () => {
    reads.peers.mockImplementation(hanging);
    reads.branches.mockImplementation(hanging);
    const tree = await renderPastDeadline();
    const research = propsOf<{ report: unknown; peers: unknown; branches: unknown }>(tree, LandingResearch);
    expect(research?.report).not.toBeNull();
    expect(research?.peers).toBeNull();
    expect(research?.branches).toBeNull();
    expect(reads.shortenPageLife).toHaveBeenCalledTimes(1);
  });

  it("caches a render whose reads all answered for the full fifteen minutes", async () => {
    const tree = await renderPastDeadline();
    expect(propsOf<{ report: unknown }>(tree, LandingResearch)?.report).not.toBeNull();
    expect(reads.shortenPageLife).not.toHaveBeenCalled();
  });
});
