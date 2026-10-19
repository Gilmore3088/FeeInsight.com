import { normalizeLei } from "./gleif";
import type { FdicIdentityHold } from "@/lib/data-store/fdic-identity-holds";

export const FDIC_IDENTITY_HOLD_REASON = "FDIC identity hold requires review";

/** A publisher conflict vetoes every matching route; it never removes duplicate owners. */
export function createGleifIdentityVeto(holds: readonly FdicIdentityHold[]) {
  const ids = new Set(holds.flatMap((hold) => hold.institutionId === null ? [] : [hold.institutionId]));
  const certificates = new Set(holds.map((hold) => hold.certificate));
  const leis = new Set(holds.flatMap((hold) => hold.implicatedLeis).map(normalizeLei).filter((lei): lei is string => lei !== null));
  return {
    blocksInstitution(id: number | null, certificate?: string | null, source?: string | null) {
      return (id !== null && ids.has(id)) || (source === "fdic" && certificate != null && certificates.has(certificate.trim()));
    },
    blocksLei(lei: string | null | undefined) {
      const normalized = normalizeLei(lei);
      return normalized !== null && leis.has(normalized);
    },
    institutionLeis(id: number, certificate?: string | null, source?: string | null) {
      return [...new Set(holds.filter((hold) => hold.institutionId === id
        || (source === "fdic" && certificate != null && hold.certificate === certificate.trim())).flatMap((hold) => hold.implicatedLeis))].sort();
    },
  };
}
