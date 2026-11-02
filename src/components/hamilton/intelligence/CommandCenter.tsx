import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { buildCommandCenter } from "@/lib/hamilton/command-center";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { getActivePeerSet } from "@/lib/hamilton/active-peer-set";
import { COMPETITOR_MOVE_WINDOW_DAYS } from "@/lib/hamilton/workspace/research";
import { MIN_PEERS_FOR_POSITION } from "@/lib/hamilton/workspace/scenario";
import { STATE_NAMES } from "@/lib/us-states";
import { CoverageLine } from "@/components/hamilton/CoverageLine";
import { DashboardCard, formatFigure } from "@/components/hamilton/dashboard";
import { briefingPeer, readInstitutionCoverage } from "@/lib/hamilton/coverage-read";
import {
  askPrompts,
  buildChanges,
  buildDashboardFinancials,
  buildFeeGroupRows,
  buildScorecard,
  feeRowLinks,
  type DashboardFeeGroup,
} from "@/lib/hamilton/dashboard/command-center-dashboard";
import { readBranchCount, readCompetitorFilings, readFeeGroups, readFiledSeries, readStateChanges, scorecardIds } from "@/lib/hamilton/dashboard/command-center-read";
import { furthestAbove } from "@/components/hamilton/dashboard/FeePositionChart";
import { CommandCenterDashboard, WhatChanged } from "./CommandCenterDashboard";
import { getQuarterlyChangesOnce, loadBriefingOnce } from "./InstitutionBriefing";

export interface CommandCenterInstitution {
  id: number;
  name: string;
  stateCode: string | null;
  city?: string | null;
}

const GROUP_NOTE = `Each institution's published price, one per institution; sister charters on one schedule count once. A median and middle half need ${MIN_PEERS_FOR_POSITION} institutions that publish the fee; with fewer the row shows the spread only. Choose a fee for its range and links. Source: published fee schedules, verified and live.`;

/**
 * The command center (#1891), rebuilt as a community banker's dashboard (Hamilton redesign, Nov
 * 2026): filed performance with a trend, the institution's fees against its state and its peer
 * group, where it stands, a peer scorecard, Ask Hamilton and what changed. Every figure is read on
 * the server from an existing read; no model call. A read that fails leaves its card saying so.
 */
