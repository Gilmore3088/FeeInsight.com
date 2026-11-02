"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addToWatchlist, removeFromWatchlist } from "@/app/pro/(hamilton)/monitor/actions";
import {
  BarChart,
  DashboardCard,
  FilterChips,
  KpiCard,
  Switch,
  formatFigure,
  signedMoney,
} from "@/components/hamilton/dashboard";
import {
  ALERT_FEED_WEEKS,
  buildAlertSummary,
  filterAlertFeed,
  longDay,
  weeklyCounts,
  type AlertFeedRow,
  type AlertWeek,
} from "@/lib/hamilton/dashboard/alerts-dashboard";
import type { WatchlistEntry } from "@/lib/hamilton/monitor-data";
import { InstitutionSearchAdd, type InstitutionSearchResult } from "./WatchlistPanel";

/**
 * The interactive part of Alerts and watches (Hamilton redesign, Nov 2026): the summary row, the
 * watch list with on/off and delete, the New watch builder and the feed of like-for-like fee
 * changes with its filters and weekly chart. Watches are institutions on the reader's watchlist
 * (hamilton_watchlists), changed only through the route's server actions; every other value is read
 * on the server and arrives as a prop.
 */

interface WatchRow extends WatchlistEntry {
  on: boolean;
}

const STATUS_NOTE: Record<WatchlistEntry["status"], string> = {
  current: "Fees verified and current",
  review_due: "Fee schedule being re-checked",
  unknown: "Not yet checked",
};

const FEED_PAGE = 25;

export interface AlertsDashboardProps {
  /** The institution in context, for the state filter's "yours" and the builder. */
  stateCode: string | null;
  stateLabel: string | null;
  initialWatches: WatchlistEntry[];
  /** National like-for-like changes over the feed's weeks, named rows only; null when unread. */
  feed: AlertFeedRow[] | null;
  /** Every national change in the last 30 days (counted, named or not); null when unread. */
  nationalRecent: { direction: "up" | "down"; institutionId: string | null }[] | null;
  weeks: AlertWeek[];
  /** The state's changes over 180 days; undefined with no institution, null when unread. */
  state: { label: string; days: number; changes: { direction: "up" | "down" }[] } | null | undefined;
  /** Institutions offered in the builder. */
  suggestions: { id: string; name: string; reason: string }[];
  /** "YYYY-MM-DD": the day the counts run to. */
  asOf: string;
  /** "Aug 17 to Nov 2, 2026", for the feed's source line. */
  feedPeriod: string;
}

