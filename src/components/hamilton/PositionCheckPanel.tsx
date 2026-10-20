/**
 * Position check: a proposed fee placed among the peers, with the named peers just below and
 * above it and how many were compared. A plain GET form, so it works without client script.
 * Used on Try a price and in the pricing committee packet. It never says whether to charge it.
 */
import type { PositionCheck, PositionNeighbours } from "@/lib/hamilton/position-check";
import { namedPeers } from "@/lib/hamilton/position-check";
import { ANSWER_TYPE, SERIF, fmtMoney } from "@/components/hamilton/memo/memo";

const controlClass =
  "min-h-11 w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";

function Side({ label, side }: { label: string; side: PositionNeighbours | null }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <dt className="text-[13px] text-warm-600">{label}</dt>
      <dd className="mt-1 text-sm text-warm-900">
        {side ? (
          <>
            <span className={`font-semibold ${ANSWER_TYPE.num}`}>{fmtMoney(side.amount)}</span>{" "}
            <span>{namedPeers(side.peers)}</span>
            {side.peers[0]?.documentUrl ? (
              <>
                {" · "}
                <a href={side.peers[0].documentUrl} className="text-terra-text underline" rel="noopener noreferrer" target="_blank">
                  schedule
                </a>
              </>
            ) : null}
          </>
        ) : (
          "None found"
        )}
      </dd>
    </div>
  );
}

export function PositionCheckResult({ check, feeName, peerLabel, readOn }: { check: PositionCheck; feeName: string; peerLabel: string; readOn: string }) {
  return (
    <div className="flex flex-col gap-2" role="status">
      <p className={ANSWER_TYPE.body} style={SERIF}>
        <span className={`font-semibold ${ANSWER_TYPE.num}`}>{fmtMoney(check.proposed)}</span> for {feeName.toLowerCase()}
        {check.percentile === null ? `: ${check.placement}.` : <> would sit <span className={ANSWER_TYPE.num}>{check.placement}</span>.</>}
      </p>
      <dl className="grid gap-px overflow-hidden rounded-lg border border-warm-300 bg-warm-300 sm:grid-cols-3">
        <div className="min-w-0 bg-white px-4 py-3">
          <dt className="text-[13px] text-warm-600">Peers compared</dt>
          <dd className={`mt-1 text-sm text-warm-900 ${ANSWER_TYPE.num}`}>
            {check.n} · {check.less} charge less, {check.same} about the same, {check.more} more
          </dd>
        </div>
        <Side label="Nearest peer below" side={check.below} />
        <Side label="Nearest peer above" side={check.above} />
      </dl>
      <p className={ANSWER_TYPE.caption}>
        Against {peerLabel}: each peer&apos;s published fee, one comparison value per institution, read {readOn}.
      </p>
    </div>
  );
}

export function PositionCheckPanel({
  id = "position-check",
  label,
  action,
  hidden,
  name = "check",
  defaultValue,
  check,
  feeName,
  peerLabel,
  readOn,
  fees,
  feeParam = "fee",
  selectedFee,
  invalid = false,
  unavailable = null,
}: {
  /** The section's anchor; the form's action should end in `#${id}` so the result stays in view. */
  id?: string;
  /** "Exhibit 7" when the panel is numbered with a document's exhibits. */
  label?: string;
  action: string;
  /** Parameters the form carries along so the rest of the page stays as it was. */
  hidden: Record<string, string | null | undefined>;
  name?: string;
  defaultValue?: string;
  check: PositionCheck | null;
  feeName: string;
  peerLabel: string;
  /** When the peers' fees were read, as a reader writes the date. */
  readOn: string;
  /** With a list, the reader picks the fee too (the packet); without, the page's fee is used. */
  fees?: { category: string; name: string }[];
  feeParam?: string;
  selectedFee?: string;
  /** The typed price could not be read. */
  invalid?: boolean;
  /** Said instead of the form when the peers cannot be listed by name. */
  unavailable?: string | null;
}) {
  const errorId = `${id}-error`;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5">
      <div>
        {label ? <p className={ANSWER_TYPE.kicker}>{label}</p> : null}
        <h2 id={`${id}-title`} className="text-lg font-bold text-warm-900 sm:text-xl" style={SERIF}>
          Position check
        </h2>
        <p className="mt-1 text-sm text-warm-600">Enter a proposed fee to see where it would sit among the peers.</p>
      </div>
      {unavailable ? (
        <p className="text-sm text-warm-700">{unavailable}</p>
      ) : (
        <>
          <form method="get" action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            {fees ? (
              <label className="flex flex-col gap-1 text-sm text-warm-800">
                Fee
                <select name={feeParam} defaultValue={selectedFee} className={controlClass}>
                  {fees.map((f) => (
                    <option key={f.category} value={f.category}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className={`flex flex-col gap-1 text-sm text-warm-800 ${fees ? "" : "sm:col-span-2"}`}>
              Proposed fee
              <span className="relative">
                <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-warm-600">
                  $
                </span>
                <input
                  name={name}
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={defaultValue}
                  placeholder="30"
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  className={`${controlClass} pl-7 ${ANSWER_TYPE.num}`}
                />
              </span>
            </label>
            <button type="submit" className="min-h-11 rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2">
              Check position
            </button>
          </form>
          {invalid ? (
            <p id={errorId} role="alert" className="text-sm text-terra-text">
              Enter the fee as a dollar amount, for example 30 or 2.50.
            </p>
          ) : null}
          {check ? <PositionCheckResult check={check} feeName={feeName} peerLabel={peerLabel} readOn={readOn} /> : null}
        </>
      )}
    </section>
  );
}
