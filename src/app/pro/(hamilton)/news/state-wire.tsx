import Link from "next/link";
import type { StateWireItem, StateWirePage } from "@/lib/data-store/state-news";
import {
  BILL_STEPS,
  WIRE_KINDS,
  billProgress,
  formatWireDate,
  wireHref,
  type PageWindow,
  type WireKind,
  type WireParams,
} from "@/lib/regulatory/wire";
import { FEE_TYPE_LABELS, feeTypesOf } from "@/lib/regulatory/wire-fee-types";
import type { FeeDataStrip } from "@/lib/regulatory/wire-fee-links";
import { billTimeline, researchKey, type RelatedItem, type ResearchNote } from "@/lib/regulatory/wire-research";
import { STATE_NAMES } from "@/lib/us-states";
import { ResearchPanel } from "./research-panel";
import { FeeChips, WireDate, WirePager, WireSummary } from "./wire-controls";

/**
 * The Regulatory Wire's States view: one chronological feed for the chosen jurisdiction,
 * mixing its fee bills, its regulators' own posts and the press coverage. Every item carries
 * its kind; official items (bills, regulator posts) have a solid rule and badge, press has a
 * dashed rule and an outlined badge naming the outlet, so a story never reads as a release.
 */

function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

const KIND_NOUN: Record<WireKind, [string, string]> = {
  bills: ["fee bill tracked", "fee bills tracked"],
  regulators: ["regulator post", "regulator posts"],
  press: ["press story", "press stories"],
};

function plural(n: number, [one, many]: [string, string]): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * The jurisdiction select, rendered inside the shared control bar's GET form. A reader who
 * watches states gets "My states" first, and "All states" is then sent as `state=all` so it
 * is not mistaken for no choice (which opens on My states).
 */
export function JurisdictionField({
  states,
  active,
  watched = [],
  mine = false,
}: {
  states: string[];
  active: string | undefined;
  watched?: string[];
  mine?: boolean;
}) {
  const options = active && !states.includes(active) ? [...states, active].sort() : states;
  const allValue = watched.length > 0 ? "all" : "";
  return (
    <span className="flex w-full items-center gap-2 sm:w-auto">
      <label htmlFor="wire-state" className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-warm-600">
        Jurisdiction
      </label>
      <select
        id="wire-state"
        name="state"
        defaultValue={mine && watched.length > 0 ? "mine" : active ?? allValue}
        className="min-w-0 flex-1 rounded-lg border border-warm-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-warm-900 sm:w-44 sm:flex-none"
      >
        {watched.length > 0 ? <option value="mine">My states ({watched.length})</option> : null}
        <option value={allValue}>All states</option>
        {options.map((code) => (
          <option key={code} value={code}>
            {stateName(code)}
          </option>
        ))}
      </select>
    </span>
  );
}

function KindBadge({ item }: { item: StateWireItem }) {
  const base = "kind-badge shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider";
  if (item.kind === "bill") return <span className={`${base} bg-[#C44B2E] text-white`}>Bill</span>;
  if (item.kind === "regulator") return <span className={`${base} bg-warm-900 text-white`}>Regulator</span>;
  return (
    <span className={`${base} border border-dashed border-warm-500 bg-transparent text-warm-700`}>
      Press · <span className="normal-case tracking-normal">{item.publisher ?? "outlet not named"}</span>
    </span>
  );
}

