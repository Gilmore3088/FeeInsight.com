import { getArticles } from "./news";
import { STATE_WIRE_READ_CAP, getStateWire, type StateWireItem } from "./state-news";
import { getResearchNotes } from "./wire-research";
import {
  DIGEST_DAYS,
  buildWireDigest,
  type FederalDigestRow,
  type WireDigest,
} from "@/lib/regulatory/wire-digest";
import type { ResearchItemKind, ResearchNote } from "@/lib/regulatory/wire-research";

/**
 * Reads behind the weekly Regulatory Wire digest. The States view's own reader
 * (getStateWire, here over several states) and the Federal view's (getArticles) cover the
 * last 7 days; stage 2's notes add the summaries. Read only; nothing is sent.
 */

/** Most federal releases one week's digest reads (the agencies post a few dozen a week). */
const FEDERAL_WEEK_CAP = 300;

export interface WireDigestInputs {
  stateItems: StateWireItem[];
  federal: FederalDigestRow[];
  notes: Map<string, ResearchNote>;
  /** Parts that could not be read, named for the page. */
  failed: string[];
}

export async function loadWireDigestInputs(states: string[], now: Date, days = DIGEST_DAYS): Promise<WireDigestInputs> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const failed: string[] = [];
  const [wire, federal] = await Promise.all([
    states.length > 0
      ? getStateWire({ stateCodes: states, since, limit: STATE_WIRE_READ_CAP * 3 })
      : Promise.resolve(null),
    getArticles({ since, limit: FEDERAL_WEEK_CAP }).catch((error: unknown) => {
      console.error("[wire-digest] federal read failed", error);
      failed.push("federal releases");
      return [];
    }),
  ]);
  if (wire) {
    for (const kind of wire.failed) failed.push(kind === "bills" ? "fee bills" : kind === "regulators" ? "regulator posts" : "press stories");
  }
  const stateItems = wire?.items ?? [];
  const refs: { kind: ResearchItemKind; id: string }[] = [
    ...stateItems.flatMap((item): { kind: ResearchItemKind; id: string }[] => {
      if (item.kind === "bill") return item.tracker_id ? [{ kind: "tracker", id: item.tracker_id }] : [];
      if (item.kind === "regulator") return item.guid ? [{ kind: "article", id: item.guid }] : [];
      return [];
    }),
    ...federal.map((a) => ({ kind: "article" as const, id: a.guid })),
  ];
  const notes = await getResearchNotes(refs);
  return {
    stateItems,
    federal: federal.map((a) => ({
      guid: a.guid,
      source: a.source,
      title: a.title,
      link: a.link,
      published_at: a.published_at,
      created_at: a.created_at,
    })),
    notes,
    failed,
  };
}

/** One reader's digest for their watched states. */
export async function getWireDigest(states: string[], now: Date): Promise<{ digest: WireDigest; failed: string[] }> {
  const inputs = await loadWireDigestInputs(states, now);
  return { digest: buildWireDigest({ states, ...inputs, now }), failed: inputs.failed };
}
