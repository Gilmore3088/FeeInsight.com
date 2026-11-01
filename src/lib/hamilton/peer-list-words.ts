import type { PeerListRow } from "./workspace/storyline-types";

/** Why a peer list row shows no fee, in the words the answer screen and the board brief share. */
export const PEER_LIST_MISSING: Record<Exclude<PeerListRow["status"], "published">, string> = {
  not_counted: "On its schedule, not counted",
  not_on_schedule: "Not found on its schedule",
  no_schedule: "No schedule on file",
};

/** A peer list row's fee, or why there is none. */
export function peerListFeeText(r: PeerListRow, money: (n: number) => string): string {
  if (r.status !== "published" || r.amount === null) return PEER_LIST_MISSING[r.status === "published" ? "not_on_schedule" : r.status];
  return r.amountText ?? money(r.amount);
}