export async function CommandCenter({ institution }: { institution: CommandCenterInstitution }) {
  const user = await getCurrentUser().catch(() => null);
  const id = String(institution.id);
  const stateLabel = institution.stateCode ? (STATE_NAMES[institution.stateCode] ?? institution.stateCode) : null;
  const [{ briefing }, series, branches, changes, coverageRead, activePeerSet, stateChanges] = await Promise.all([
    loadBriefingOnce(user?.id ?? null, id),
    readFiledSeries(institution.id),
    readBranchCount(institution.id),
    getQuarterlyChangesOnce(institution.id).catch(() => null),
    readInstitutionCoverage(institution, null).catch(() => null),
    user ? getActivePeerSet({ userId: user.id, institutionId: institution.id }).catch(() => null) : Promise.resolve(null),
    readStateChanges(institution.stateCode),
  ]);
  const positions = briefing?.positions ?? [];
  const [groups, filings] = await Promise.all([
    readFeeGroups({
      institutionId: institution.id,
      stateCode: institution.stateCode,
      categories: positions.map((p) => p.feeCategory),
      activePeerSet: activePeerSet ? { filters: activePeerSet.filters, label: activePeerSet.label } : null,
    }).catch(() => ({ peers: null, state: null, peersSaved: false })),
    readCompetitorFilings(scorecardIds(briefing).filter((cid) => cid !== institution.id)),
  ]);
  filings.set(institution.id, series);

  const financials = buildDashboardFinancials(series);
  const links = (fee: string) => feeRowLinks(fee, institution.id);
  const feeGroups: DashboardFeeGroup[] = [];
  if (groups.state && stateLabel) {
    feeGroups.push({ key: "state", tab: stateLabel, label: groups.state.label, rows: buildFeeGroupRows(positions, groups.state, links), note: GROUP_NOTE });
  }
  if (groups.peers) {
    feeGroups.push({
      key: "peers",
      tab: groups.peersSaved ? "Your peer group" : "Peer group",
      label: groups.peers.label,
      rows: buildFeeGroupRows(positions, groups.peers, links),
      note: `${groups.peersSaved ? "Your saved peer group from Settings." : "The peer group every Hamilton screen uses for this institution; save your own in Settings."} ${GROUP_NOTE}`,
    });
  }
  const scorecard = buildScorecard(briefing?.localMarket, filings);
  const coverage = coverageRead ? { ...coverageRead, peer: briefingPeer(briefing) } : null;
  const ownCategories = new Set(positions.map((p) => p.feeCategory));
  const tape = buildChanges({ institutionName: institution.name, stateLabel, windowDays: COMPETITOR_MOVE_WINDOW_DAYS, ownCategories, changes: stateChanges });
  // The institution's own fee changes between its stored quarterly briefings, worded as before (#1891).
  const ownChange = changes
    ? buildCommandCenter({ institution, briefing, financials: null, changes, stateLabel, windowDays: COMPETITOR_MOVE_WINDOW_DAYS }).find((a) => a.key === "change") ?? null
    : null;
  const firstGroup = feeGroups[0] ?? null;
  const top = firstGroup ? furthestAbove(firstGroup.rows, 1)[0] ?? null : null;
  const prompts = askPrompts({ institutionId: institution.id, topAboveCategory: top?.key ?? null, groupLabel: firstGroup?.label ?? null, stateLabel });

  const place = [institution.city, institution.stateCode].filter(Boolean).join(", ");
  const facts = [
    place || null,
    financials?.assets !== null && financials?.assets !== undefined ? <><span className="hd-mono">{formatFigure(financials.assets, "dollars")}</span> assets</> : null,
    branches !== null ? `${branches.toLocaleString("en-US")} ${branches === 1 ? "branch" : "branches"}` : null,
  ].filter(Boolean);

  return (
    <div className="flex w-full flex-col gap-4 text-warm-900">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="hd-label" style={{ color: "var(--fi-brick)" }}>
            {financials ? `Command center · latest filing ${financials.latestQuarter}` : "Command center"}
          </p>
          <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{institution.name}</h1>
          {facts.length > 0 ? (
            <p className="m-0 text-sm text-warm-700">
              {facts.map((fact, i) => <span key={i}>{i > 0 ? " · " : ""}{fact}</span>)}
              {financials ? <span className="hd-muted"> ({financials.source === "ncua" ? "NCUA 5300" : "FDIC call report"}, {financials.latestQuarter})</span> : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={hrefWithInstitutionContext("/pro/simulate", id)} className="fi-btn fi-btn-secondary fi-btn-sm" style={{ minHeight: 40 }}>Try a price</Link>
          <Link href={hrefWithInstitutionContext("/pro/reports?intent=executive-briefing", id)} className="fi-btn fi-btn-primary fi-btn-sm" style={{ minHeight: 40 }}>Build board brief</Link>
          <Link href={hrefWithInstitutionContext("/pro/settings", id)} className="inline-flex min-h-10 items-center px-2 text-sm text-terra-text underline">Change institution</Link>
        </div>
      </header>
      <CoverageLine coverage={coverage} />
      <CommandCenterDashboard
        institutionName={institution.name}
        financials={financials}
        feeGroups={feeGroups}
        scorecard={scorecard}
        noFeesText={briefing
          ? `Too few of ${institution.name}'s published fees are on file to compare yet.`
          : `${institution.name}'s fees could not be compared just now.`}
        askCard={
          <DashboardCard title="Ask Hamilton" titleId="cc-ask" tone="ink" className="hd-grow" footnote="Answers cite each institution's fee schedule and filing.">
            <span className="hd-label" style={{ color: "rgb(var(--fi-on-ink-rgb) / 0.72)" }}>Suggested for this view</span>
            <div className="hd-prompts">
              {prompts.map((p) => <Link key={p.href} href={p.href}>{p.label}</Link>)}
            </div>
            <form action="/pro/analyze" method="get" className="hd-ask-form">
              <label htmlFor="cc-ask-input" className="hd-sr">Your question</label>
              <input id="cc-ask-input" name="q" type="text" placeholder="Ask about a fee, a peer or a quarter" maxLength={500} />
              <input type="hidden" name="instId" value={id} />
              <button type="submit">Ask</button>
            </form>
          </DashboardCard>
        }
      />
      <WhatChanged changes={tape} own={ownChange && ownChange.lines.length > 0 ? { lines: ownChange.lines, source: ownChange.source } : null} windowDays={COMPETITOR_MOVE_WINDOW_DAYS}
        links={[
          { label: "This month's briefing", href: hrefWithInstitutionContext("/pro/intelligence?view=institution", id) },
          { label: "Alerts and watches", href: hrefWithInstitutionContext("/pro/monitor", id) },
        ]}
      />
    </div>
  );
}
