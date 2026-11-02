"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardCard, SegmentedControl, formatFigure, signedMoney, POSITION_MARK } from "@/components/hamilton/dashboard";
import "@/components/hamilton/dashboard/dashboard.css";
import "./try-price.css";
import { useReportBasket } from "@/components/hamilton/basket/AddToReportButton";
import { addToBasket, basketItemId, removeFromBasket } from "@/lib/hamilton/report-basket";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { computeConfidenceTier } from "@/lib/hamilton/confidence";
import { saveScenario } from "@/app/pro/(hamilton)/simulate/actions";
import {
  dotPlot,
  ordinal,
  parseItems,
  parseWaiver,
  placePrice,
  yearlyChange,
  type PeerTile,
  type PricePlacement,
  type TryPriceGroup,
} from "@/lib/hamilton/dashboard/try-price";

export interface TryPriceFee {
  category: string;
  name: string;
  /** Today's price as stated ("$35", or a range). */
  label: string;
  href: string;
  active: boolean;
}

export interface TryPriceSavedRow {
  id: string;
  fee: string;
  feeName: string;
  current: number;
  proposed: number;
  /** "Nov 2, 2026". */
  savedOn: string;
  href: string;
}

export interface TryPriceDashboardProps {
  institutionId: string | null;
  institutionName: string;
  fee: string;
  feeName: string;
  /** The fee name inside a sentence ("overdraft", "NSF / returned item"). */
  feeProse: string;
  current: number | null;
  /** The line under the heading. */
  dek: string;
  fees: TryPriceFee[];
  groups: TryPriceGroup[];
  openingGroup: string | null;
  /** The peer group's prices, to colour the peers' dots. */
  peerAmounts: number[];
  strip: { title: string; tiles: PeerTile[]; more: number } | null;
  initialPrice: number;
  slider: { max: number; step: number };
  /** The bank's figures to start from: typed in the link or saved in My bank and data; empty otherwise. */
  figures: { items: string; waiver: string; saved: boolean };
  saved: TryPriceSavedRow[];
  /** "Published fee schedules, read Nov 2, 2026." */
  source: string;
  /** The side-by-side table's link without prices, paid or waiver, to carry this price and these figures. */
  tableHref: string;
  settingsHref: string;
  /** Back to the institution's fees. */
  researchHref: string;
}

const money = (v: number) => formatFigure(v, "money");
const dollars = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const signedDollars = (v: number) => (Math.abs(v) < 0.5 ? "$0" : `${v > 0 ? "+" : "−"}${dollars(v)}`);
const roundTo = (v: number, step: number) => Math.round(Math.round(v / step) * step * 100) / 100;
/** Keeps a marker's label inside the plot: left-aligned near $0, right-aligned near the top. */
const labelShift = (pct: number) => (pct < 12 ? "none" : pct > 88 ? "translateX(-100%)" : "translateX(-50%)");

const POSITION_TEXT = {
  above: "Above the middle half",
  in_range: "In the middle half",
  below: "Below the middle half",
  too_few: "Too few to place",
} as const;

function groupNoun(group: TryPriceGroup): string {
  if (group.key === "state") return `institutions in ${group.label}`;
  if (group.key === "peers") return "your peer group";
  if (group.key === "local") return "your market";
  if (group.key === "national") return "institutions nationally";
  return `institutions in ${group.label}`;
}

function Counts({ place }: { place: PricePlacement }) {
  return (
    <>
      <span className="tp-mark tp-more">{POSITION_MARK.above} {place.more} charge more</span>
      <span className="tp-mark tp-same">{POSITION_MARK.in_range} {place.same} same</span>
      <span className="tp-mark tp-less">{POSITION_MARK.below} {place.less} charge less</span>
    </>
  );
}

/**
 * Try a price, the interactive part: pick a price with the slider or the number box and every
 * readout, the dot plot's proposed marker, the peers' tags and the fee income arithmetic follow it.
 * Figures come as props, read on the server; the client only recomputes positions for a new price.
 */