/** Introduced → Committee → Passed a chamber → Enacted, with a veto or failure as the end. */
export function BillStepper({ stage }: { stage: string | null }) {
  const progress = billProgress(stage);
  const stopped = progress.end !== null;
  return (
    <div className="mt-2">
      <ol aria-label={`Bill progress: ${progress.label}`} className="grid grid-cols-4 gap-1">
        {BILL_STEPS.map((step, i) => {
          const done = i < progress.reached;
          const current = i === progress.reached - 1;
          return (
            <li key={step} aria-current={current ? "step" : undefined} className="min-w-0">
              <span
                aria-hidden="true"
                className={`block h-1 rounded-full ${done ? (stopped ? "bg-warm-600" : "bg-[#C44B2E]") : "bg-warm-200"}`}
              />
              <span
                className={`mt-1 block text-[10px] leading-tight ${
                  current ? "font-semibold text-warm-900" : done ? "text-warm-700" : "text-warm-600"
                }`}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      {stopped ? (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded border border-warm-300 bg-warm-150 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warm-900">
          <span aria-hidden="true">■</span> {progress.label}
          {progress.end === "failed" ? <span className="font-medium normal-case tracking-normal text-warm-600"> · how far it got is not recorded</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/** The key a state item's fee-data strip is stored under on the page (every item has one). */
export function stateStripKey(item: StateWireItem): string {
  if (item.kind === "bill") return `bill:${item.state_code}:${item.identifier ?? item.title}`;
  return `link:${item.link}`;
}

/** The key a state item's note and related items are stored under; null for older rows. */
export function stateItemKey(item: StateWireItem): string | null {
  if (item.kind === "bill") return item.tracker_id ?? null;
  return item.guid ?? null;
}

function ItemRow({
  item,
  now,
  showState,
  note,
  related,
  feeData,
  open = false,
  exampleFees = false,
}: {
  item: StateWireItem;
  now: Date;
  showState: boolean;
  note: ResearchNote | null;
  related: RelatedItem[];
  feeData: FeeDataStrip | null;
  open?: boolean;
  exampleFees?: boolean;
}) {
  const rail =
    item.kind === "bill"
      ? "border-solid border-[#C44B2E]"
      : item.kind === "regulator"
        ? "border-solid border-warm-800"
        : "border-dashed border-warm-400";
  const title =
    item.kind === "bill" ? item.title : item.kind === "regulator" ? item.title : item.headline;
  const href = item.kind === "bill" ? item.url : item.link;
  const fees = feeTypesOf(title);
  const body = (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
        <KindBadge item={item} />
        {showState ? <span className="font-semibold uppercase tracking-wider text-warm-700">{stateName(item.state_code)}</span> : null}
        {item.kind === "bill" && item.identifier ? (
          <span className="font-semibold text-warm-700 [font-variant-numeric:tabular-nums]">{item.identifier}</span>
        ) : null}
        {fees.length > 0 ? (
          <span className="font-semibold text-[#A93D25]">{fees.map((f) => FEE_TYPE_LABELS[f]).join(", ")}</span>
        ) : item.kind === "regulator" && item.fee_related ? (
          <span className="font-semibold uppercase tracking-wider text-[#A93D25]">Fees</span>
        ) : null}
      </p>
      <h3
        className={`mt-1.5 text-[16px] font-medium leading-snug transition-colors group-hover:text-[#A93D25] sm:text-[17px] ${
          item.kind === "press" ? "text-warm-700" : "text-warm-900"
        }`}
      >
        {title}
      </h3>
      {item.kind === "bill" ? <BillStepper stage={item.stage} /> : null}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-warm-600">
        {item.kind === "bill" ? (
          <>
            <WireDate value={item.stage_on ?? item.introduced_on} now={now} prefix={item.stage_on ? "Latest action" : "Introduced"} />
            <span aria-hidden="true">·</span>
            <span>{billProgress(item.stage).label}</span>
          </>
        ) : item.kind === "regulator" ? (
          <>
            <WireDate value={item.published_at} now={now} prefix="Posted" />
            <span aria-hidden="true">·</span>
            <span>{stateName(item.state_code)} banking regulator</span>
          </>
        ) : (
          <>
            <WireDate value={item.published_at} now={now} prefix="Published" />
            <span className="basis-full italic">The outlet&apos;s reporting, not an official release</span>
          </>
        )}
      </p>
    </>
  );
  return (
    <li data-kind={item.kind} className="relative">
      {/* Official items get a solid rule, press a dashed one. */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-0 border-l-[3px] ${rail}`} />
      {href && /^https?:\/\//i.test(href) ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="group block px-4 pb-3 pt-3.5 no-underline transition-colors hover:bg-warm-100/80">
          {body}
        </a>
      ) : (
        <div className="px-4 pb-3 pt-3.5">{body}</div>
      )}
      <div className="px-4">
        <ResearchPanel
          note={item.kind === "press" ? null : note}
          related={related}
          press={item.kind === "press"}
          timeline={item.kind === "bill" ? billTimeline({ introducedOn: item.introduced_on, stage: item.stage, stageOn: item.stage_on }) : undefined}
          now={now}
          feeData={feeData}
          exampleFees={exampleFees}
          open={open}
        />
      </div>
    </li>
  );
}

function emptyMessage(params: WireParams, where: string, phrase: string): string {
  const searched = params.q ? ` matching “${params.q}”` : "";
  const bills = "Fee bills come from Open States and are kept only when the bill names a bank or credit union fee; each state's bills are checked once a week.";
  const news = "Regulator posts and press stories are read once a day.";
  if (params.kind === "bills") return `No fee bills are stored for ${where} ${phrase}${searched}. ${bills}`;
  if (params.kind === "regulators") return `No regulator posts are stored for ${where} ${phrase}${searched}. Only the state banking and credit union regulators' posts about banking are kept. ${news}`;
  if (params.kind === "press") return `No press stories are stored for ${where} ${phrase}${searched}. Press stories are the news coverage of state fee bills and bank fees. ${news}`;
  return `Nothing is stored for ${where} ${phrase}${searched}: no fee bills, regulator posts or press stories. ${news} ${bills}`;
}

/** The reader's watched states, for My states and the Watch toggle. */
export interface WireWatch {
  /** Watched state codes, alphabetical. */
  states: string[];
  /** Items per watched state dated after the reader's last visit; absent before a first visit. */
  newByState?: Record<string, number>;
  /** When the reader last opened My states (ISO), for the "new since" line. */
  lastViewedAt?: string | null;
  /** The form action behind "Watch this state" (watch-actions.ts). */
  action: (formData: FormData) => void | Promise<void>;
  /** Most states one reader can watch. */
  max: number;
}

function WatchToggle({ state, watch }: { state: string; watch: WireWatch }) {
  const watching = watch.states.includes(state);
  const full = !watching && watch.states.length >= watch.max;
  return (
    <form action={watch.action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="watch" value={watching ? "0" : "1"} />
      <button
        type="submit"
        disabled={full}
        aria-pressed={watching}
        className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
          watching
            ? "border-[#C44B2E] bg-[#C44B2E] text-white hover:bg-[#A93D25]"
            : "border-warm-300 bg-white text-warm-900 hover:border-[#C44B2E] hover:text-[#A93D25]"
        }`}
      >
        {watching ? "★ Watching this state" : "☆ Watch this state"}
      </button>
      <span className="text-[11px] text-warm-600">
        {watching
          ? "In My states and your weekly Wire digest. Click to stop watching."
          : full
            ? `You watch ${watch.max} states, the most allowed.`
            : "Adds it to My states and your weekly Wire digest."}
      </span>
    </form>
  );
}

function MyStatesBar({ params, watch, now }: { params: WireParams; watch: WireWatch; now: Date }) {
  const last = watch.lastViewedAt ? formatWireDate(watch.lastViewedAt, now)?.absolute ?? null : null;
  return (
    <div className="mt-2.5 rounded-lg border border-warm-200 bg-white/70 px-3 py-2">
      <ul className="flex flex-wrap gap-1.5">
        {watch.states.map((code) => {
          const fresh = watch.newByState?.[code] ?? 0;
          return (
            <li key={code}>
              <Link
                href={wireHref(params, { state: code, mine: false, page: 1 })}
                className="inline-flex items-center gap-1.5 rounded-full border border-warm-200 bg-white px-2.5 py-1 text-[12px] font-medium text-warm-900 no-underline hover:border-[#C44B2E]"
              >
                {stateName(code)}
                {fresh > 0 ? (
                  <span className="rounded-full bg-[#C44B2E] px-1.5 text-[10px] font-bold text-white [font-variant-numeric:tabular-nums]">
                    {fresh} new
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-warm-600">
        <span>
          {last
            ? `"New" counts items dated after your last visit to My states (${last}).`
            : "New-item counts start from this visit."}
        </span>
        <Link href="/pro/news/digest" className="font-semibold text-[#A93D25] no-underline hover:underline">
          This week&apos;s Wire digest →
        </Link>
      </p>
    </div>
  );
}

export function StateWire({
  params,
  wire,
  win,
  phrase,
  now,
  notes,
  related,
  feeData,
  watch,
  openPanels = [],
  exampleFees = false,
}: {
  params: WireParams;
  wire: Pick<StateWirePage, "items" | "counts" | "failed" | "capped">;
  win: PageWindow;
  phrase: string;
  now: Date;
  /** Research notes keyed by researchKey(kind, id). */
  notes?: Map<string, ResearchNote>;
  /** Related bills or press, keyed by stateItemKey. */
  related?: Map<string, RelatedItem[]>;
  /** "In the fee data" strips, keyed by stateStripKey. */
  feeData?: Map<string, FeeDataStrip>;
  /** The reader's watched states; absent when they cannot be read. */
  watch?: WireWatch;
  /** Preview only: strip keys whose panel renders open. */
  openPanels?: string[];
  /** Preview only: fee figures labelled EXAMPLE. */
  exampleFees?: boolean;
}) {
  const mine = Boolean(params.mine && watch && watch.states.length > 0);
  const where = params.state ? stateName(params.state) : mine ? "your watched states" : "any state";
  const noun = params.kind === "bills" ? "fee bills" : params.kind === "regulators" ? "regulator posts" : params.kind === "press" ? "press stories" : "items";
  const count = (k: WireKind) => {
    const n = wire.counts[k];
    if (wire.failed.includes(k)) return `${KIND_NOUN[k][1]} could not be read`;
    return `${wire.capped.includes(k) ? "at least " : ""}${plural(n, KIND_NOUN[k])}`;
  };

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-[1.375rem] leading-tight text-warm-900">{params.state ? stateName(params.state) : mine ? "My states" : "All states"}</h2>
        <p className="text-[12px] text-warm-600 [font-variant-numeric:tabular-nums]">
          {count("bills")} · {count("regulators")} · {count("press")} <span className="whitespace-nowrap">{phrase}</span>
        </p>
      </div>

      {params.state && watch ? (
        <div className="mt-2">
          <WatchToggle state={params.state} watch={watch} />
        </div>
      ) : null}
      {mine && watch ? <MyStatesBar params={params} watch={watch} now={now} /> : null}
      {!params.state && !mine && watch && watch.states.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-warm-600">
          Pick a state and choose <span className="font-semibold text-warm-700">Watch this state</span> to collect it under My states.
        </p>
      ) : null}

      <nav aria-label="Kind" className="mt-3 flex gap-1 overflow-x-auto border-b border-warm-200 text-[12px]">
        {WIRE_KINDS.map((k) => {
          const active = (params.kind ?? null) === k.key;
          return (
            <Link
              key={k.label}
              href={wireHref(params, { kind: k.key ?? undefined, page: 1 })}
              aria-current={active ? "true" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-1.5 font-medium no-underline transition-colors ${
                active ? "border-[#C44B2E] text-warm-900" : "border-transparent text-warm-600 hover:text-warm-900"
              }`}
            >
              {k.label}
            </Link>
          );
        })}
      </nav>

      <WireSummary params={params} win={win} noun={noun} phrase={phrase} />
      <FeeChips params={params} />

      {wire.failed.length > 0 ? (
        <p role="status" className="mt-2 rounded-lg border border-warm-300 bg-warm-150 px-3 py-2 text-[12px] text-warm-700">
          {wire.failed.map((k) => KIND_NOUN[k][1].replace(" tracked", "")).join(" and ")} could not be read just now, so they are missing from this list and its count.
        </p>
      ) : null}

      <div className="mt-3">
        {wire.items.length === 0 ? (
          <div className="rounded-xl border border-warm-200 bg-white/70 px-5 py-8 text-center">
            <p className="mx-auto max-w-lg text-[13px] leading-relaxed text-warm-700">{emptyMessage(params, where, phrase)}</p>
          </div>
        ) : (
          <ol className="divide-y divide-warm-200/60 overflow-hidden rounded-xl border border-warm-200 bg-white/70">
            {wire.items.map((item) => {
              const key = stateItemKey(item);
              const note = key ? notes?.get(researchKey(item.kind === "bill" ? "tracker" : "article", key)) ?? null : null;
              return (
                <ItemRow
                  key={`${item.kind}:${item.kind === "bill" ? `${item.state_code}-${item.identifier ?? item.title}` : item.link}`}
                  item={item}
                  now={now}
                  showState={!params.state}
                  note={note}
                  related={key ? related?.get(key) ?? [] : []}
                  feeData={feeData?.get(stateStripKey(item)) ?? null}
                  open={openPanels.includes(stateStripKey(item))}
                  exampleFees={exampleFees}
                />
              );
            })}
          </ol>
        )}
      </div>
      <WirePager params={params} win={win} />

      <p className="mt-5 text-[11px] leading-relaxed text-warm-600">
        <strong className="font-semibold text-warm-700">Bill</strong> and <strong className="font-semibold text-warm-700">Regulator</strong> items are
        official: a bill in the state legislature (from Open States) or a post by the state&apos;s banking or credit union
        regulator. <strong className="font-semibold text-warm-700">Press</strong> items are news coverage, named by outlet, and are
        not the regulator&apos;s word. Dates are the publication day or, for bills, the latest action (UTC). Research
        panels hold an AI summary of an official item&apos;s own text where one has been written, labelled as such;
        press stories are never summarised. A story is linked to a bill when its headline names the bill.
      </p>
    </div>
  );
}
