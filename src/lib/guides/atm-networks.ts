/**
 * "Networks named in fee schedules" on the ATM guide: which institutions' own out-of-network ATM
 * lines name a surcharge-free network, shown verbatim with the amount and the source.
 *
 * Naming a network is not membership. A line can name a network to waive a fee ("Free at CO-OP
 * ATMs") or to charge one ("Allpoint is a non-Connex ATM: then $2.00"), so the guide never says an
 * institution belongs to a network; it shows the institution's own words. Pure: no database
 * import, so the client exhibit can import these types.
 */

export const ATM_NETWORKS = [
  { id: "allpoint", name: "Allpoint", pattern: /allpoint/i },
  { id: "moneypass", name: "MoneyPass", pattern: /money ?pass/i },
  // "CO-OP", "Co-op", "coop" as a word; never "cooperative" or "co-operative".
  { id: "coop", name: "CO-OP", pattern: /\bco-?op\b/i },
] as const;

export type AtmNetworkId = (typeof ATM_NETWORKS)[number]["id"];

/** The networks a schedule line's text names, in ATM_NETWORKS order. */
export function networksNamed(text: string): AtmNetworkId[] {
  return ATM_NETWORKS.filter((n) => n.pattern.test(text)).map((n) => n.id);
}

/** One published line as the loader reads it from published_fee_catalog. */
export interface NetworkFeeRow {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  fee_name: string;
  amount: number | string;
  conditions: string | null;
  waiver_text: string | null;
  document_url: string | null;
}

export interface NetworkFeeLine {
  feeName: string;
  amount: number;
  /** The schedule's own words that name the network, when the fee name itself does not. */
  namedIn: string | null;
  documentUrl: string | null;
}

export interface NetworkInstitution {
  institutionId: number;
  name: string;
  state: string | null;
  lines: NetworkFeeLine[];
}

export interface NetworkMentions {
  id: AtmNetworkId;
  name: string;
  institutions: NetworkInstitution[];
}

const MAX_NAMED_IN = 180;

/** Text cut at a word near `max`, marked with an ellipsis. */
function clip(text: string, max = MAX_NAMED_IN): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

function lineFor(row: NetworkFeeRow, pattern: RegExp): NetworkFeeLine {
  const feeName = row.fee_name.replace(/\s+/g, " ").trim();
  const named = pattern.test(feeName) ? null : [row.conditions, row.waiver_text].find((t) => t && pattern.test(t)) ?? null;
  return {
    feeName,
    amount: Number(row.amount),
    namedIn: named ? clip(named) : null,
    documentUrl: row.document_url,
  };
}

/**
 * Rows grouped by network, then institution. A row that names two networks appears under both.
 * Institutions sort by state then name; each institution's lines by amount, then name, with
 * exact repeats of the same line dropped.
 */
export function buildNetworkMentions(rows: NetworkFeeRow[]): NetworkMentions[] {
  return ATM_NETWORKS.map((network) => {
    const byInstitution = new Map<number, NetworkInstitution>();
    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount < 0) continue;
      const text = [row.fee_name, row.conditions, row.waiver_text].filter(Boolean).join(" ");
      if (!network.pattern.test(text)) continue;
      const id = Number(row.institution_id);
      const inst = byInstitution.get(id) ?? { institutionId: id, name: row.institution_name, state: row.state_code, lines: [] };
      const line = lineFor(row, network.pattern);
      const repeat = inst.lines.some((l) => l.feeName === line.feeName && l.amount === line.amount && l.namedIn === line.namedIn);
      if (!repeat) inst.lines.push(line);
      byInstitution.set(id, inst);
    }
    const institutions = [...byInstitution.values()]
      .map((i) => ({ ...i, lines: i.lines.sort((a, b) => a.amount - b.amount || a.feeName.localeCompare(b.feeName)) }))
      .sort((a, b) => (a.state ?? "~").localeCompare(b.state ?? "~") || a.name.localeCompare(b.name));
    return { id: network.id, name: network.name, institutions };
  });
}

/** True when no network has a single institution: the exhibit is not shown and the read is not cached. */
export function isEmptyNetworkMentions(value: NetworkMentions[] | null | undefined): boolean {
  return !value || value.every((n) => n.institutions.length === 0);
}