export function TryPriceDashboard(props: TryPriceDashboardProps) {
  const { groups, current, slider } = props;
  const [price, setPrice] = useState(props.initialPrice);
  const [priceText, setPriceText] = useState(String(props.initialPrice));
  const [groupKey, setGroupKey] = useState(props.openingGroup ?? groups[0]?.key ?? "");
  const [itemsText, setItemsText] = useState(props.figures.items);
  const [waiverText, setWaiverText] = useState(props.figures.waiver);
  const [notice, setNotice] = useState<{ text: string; href?: string; link?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedRows, setSavedRows] = useState(props.saved);
  const basket = useReportBasket();

  const group = groups.find((g) => g.key === groupKey) ?? groups[0] ?? null;
  const place = useMemo(() => (group ? placePrice(group, price) : null), [group, price]);
  const placeNow = useMemo(() => (group && current != null ? placePrice(group, current) : null), [group, current]);
  const countGroups = useMemo(() => {
    const keys = ["state", "peers"];
    if (group && !keys.includes(group.key)) keys.unshift(group.key);
    return keys.map((k) => groups.find((g) => g.key === k)).filter((g): g is TryPriceGroup => Boolean(g));
  }, [groups, group]);
  const peers = groups.find((g) => g.key === "peers") ?? null;

  const base = current ?? 0;
  const diff = price - base;
  const setFromNumber = (v: number) => {
    setPrice(v);
    setPriceText(String(v));
    setNotice(null);
  };

  // The dot plot: the axis runs to the slider's top, or further when a typed price passes it.
  const axisMax = Math.max(slider.max, Math.ceil(price * 1.05), current ?? 0);
  const plot = useMemo(() => (group ? dotPlot(group.amounts, axisMax, props.peerAmounts) : null), [group, axisMax, props.peerAmounts]);
  const x = (v: number) => Math.max(0, Math.min(100, (v / axisMax) * 100));
  const plotHeight = Math.max(150, 22 + (plot?.tallest ?? 0) * 12 + 40);

  // Fee income on the bank's own figures.
  const items = parseItems(itemsText);
  const waiver = parseWaiver(waiverText);
  const waiverBad = waiverText.trim() !== "" && waiver === null;
  const itemsBad = itemsText.trim() !== "" && items === null;
  const yearly = yearlyChange(current, price, items, waiver);

  const basketId = basketItemId("Test", props.institutionId, props.fee, price);
  const inBrief = basket.some((b) => b.id === basketId);
  const reportHref = hrefWithInstitutionContext("/pro/reports?from=basket", props.institutionId);

  function toggleBrief() {
    if (!props.institutionId) return;
    if (inBrief) {
      removeFromBasket(basketId);
      setNotice({ text: `Removed the ${money(price)} test from your board brief.` });
      return;
    }
    addToBasket({
      id: basketId,
      source: "Test",
      title: `${props.feeName}: test of ${money(price)}`,
      detail: "",
      feeCategory: props.fee,
      institutionId: props.institutionId,
      proposedFee: price,
    });
    setNotice({ text: `Added the ${money(price)} test to your board brief.`, href: reportHref, link: "Open board brief" });
  }

  async function save() {
    if (!props.institutionId || saving) return;
    setSaving(true);
    setNotice(null);
    const tierGroup = peers ?? group;
    const placements = countGroups.map((g) => {
      const p = placePrice(g, price);
      return { group: g.label, n: p.n, more: p.more, same: p.same, less: p.less, percentile: p.percentile, position: p.position };
    });
    const result = await saveScenario({
      institutionId: props.institutionId,
      feeCategory: props.fee,
      currentValue: base,
      proposedValue: price,
      resultJson: { currentFee: current, proposedFee: price, placements, source: props.source },
      confidenceTier: computeConfidenceTier(tierGroup?.n ?? 0),
      evidencePolicy: "verified-only",
    }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : "The scenario was not saved." }));
    setSaving(false);
    if ("error" in result) {
      setNotice({ text: `Not saved. ${result.error}` });
      return;
    }
    const href = hrefWithInstitutionContext(`/pro/simulate?scenario_id=${encodeURIComponent(result.id)}`, props.institutionId);
    setSavedRows((rows) => [
      { id: result.id, fee: props.fee, feeName: props.feeName, current: base, proposed: price, savedOn: "Today", href },
      ...rows,
    ]);
    setNotice({ text: `Saved: ${props.feeName} at ${money(price)}.`, href, link: "Open it" });
  }

  const tableHref = (() => {
    const [path, query = ""] = props.tableHref.split("?");
    const q = new URLSearchParams(query);
    q.set("prices", String(price));
    if (items != null) q.set("paid", String(items));
    if (waiver != null) q.set("waiver", String(Math.round(waiver * 1000) / 10));
    return `${path}?${q.toString()}#side-by-side`;
  })();

  const plotLabel = group && place
    ? `${props.feeName} prices of ${group.n} ${groupNoun(group)}, ${money(place.min ?? 0)} to ${money(place.max ?? 0)}.` +
      (current != null ? ` Now ${money(current)}.` : "") +
      ` Proposed ${money(price)}: ${place.more} charge more, ${place.same} the same, ${place.less} charge less.`
    : "No published prices to plot.";

  return (
    <div className="flex w-full flex-col gap-4 text-warm-900">
      <header className="tp-head">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="hd-label" style={{ color: "var(--fi-brick)" }}>Try a price · {props.feeName}</p>
          <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Test a new price</h1>
          <p className="m-0 text-sm text-warm-700">{props.dek}</p>
        </div>
        <div className="tp-actions">
          <button type="button" className="tp-btn" onClick={save} disabled={!props.institutionId || saving}>
            {saving ? "Saving" : "Save scenario"}
          </button>
          <button type="button" className="tp-btn tp-btn--ink" aria-pressed={inBrief} onClick={toggleBrief} disabled={!props.institutionId}>
            {inBrief ? "In board brief" : "Add to board brief"}
          </button>
          <Link href={props.researchHref} className="inline-flex min-h-10 items-center px-2 text-sm text-terra-text underline">Back to my fees</Link>
        </div>
      </header>
      {notice ? (
        <p role="status" className="tp-notice m-0">
          <span>{notice.text}</span>
          {notice.href ? <Link href={notice.href}>{notice.link}</Link> : null}
        </p>
      ) : (
        <p role="status" className="hd-sr" />
      )}

      {props.fees.length > 0 ? (
        <nav aria-label="Choose a fee" className="flex flex-col gap-2">
          <span className="hd-label">Fee</span>
          <div className="tp-fees">
            {props.fees.map((f) => (
              <Link key={f.category} href={f.href} className="tp-fee" aria-current={f.active ? "page" : undefined}>
                <span className="tp-fee-name">{f.name}</span>
                <span className="tp-fee-now">Now {f.label}</span>
              </Link>
            ))}
          </div>
        </nav>
      ) : null}

      <div className="hd-grid">
        <DashboardCard className="hd-span-7" title={`${props.feeName}: proposed price`} titleId="tp-price">
          <div className="tp-price-row">
            <div className="tp-price-box">
              <span aria-hidden="true">$</span>
              <input
                id="tp-price-number"
                aria-label="Proposed price in dollars"
                type="number"
                inputMode="decimal"
                min={0}
                max={10000}
                step="any"
                value={priceText}
                onChange={(e) => {
                  const t = e.target.value;
                  setPriceText(t);
                  const v = Number(t);
                  if (t.trim() !== "" && Number.isFinite(v) && v >= 0 && v <= 10000) setPrice(Math.round(v * 100) / 100);
                }}
                onBlur={() => setPriceText(String(price))}
              />
            </div>
            {current != null ? (
              <button type="button" className="tp-btn tp-btn--small" onClick={() => setFromNumber(current)}>
                Reset to {money(current)}
              </button>
            ) : null}
          </div>
          <div className="tp-range">
            <label htmlFor="tp-price-range" className="tp-small">Drag to set the price</label>
            <input
              id="tp-price-range"
              type="range"
              min={0}
              max={slider.max}
              step={slider.step}
              value={Math.min(price, slider.max)}
              aria-valuetext={money(price)}
              onChange={(e) => setFromNumber(roundTo(Number(e.target.value), slider.step))}
            />
            <div className="tp-range-ends" aria-hidden="true"><span>$0</span><span>{money(slider.max)}</span></div>
          </div>
          <div className="tp-read3">
            <div>
              <span className="tp-small">Current</span>
              <span className="tp-big">{current != null ? money(current) : "None"}</span>
            </div>
            <div>
              <span className="tp-small">Proposed</span>
              <span className="tp-big tp-brick">{money(price)}</span>
            </div>
            <div>
              <span className="tp-small">Change{current == null ? " from $0" : ""}</span>
              <span className={`tp-big ${Math.abs(diff) < 0.005 ? "hd-muted" : diff > 0 ? "hd-tone-above" : "hd-tone-below"}`}>
                {Math.abs(diff) < 0.005 ? "No change" : signedMoney(diff)}
              </span>
            </div>
          </div>
        </DashboardCard>

        <DashboardCard
          className="hd-span-5"
          title="Where it lands"
          titleId="tp-lands"
          footnote={`Source: ${props.source}`}
          footnoteDetails={`One value per institution, ${props.institutionName} left out. Percentile: the share charging less, plus half of those charging the same. A percentile, median or middle half needs 10 institutions (5 in your market); with fewer, only the spread is shown.`}
        >
          {group && place ? (
            <>
              <div className="tp-pctl">
                <div className="flex flex-col">
                  <span className="tp-pctl-num">{place.percentile != null ? ordinal(Math.round(place.percentile)) : "Too few"}</span>
                  <span className="tp-small">
                    {place.percentile != null
                      ? `percentile, ${groupNoun(group)}${placeNow?.percentile != null ? ` (now ${ordinal(Math.round(placeNow.percentile))})` : ""}`
                      : `Only ${group.n} publish this fee; a percentile needs ${group.minPeers}`}
                  </span>
                </div>
                <span className={`hd-pill hd-pos-${place.position}`}>{POSITION_MARK[place.position]} {POSITION_TEXT[place.position]}</span>
              </div>
              <span className="tp-small">
                {group.p25 != null && group.p75 != null
                  ? <>Middle half: <b className="hd-mono" style={{ color: "var(--fi-ink)" }}>{money(group.p25)} to {money(group.p75)}</b></>
                  : <>Spread: <b className="hd-mono" style={{ color: "var(--fi-ink)" }}>{money(place.min ?? 0)} to {money(place.max ?? 0)}</b></>}
              </span>
              <ul className="tp-counts" aria-label="Institutions charging more, the same and less than the proposed price">
                {countGroups.map((g) => {
                  const p = g === group ? place : placePrice(g, price);
                  return (
                    <li key={g.key}>
                      <span>{g.key === "peers" ? `Your peer group (${g.n})` : `${g.label} (${g.n})`}</span>
                      <Counts place={p} />
                    </li>
                  );
                })}
              </ul>
              {peers ? (
                <span className="tp-small">
                  {peers.median != null
                    ? <>Peer median <b className="hd-mono" style={{ color: "var(--fi-ink)" }}>{money(peers.median)}</b> ({peers.n} publish)</>
                    : `Too few peers for a median: ${peers.n} publish, ${peers.minPeers} needed. Spread ${money(peers.amounts[0])} to ${money(peers.amounts[peers.amounts.length - 1])}.`}
                </span>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-sm">No institution near you publishes this fee yet, so there is nothing to place the price among.</p>
          )}
        </DashboardCard>
      </div>

      {group && plot ? (
        <DashboardCard
          title={`${props.feeName} across ${groupNoun(group)}`}
          titleId="tp-dist"
          actions={groups.length > 1 ? (
            <SegmentedControl label="Compare with" options={groups.map((g) => ({ value: g.key, label: g.key === "peers" ? "Peer group" : g.label }))} value={group.key} onChange={setGroupKey} />
          ) : null}
          footnote={`One dot per ${plot.perDot === 1 ? "institution" : `${plot.perDot} institutions`}. Source: ${props.source}`}
          footnoteDetails={`${group.scope}. Dots stack where prices match.${plot.offScale ? ` ${plot.offScale} priced above ${money(axisMax)} sit at the right edge.` : ""} One value per institution, ${props.institutionName} left out.`}
        >
          <div className="tp-legend" aria-hidden="true">
            <span><span className="tp-key-dot" style={{ background: "#a2a4a9" }} />Other institution</span>
            {peers && group.key !== "peers" ? <span><span className="tp-key-dot" style={{ background: "var(--fi-ink)" }} />In your peer group</span> : null}
            {group.p25 != null ? <span><span className="tp-key-band" />Middle half</span> : null}
            {current != null ? <span><span className="tp-key-now" />Now</span> : null}
            <span><span className="tp-key-prop" />Proposed</span>
          </div>
          <div className="tp-plot" role="img" aria-label={plotLabel} style={{ height: plotHeight }}>
            {group.p25 != null && group.p75 != null ? (
              <span className="tp-plot-band" style={{ left: `${x(group.p25)}%`, width: `${Math.max(0.5, x(group.p75) - x(group.p25))}%` }} />
            ) : null}
            <span className="tp-plot-axis" />
            {plot.columns.flatMap((c) =>
              Array.from({ length: c.dots }, (_, i) => (
                <span key={`${c.x}-${i}`} className={`tp-dot${group.key !== "peers" && i < c.peers ? " tp-dot--peer" : ""}`} style={{ left: `${c.x}%`, bottom: 22 + i * 12 }} />
              )),
            )}
            {current != null ? (
              <>
                <span className="tp-line tp-line--now" style={{ left: `${x(current)}%`, height: plotHeight - 52 }} />
                <span className="tp-line-label" style={{ left: `${x(current)}%`, top: 17, transform: labelShift(x(current)) }}>Now {money(current)}</span>
              </>
            ) : null}
            <span className="tp-line tp-line--prop" style={{ left: `${x(price)}%`, height: plotHeight - 34 }} />
            <span className="tp-line-label tp-brick" style={{ left: `${x(price)}%`, top: 0, transform: labelShift(x(price)) }}>
              Proposed {money(price)}
            </span>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <span key={t} className="tp-tick" style={{ left: `${t * 100}%`, transform: t === 0 ? "none" : t === 1 ? "translateX(-100%)" : undefined }}>
                {money(roundTo(axisMax * t, 0.05))}
              </span>
            ))}
          </div>
        </DashboardCard>
      ) : null}

      <div className="hd-grid">
        <DashboardCard className="hd-span-5" title="Fee income effect" titleId="tp-income">
          <span className="tp-small">Your own figures. {props.figures.saved ? "Filled from My bank and data." : "Not saved."}</span>
          <div className="tp-fields">
            <div className="tp-field">
              <label htmlFor="tp-items">Items charged a year</label>
              <input id="tp-items" inputMode="numeric" value={itemsText} onChange={(e) => setItemsText(e.target.value)} placeholder="Your yearly count" aria-invalid={itemsBad || undefined} aria-describedby="tp-income-out" />
            </div>
            <div className="tp-field">
              <label htmlFor="tp-waiver">Share waived (%)</label>
              <input id="tp-waiver" inputMode="decimal" value={waiverText} onChange={(e) => setWaiverText(e.target.value)} placeholder="0 to 100" aria-invalid={waiverBad || undefined} aria-describedby="tp-income-out" />
            </div>
          </div>
          <div className="tp-out" id="tp-income-out" aria-live="polite">
            <span className="tp-small">Change in fee income a year</span>
            {yearly != null ? (
              <>
                <span className={`tp-big ${yearly > 0 ? "hd-tone-above" : yearly < 0 ? "hd-tone-below" : "hd-muted"}`}>{signedDollars(yearly)}</span>
                <span className="tp-small">
                  {(items ?? 0).toLocaleString("en-US")} items × {Math.round((1 - (waiver ?? 0)) * 1000) / 10}% not waived × {signedMoney(diff)} an item
                </span>
              </>
            ) : (
              <span className="tp-small">
                {itemsBad ? "Type the yearly count as a whole number." : "Type your yearly count to see it. Hamilton never estimates it for you."}
              </span>
            )}
            {waiverBad ? <span className="tp-small">The waived share is a percent from 0 to 100.</span> : null}
          </div>
          <span className="tp-small">An estimate before any change in customer behaviour, not a prediction.</span>
          <details className="hd-more tp-details">
            <summary>What this assumes</summary>
            <ul>
              <li>{current != null ? `Starting price: ${money(current)}, your published ${props.feeProse} fee.` : `Starting price: $0, because no single ${props.feeProse} fee is published for you.`}</li>
              <li>The same number of items is charged at every price. How customers respond is not estimated.</li>
              <li>Calculation: change per item, times items charged a year, times the share not waived. Before tax and any other cost.</li>
            </ul>
          </details>
          {yearly != null ? <a className="tp-link" href={tableHref}>Show with every assumption in the table</a> : (
            <span className="tp-small">To keep your figures, add them in <a className="tp-link" href={props.settingsHref}>My bank and data</a>.</span>
          )}
        </DashboardCard>

        <DashboardCard
          className="hd-span-7"
          title={props.strip ? `${props.strip.title} on ${props.feeProse}` : `Peers on ${props.feeProse}`}
          titleId="tp-peers"
          footnote={props.strip ? `Source: ${props.source}` : null}
          footnoteDetails={props.strip ? `Each tag compares the peer's published price with your proposed price, lowest price first.${props.strip.more ? ` ${props.strip.more} more not shown.` : ""}` : null}
        >
          {props.strip && props.strip.tiles.length > 0 ? (
            <ul className="tp-tiles">
              {props.strip.tiles.map((t) => {
                const tag = Math.abs(t.amount - price) <= 0.005 ? "in_range" : t.amount > price ? "above" : "below";
                const gap = money(Math.round(Math.abs(t.amount - price) * 100) / 100);
                const text = tag === "in_range" ? "Same as proposed" : tag === "above" ? `${gap} more` : `${gap} less`;
                return (
                  <li key={t.id} className="tp-tile">
                    <span className="tp-tile-name">{t.name}</span>
                    <span className="tp-tile-price">{t.label}</span>
                    <span className={`tp-small hd-tone-${tag}`} style={{ fontWeight: 600 }}>{POSITION_MARK[tag]} {text}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="m-0 text-sm">
              No short list of peers for this fee. To see each peer&apos;s price here, save a peer group in{" "}
              <a className="tp-link" href={props.settingsHref}>My bank and data</a>.
            </p>
          )}
        </DashboardCard>
      </div>

      <DashboardCard title="Saved scenarios" titleId="tp-saved" actions={<span className="tp-small">Newest first</span>}>
        {savedRows.length > 0 ? (
          <ul className="tp-saved">
            {savedRows.map((s) => {
              const same = s.fee === props.fee;
              const p = same && group ? placePrice(group, s.proposed) : null;
              return (
                <li key={s.id}>
                  <a href={s.href}>{s.feeName}: {money(s.current)} to {money(s.proposed)}</a>
                  <span className="hd-mono tp-small">{signedMoney(s.proposed - s.current)}</span>
                  <span className="tp-small">
                    {p?.percentile != null ? `${ordinal(Math.round(p.percentile))} percentile today · ` : ""}Saved {s.savedOn}
                  </span>
                  <span className="tp-row-actions">
                    {same ? (
                      <button type="button" className="tp-btn tp-btn--small" onClick={() => setFromNumber(s.proposed)} aria-label={`Load ${money(s.proposed)} into the price`}>
                        Load
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-sm text-warm-700">No saved scenarios yet. Set a price and choose Save scenario.</p>
        )}
      </DashboardCard>
    </div>
  );
}
