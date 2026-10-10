import { describe, expect, it } from "vitest";
import { hamiltonIdentityLines, readHamiltonIdentitySnapshot } from "./identity-display";

describe("frozen Hamilton identity display", () => {
  const legacy = { version: 1, researchInstitutionId: 202, accountInstitutionId: 101, accountStatus: "identified" };
  it("reads minimal legacy records without substituting today's account or peers", () => {
    expect(readHamiltonIdentitySnapshot(legacy)).toEqual(legacy);
    expect(hamiltonIdentityLines(readHamiltonIdentitySnapshot(legacy))).toEqual(["Research institution: Institution 202", "Account institution: Institution 101", "Peer baseline: Not recorded"]);
  });
  it("preserves original named subject, home and peer group for saved views and exports", () => {
    const snapshot = { ...legacy, researchInstitutionName: "Research Bank", accountInstitutionName: "Home CU", researchSelectionSource: "url",
      peerSetId: 51, peerBaselineLabel: "Original peers", peerBaselineSource: "saved_peer_set", peerBaselineFallbackReason: "Verified peer baseline" };
    expect(readHamiltonIdentitySnapshot({ ...snapshot, userEmail: "private@example.test", notes: "secret" })).toEqual(snapshot);
    expect(hamiltonIdentityLines(snapshot as ReturnType<typeof readHamiltonIdentitySnapshot>)).toEqual([
      "Research institution: Research Bank", "Account institution: Home CU", "Research selection: url", "Peer baseline: Original peers (saved_peer_set)", "Peer baseline note: Verified peer baseline",
    ]);
  });
  it("rejects unsupported versions and malformed IDs", () => {
    for (const value of [null, [], {}, { ...legacy, version: 2 }, { ...legacy, researchInstitutionId: "202" }, { ...legacy, accountInstitutionId: -1 }, { ...legacy, accountStatus: "owner" }]) {
      expect(readHamiltonIdentitySnapshot(value)).toBeNull();
    }
  });
  it("labels uncertainty separately from research identity", () => {
    expect(hamiltonIdentityLines({ ...legacy, version: 1, accountStatus: "ambiguous", accountInstitutionId: null })).toContain("Account institution: Multiple memberships; not selected");
  });
});
