import { beforeEach, describe, expect, it, vi } from "vitest";

const coverageRead = vi.fn();
const peerGroup = vi.fn();
vi.mock("@/lib/data-store/institution-coverage", () => ({ getInstitutionFeeCoverage: (...a: unknown[]) => coverageRead(...a) }));
vi.mock("./workspace/research", () => ({ getEnginePeerGroup: (...a: unknown[]) => peerGroup(...a) }));

import { briefingPeer, readBriefCoverage, readInstitutionCoverage } from "./coverage-read";
import type { Briefing } from "./workspace/types";

const NOW = new Date("2026-10-27T15:00:00Z");
const institution = { id: 9701940, name: "Harbor Ridge Test Bank" };
const read = { fees: 12, categories: ["nsf", "overdraft"], documents: [{ id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement" }], lastVerifiedAt: "2026-10-24T01:00:00.000Z" };

describe("coverage reads (#1891)", () => {
  beforeEach(() => { coverageRead.mockReset().mockResolvedValue(read); peerGroup.mockReset(); });

  it("takes the peer set and its size from the briefing the page already holds", () => {
    const briefing = { peerLabel: "Texas banks", provenance: { peerGroup: { label: "Texas banks", n: 38 } } } as unknown as Briefing;
    expect(briefingPeer(briefing)).toEqual({ label: "Texas banks", institutions: 38 });
    expect(briefingPeer({ peerLabel: "Texas banks", provenance: {} } as unknown as Briefing)).toBeNull();
    expect(briefingPeer(null)).toBeNull();
  });

  it("builds the coverage from the data-store read", async () => {
    expect(await readInstitutionCoverage(institution, null, NOW)).toEqual({
      institutionId: 9701940, institutionName: "Harbor Ridge Test Bank", readAt: "2026-10-27T15:00:00.000Z", ...read, peer: null,
    });
  });

  it("a brief keeps the peer size only when today's group is the saved answer's baseline, counting sister charters once", async () => {
    peerGroup.mockResolvedValue({
      institutionName: "Harbor Ridge Test Bank", peerLabel: "Texas banks", saved: false,
      fees: [
        { feeCategory: "nsf", peers: [{ institutionId: 1 }, { institutionId: 2 }, { institutionId: 3, countedAs: 2 }] },
        { feeCategory: "overdraft", peers: [{ institutionId: 1 }, { institutionId: 4 }] },
      ],
    });
    expect((await readBriefCoverage(institution, "Texas banks", {}, NOW)).peer).toEqual({ label: "Texas banks", institutions: 3 });
    expect(peerGroup).toHaveBeenCalledWith(9701940, ["nsf", "overdraft"], {});
    expect((await readBriefCoverage(institution, "Banks nationally", {}, NOW)).peer).toBeNull();
  });

  it("a brief with no baseline, or a failed peer read, prints no peer size", async () => {
    expect((await readBriefCoverage(institution, null, {}, NOW)).peer).toBeNull();
    expect(peerGroup).not.toHaveBeenCalled();
    peerGroup.mockRejectedValue(new Error("down"));
    expect((await readBriefCoverage(institution, "Texas banks", {}, NOW)).peer).toBeNull();
  });
});
