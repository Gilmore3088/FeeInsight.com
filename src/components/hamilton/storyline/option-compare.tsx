/**
 * Options side by side: every option's price on one peer scale, and on each card where that
 * price would sit (lower than most peers, in line, or higher) and how many local competitors
 * charge less. Options are lettered in the engine's order; nothing here ranks or picks one.
 */
import type { Exhibit } from "@/lib/hamilton/workspace/types";
import type { StoryOption, Storyline } from "./types";
import { axisFor, placeLabels } from "@/components/hamilton/memo/exhibit-view";

export type PeerStanding = "lower" | "in_line" | "higher";

export interface OptionPoint {
  letter: string;
  option: StoryOption;
  /** The dollar price the option tests; null when the option names none. */
  price: number | null;
}

export interface OptionScale {
  band: {
    label: string;
    p25: number;
    median: number;
    p75: number;
    n: number;
  } | null;
  /** Local competitors' prices for the same fee, when the answer carries them. */
  local: number[] | null;
}

const LETTERS = "ABCDEFGH";

/** The price an option tests, as the engine states it; null when the option names none. */
export function optionPrice(option: StoryOption): number | null {
  return typeof option.price === "number" && Number.isFinite(option.price)
    ? option.price
    : null;
}

export function optionPoints(options: readonly StoryOption[]): OptionPoint[] {
  return options.map((option, i) => ({
    letter: LETTERS[i] ?? String(i + 1),
    option,
    price: optionPrice(option),
  }));
}

function exhibitsOf(story: Storyline): Exhibit[] {
  return story.exhibits.map((e) => e.exhibit as Exhibit);
}

export function optionScale(story: Storyline): OptionScale {
  const exhibits = exhibitsOf(story);
  const position = exhibits.find(
    (e): e is Extract<Exhibit, { kind: "fee_position" }> =>
      e.kind === "fee_position",
  );
  const local = exhibits.find(
    (e): e is Extract<Exhibit, { kind: "competitor_range" }> =>
      e.kind === "competitor_range",
  );
  return {
    band: position ? position.band : null,
    local:
      local && local.items.length > 0 ? local.items.map((i) => i.amount) : null,
  };
}

/** Lower than the peer middle half, inside it, or above it. */
export function peerStanding(
  price: number,
  band: { p25: number; p75: number },
): PeerStanding {
  if (price < band.p25) return "lower";
  if (price > band.p75) return "higher";
  return "in_line";
}

export const STANDING_TEXT: Record<PeerStanding, string> = {
  lower: "Lower than most peers",
  in_line: "In line with peers",
  higher: "Higher than most peers",
};

const STANDING_CLASS: Record<PeerStanding, string> = {
  lower: "border-warm-300 bg-warm-100 text-warm-800",
  in_line: "border-warm-300 bg-white text-warm-800",
  higher: "border-terra/40 bg-terra-soft text-terra-text",
};

const money = (v: number) =>
  Number.isInteger(v) ? `$${v.toLocaleString("en-US")}` : `$${v.toFixed(2)}`;

export function OptionLetter({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warm-900 text-xs font-semibold text-white"
    >
      {letter}
    </span>
  );
}

/** The chips on an option card: where its price sits among peers and local competitors. */
export function OptionStanding({
  price,
  scale,
}: {
  price: number | null;
  scale: OptionScale;
}) {
  if (price == null) return null;
  const standing = scale.band ? peerStanding(price, scale.band) : null;
  const lowerLocal = scale.local
    ? scale.local.filter((v) => v < price).length
    : null;
  if (!standing && lowerLocal == null) return null;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {standing ? (
        <span
          className={`rounded-full border px-2 py-0.5 font-medium ${STANDING_CLASS[standing]}`}
        >
          {STANDING_TEXT[standing]}
        </span>
      ) : null}
      {lowerLocal != null && scale.local ? (
        <span className="rounded-full border border-warm-300 bg-white px-2 py-0.5 text-warm-700 [font-variant-numeric:tabular-nums]">
          {lowerLocal} of {scale.local.length} local competitors charge less
        </span>
      ) : null}
    </div>
  );
}