export function AlertsDashboard(props: AlertsDashboardProps) {
  const [watches, setWatches] = useState<WatchRow[]>(() => props.initialWatches.map((w) => ({ ...w, on: true })));
  const [pending, startTransition] = useTransition();
  const [watchError, setWatchError] = useState<string | null>(null);

  const activeIds = watches.filter((w) => w.on).map((w) => w.institutionId);
  const summary = buildAlertSummary({
    activeWatchIds: activeIds,
    offWatches: watches.length - activeIds.length,
    national: props.nationalRecent ? { recent: props.nationalRecent } : null,
    state: props.state,
  });

  function setOn(id: string, on: boolean) {
    setWatches((prev) => prev.map((w) => (w.institutionId === id ? { ...w, on } : w)));
  }

  function toggle(row: WatchRow, next: boolean) {
    setWatchError(null);
    setOn(row.institutionId, next);
    startTransition(async () => {
      const result = next ? await addToWatchlist(row.institutionId) : await removeFromWatchlist(row.institutionId);
      if (!result.ok) {
        setOn(row.institutionId, !next);
        setWatchError(result.error);
      }
    });
  }

  function remove(row: WatchRow) {
    setWatchError(null);
    setWatches((prev) => prev.filter((w) => w.institutionId !== row.institutionId));
    if (!row.on) return;
    startTransition(async () => {
      const result = await removeFromWatchlist(row.institutionId);
      if (!result.ok) {
        setWatches((prev) => (prev.some((w) => w.institutionId === row.institutionId) ? prev : [...prev, row]));
        setWatchError(result.error);
      }
    });
  }

  /** Adds through the same server action as the switch; resolves to the message to show. */
  async function add(id: string): Promise<{ ok: boolean; message: string }> {
    const existing = watches.find((w) => w.institutionId === id);
    if (existing?.on) return { ok: false, message: `You already watch ${existing.displayName}.` };
    const result = await addToWatchlist(id);
    if (!result.ok) return { ok: false, message: result.error };
    const entry = result.entry;
    if (entry) {
      setWatches((prev) =>
        prev.some((w) => w.institutionId === entry.institutionId)
          ? prev.map((w) => (w.institutionId === entry.institutionId ? { ...w, ...entry, on: true } : w))
          : [...prev, { ...entry, on: true }],
      );
    }
    return { ok: true, message: `Added: ${entry?.displayName ?? "the institution"}.` };
  }

  const changesByInstitution = useMemo(() => {
    const map = new Map<string, { up: number; down: number }>();
    (props.feed ?? []).forEach((r) => {
      if (!r.institutionId) return;
      const m = map.get(r.institutionId) ?? { up: 0, down: 0 };
      if (r.direction === "up") m.up += 1;
      else m.down += 1;
      map.set(r.institutionId, m);
    });
    return map;
  }, [props.feed]);

  return (
    <>
      <section className="hd-grid" aria-label="Summary">
        {summary.map((kpi) => (
          <div key={kpi.key} className="hd-span-3">
            <KpiCard label={kpi.label} value={kpi.value} sub={kpi.sub} subTone={kpi.subTone} />
          </div>
        ))}
      </section>
      <p className="hd-card-note" style={{ marginTop: -4 }}>
        Changes confirmed on each institution&apos;s own fee schedule, like for like, to {longDay(props.asOf)}. Alerts count changes at the institutions you watch. Source: published fee schedules.
      </p>

      <div className="hd-grid">
        <div className="hd-span-8" style={{ display: "flex", minWidth: 0 }}>
          <DashboardCard
            title="Your watches"
            titleId="al-watches"
            className="hd-grow"
            footnote="Last read: the day we last captured that institution's fee schedule. A watch turned off stays in this list until you leave the page. Source: published fee schedules."
          >
            <p className="hd-card-note">Turn a watch off or delete it. Each follows every fee the institution publishes.</p>
            {watches.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14 }}>No watches yet. Add one with New watch.</p>
            ) : (
              <div className="hd-table-wrap">
                <table className="hd-table">
                  <caption className="hd-sr">Institutions you watch</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="hd-left"><span>Watching</span></th>
                      <th scope="col" className="hd-left"><span>Alert when</span></th>
                      <th scope="col" className="hd-left"><span>Last read</span></th>
                      <th scope="col" className="hd-left"><span>Last 12 weeks</span></th>
                      <th scope="col"><span>On</span></th>
                      <th scope="col"><span className="hd-sr">Delete</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watches.map((w) => {
                      const moved = changesByInstitution.get(w.institutionId);
                      const place = [w.city, w.stateCode].filter(Boolean).join(", ");
                      return (
                        <tr key={w.institutionId} style={{ opacity: w.on ? 1 : 0.7 }}>
                          <th scope="row" style={{ whiteSpace: "normal", minWidth: 180 }}>
                            <span style={{ display: "block", fontWeight: 600 }}>{w.displayName}</span>
                            <span className="hd-card-note" style={{ display: "block", fontWeight: 400 }}>
                              {["Bank or credit union", place || null].filter(Boolean).join(" · ")}
                            </span>
                            <Link href={`/pro/analyze?instId=${w.institutionId}&intent=watchlist`} style={{ fontSize: 12, fontWeight: 600, color: "var(--fi-brick)" }}>
                              Ask about it
                            </Link>
                          </th>
                          <td className="hd-left" style={{ fontFamily: "inherit", whiteSpace: "normal" }}>Any confirmed fee change</td>
                          <td className="hd-left">{w.lastReadAt ? longDay(w.lastReadAt) : "Not yet"}</td>
                          <td className="hd-left" style={{ fontFamily: "inherit" }}>
                            {!w.on ? (
                              <span className="hd-tag hd-tag--off">Off</span>
                            ) : moved ? (
                              <span className={`hd-tag${moved.up > 0 ? " hd-tag--above" : ""}`}>▲ {moved.up} up · ▼ {moved.down} down</span>
                            ) : (
                              <span className="hd-tag">● No change</span>
                            )}
                            <span className="hd-card-note" style={{ display: "block", marginTop: 2 }}>{STATUS_NOTE[w.status]}</span>
                          </td>
                          <td>
                            <Switch checked={w.on} disabled={pending} onChange={(next) => toggle(w, next)} label={`Watch ${w.displayName}`} />
                          </td>
                          <td>
                            <button type="button" className="hd-btn-link" disabled={pending} onClick={() => remove(w)} aria-label={`Delete watch: ${w.displayName}`}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {watchError ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--fi-brick)" }}>{watchError}</p> : null}
          </DashboardCard>
        </div>
        <div className="hd-span-4" style={{ display: "flex", minWidth: 0 }}>
          <NewWatch suggestions={props.suggestions} watchedIds={new Set(activeIds)} onAdd={add} />
        </div>
      </div>

      <ChangeFeed
        feed={props.feed}
        weeks={props.weeks}
        stateCode={props.stateCode}
        stateLabel={props.stateLabel}
        watchedIds={new Set(activeIds)}
        period={props.feedPeriod}
      />
    </>
  );
}

/** The New watch builder: pick an institution, see what it will alert on, add it. */
function NewWatch({
  suggestions,
  watchedIds,
  onAdd,
}: {
  suggestions: { id: string; name: string; reason: string }[];
  watchedIds: ReadonlySet<string>;
  onAdd: (id: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [target, setTarget] = useState<{ id: string; name: string; detail: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const offered = suggestions.filter((s) => !watchedIds.has(s.id));

  function pickSearch(result: InstitutionSearchResult) {
    const place = [result.city, result.state_code].filter(Boolean).join(", ");
    setTarget({ id: String(result.id), name: result.institution_name, detail: [place, result.fee_publication_label].filter(Boolean).join(" · ") });
    setMessage(null);
  }

  function submit() {
    if (!target) {
      setMessage({ ok: false, text: "Pick an institution first." });
      return;
    }
    const picked = target;
    startTransition(async () => {
      const result = await onAdd(picked.id);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) setTarget(null);
    });
  }

  return (
    <DashboardCard title="New watch" titleId="new-watch" className="hd-grow">
      <div className="hd-step">
        <span className="hd-label">1. Watch a</span>
        <div className="hd-chips"><span className="hd-chip" aria-current="true" style={{ display: "inline-flex", alignItems: "center", background: "var(--fi-ink)", color: "var(--fi-on-ink)", borderColor: "var(--fi-ink)" }}>Bank or credit union</span></div>
      </div>
      <div className="hd-step">
        <span className="hd-label" id="new-watch-pick">2. Pick one</span>
        {offered.length > 0 ? (
          <div role="group" aria-labelledby="new-watch-pick" className="hd-chips">
            {offered.map((s) => (
              <button
                key={s.id}
                type="button"
                className="hd-chip"
                aria-pressed={target?.id === s.id}
                onClick={() => { setTarget({ id: s.id, name: s.name, detail: s.reason }); setMessage(null); }}
                title={s.reason}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <InstitutionSearchAdd onAdd={pickSearch} isPending={pending} error={null} label="Or search by name" inputId="new-watch-search" hint="Pick a name from the list." />
        {target ? <p className="hd-card-note">{target.name}{target.detail ? ` · ${target.detail}` : ""}</p> : null}
      </div>
      <div className="hd-step">
        <span className="hd-label">3. Alert me when</span>
        <p style={{ margin: 0, fontSize: 13 }}>● Any confirmed fee change</p>
      </div>
      <div className="hd-step">
        <span className="hd-label">4. Send it</span>
        <p style={{ margin: 0, fontSize: 13 }}>Here in Hamilton, and in the fee-change email. <Link href="/account" style={{ color: "var(--fi-brick)", fontWeight: 600 }}>Manage email</Link></p>
      </div>
      <p className="hd-card-note" aria-live="polite">Preview: {target ? `${target.name}, any confirmed fee change.` : "pick an institution."}</p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="hd-btn" onClick={submit} disabled={pending || !target}>Add watch</button>
        {message ? (
          <span role={message.ok ? "status" : "alert"} style={{ fontSize: 12, fontWeight: 600, color: message.ok ? "var(--fi-below-market)" : "var(--fi-brick)" }}>{message.text}</span>
        ) : null}
      </div>
      <details className="hd-card-note">
        <summary style={{ cursor: "pointer" }}>What a watch covers</summary>
        <p style={{ margin: "6px 0 0" }}>
          A watch follows every fee one institution publishes and alerts when a price changes on its own fee schedule, like for like. You can watch up to 25. Watches on one fee across a market or a peer group are not offered yet.
        </p>
      </details>
    </DashboardCard>
  );
}

/** The feed of like-for-like changes nationwide, with its filters and weekly chart. */
function ChangeFeed({
  feed,
  weeks,
  stateCode,
  stateLabel,
  watchedIds,
  period,
}: {
  feed: AlertFeedRow[] | null;
  weeks: AlertWeek[];
  stateCode: string | null;
  stateLabel: string | null;
  watchedIds: ReadonlySet<string>;
  period: string;
}) {
  const [direction, setDirection] = useState<"all" | "up" | "down">("all");
  const [state, setState] = useState<string>("all");
  const [week, setWeek] = useState<number | null>(null);
  const [shown, setShown] = useState(FEED_PAGE);
  const rows = useMemo(() => feed ?? [], [feed]);
  const states = useMemo(() => {
    const set = new Set(rows.map((r) => r.state).filter((s): s is string => Boolean(s)));
    if (stateCode) set.add(stateCode);
    return [...set].sort();
  }, [rows, stateCode]);
  const filtered = useMemo(() => filterAlertFeed(rows, { direction, state }), [rows, direction, state]);
  const counts = useMemo(() => weeklyCounts(filtered, weeks.length), [filtered, weeks.length]);
  const listed = week === null ? filtered.filter((r) => r.week >= 0) : filtered.filter((r) => r.week === week);
  const inWeeks = counts.reduce((a, b) => a + b, 0);
  const place = state === "all" ? "nationwide" : state === stateCode && stateLabel ? `in ${stateLabel}` : `in ${state}`;
  const emptyText = state !== "all" && state === stateCode && stateLabel
    ? `No institution in ${stateLabel} has a confirmed fee change in these ${ALERT_FEED_WEEKS} weeks.`
    : "No changes match these filters.";

  return (
    <DashboardCard
      title={`Fee changes, ${place}`}
      titleId="al-feed"
      actions={feed ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <FilterChips<"all" | "up" | "down">
            label="Show changes"
            value={direction}
            onChange={(next) => { setDirection(next); setShown(FEED_PAGE); }}
            options={[{ value: "all", label: "All" }, { value: "up", label: "▲ Increases" }, { value: "down", label: "▼ Decreases" }]}
          />
          <label className="hd-select">
            State
            <select value={state} onChange={(e) => { setState(e.target.value); setWeek(null); setShown(FEED_PAGE); }}>
              <option value="all">All states</option>
              {states.map((s) => <option key={s} value={s}>{s === stateCode ? `${s} (yours)` : s}</option>)}
            </select>
          </label>
        </div>
      ) : null}
      footnote={`Every like-for-like change confirmed on an institution's own fee schedule, weeks starting Monday. Source: published fee schedules, ${period}.`}
    >
      {feed === null ? (
        <p style={{ margin: 0, fontSize: 14 }}>Fee changes could not be read just now. Refresh to try again.</p>
      ) : (
        <>
          <div className="hd-toolbar">
            <span className="hd-card-note">Changes per week, last {weeks.length} weeks. Choose a week to list it.</span>
            <span className="hd-mono" style={{ fontSize: 12, fontWeight: 600 }}>{inWeeks.toLocaleString("en-US")} in {weeks.length} weeks</span>
          </div>
          <BarChart
            label={`Like-for-like fee changes per week, ${place}, ${weeks[0]?.label ?? ""} to ${weeks[weeks.length - 1]?.label ?? ""}: ${counts.join(", ")}`}
            bars={weeks.map((w, i) => ({
              key: String(i),
              label: w.label,
              value: counts[i] ?? 0,
              ariaLabel: `Week of ${w.label}: ${counts[i] ?? 0} ${(counts[i] ?? 0) === 1 ? "change" : "changes"}`,
            }))}
            selected={week === null ? null : String(week)}
            onSelect={(key) => { setWeek(key === null ? null : Number(key)); setShown(FEED_PAGE); }}
          />
          {week !== null ? (
            <div className="hd-compare">
              <span>Showing the week of {weeks[week]?.label}</span>
              <button type="button" onClick={() => setWeek(null)}>Show all weeks</button>
            </div>
          ) : null}
          {listed.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14 }}>{emptyText}</p>
          ) : (
            <div className="hd-table-wrap">
              <table className="hd-table">
                <caption className="hd-sr">Like-for-like fee changes, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col" className="hd-left"><span>Date</span></th>
                    <th scope="col" className="hd-left"><span>Institution</span></th>
                    <th scope="col" className="hd-left"><span>State</span></th>
                    <th scope="col" className="hd-left"><span>Fee</span></th>
                    <th scope="col"><span>Old to new</span></th>
                    <th scope="col"><span>Move</span></th>
                  </tr>
                </thead>
                <tbody>
                  {listed.slice(0, shown).map((r) => {
                    const watched = r.institutionId !== null && watchedIds.has(r.institutionId);
                    return (
                      <tr key={r.id}>
                        <td className="hd-left">{r.date}</td>
                        <th scope="row" style={{ fontWeight: 600 }}>
                          {r.institution}
                          {watched ? <span className="hd-tag" style={{ marginLeft: 6 }}>You watch</span> : null}
                        </th>
                        <td className="hd-left">{r.state ?? ""}</td>
                        <td className="hd-left" style={{ fontFamily: "inherit" }}>{r.fee}</td>
                        <td>{formatFigure(r.from, "money")} → {formatFigure(r.to, "money")}</td>
                        <td className={`hd-tone-${r.direction === "up" ? "above" : "below"}`} style={{ fontWeight: 600 }}>
                          {r.direction === "up" ? "▲" : "▼"} {signedMoney(r.to - r.from)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {listed.length > shown ? (
            <button type="button" className="hd-btn-link" onClick={() => setShown((n) => n + FEED_PAGE)}>
              Show {Math.min(FEED_PAGE, listed.length - shown)} more of {listed.length.toLocaleString("en-US")}
            </button>
          ) : null}
        </>
      )}
    </DashboardCard>
  );
}