/** Every option's price on one scale against the peer middle half and median. */
export function OptionScaleChart({
  points,
  scale,
  researchInstitutionName,
}: {
  points: OptionPoint[];
  scale: OptionScale;
  researchInstitutionName?: string | null;
}) {
  const priced = points.filter(
    (p): p is OptionPoint & { price: number } => p.price != null,
  );
  if (!scale.band || priced.length < 2) return null;
  const band = scale.band;
  const axis = axisFor([
    band.p25,
    band.median,
    band.p75,
    ...priced.map((p) => p.price),
  ]);
  // Options at the same price share one mark ("A, B").
  const groups = [
    ...new Map(
      priced.map((p) => [p.price, priced.filter((q) => q.price === p.price)]),
    ).entries(),
  ].sort((a, b) => a[0] - b[0]);
  const texts = groups.map(
    ([price, g]) => `${g.map((p) => p.letter).join(", ")}  ${money(price)}`,
  );
  // On a phone the marks show letters only (prices are on the cards), so a width covers both: the
  // full label on a wide track, or the letter badges on a ~320px one.
  const placed = placeLabels(
    groups.map(([price, g], i) => ({
      x: axis.at(price),
      width: Math.max(texts[i].length * 0.62 + 2, g.length * 7.5 + 1),
    })),
  );
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  const top = rows * 22 + 6;

  return (
    <figure className="rounded-lg border border-warm-300 bg-white p-4">
      <figcaption className="mb-2 text-sm font-medium text-warm-900">
        Where each option would position {researchInstitutionName ?? "the research institution"}
      </figcaption>
      <div className="relative" style={{ height: `${top + 46}px` }}>
        {groups.map(([price], i) => (
          <span
            key={`tick-${price}`}
            className="absolute w-px -translate-x-1/2 bg-warm-500"
            style={{
              left: `${axis.at(price)}%`,
              top: `${placed[i].row * 22 + 20}px`,
              height: `${top - placed[i].row * 22 - 14}px`,
            }}
          />
        ))}
        {groups.map(([price, g], i) => (
          <span
            key={`label-${price}`}
            className="absolute flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-warm-900 [font-variant-numeric:tabular-nums]"
            style={{
              left: `${placed[i].left}%`,
              top: `${placed[i].row * 22}px`,
            }}
          >
            {g.map((p) => (
              <span
                key={p.letter}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warm-900 text-[11px] text-white"
              >
                {p.letter}
              </span>
            ))}
            <span className="hidden sm:inline">{money(price)}</span>
          </span>
        ))}
        <span
          className="absolute inset-x-0 h-2 rounded-full bg-warm-200"
          style={{ top: `${top}px` }}
        />
        <span
          className="absolute h-4 rounded bg-terra/25 ring-1 ring-terra/40"
          style={{
            top: `${top - 4}px`,
            left: `${axis.at(band.p25)}%`,
            width: `${axis.at(band.p75) - axis.at(band.p25)}%`,
          }}
        />
        <span
          className="absolute h-6 w-0.5 -translate-x-1/2 bg-warm-800"
          style={{ top: `${top - 8}px`, left: `${axis.at(band.median)}%` }}
        />
        {groups.map(([price]) => (
          <span
            key={`dot-${price}`}
            className="absolute h-3 w-3 -translate-x-1/2 rounded-full bg-warm-900 ring-2 ring-white"
            style={{ left: `${axis.at(price)}%`, top: `${top - 2}px` }}
          />
        ))}
        <span
          className="absolute whitespace-nowrap text-xs text-warm-700 [font-variant-numeric:tabular-nums]"
          style={{
            top: `${top + 20}px`,
            ...(axis.at(band.median) > 70
              ? { right: `${100 - axis.at(band.median)}%` }
              : axis.at(band.median) < 30
                ? { left: `${axis.at(band.median)}%` }
                : {
                    left: `${axis.at(band.median)}%`,
                    transform: "translateX(-50%)",
                  }),
          }}
        >
          Peer median {money(band.median)}
        </span>
      </div>
      <p className="mt-1 text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
        Shaded: the middle half of {band.label}, {money(band.p25)} to{" "}
        {money(band.p75)} ({band.n} institutions).
      </p>
    </figure>
  );
}
