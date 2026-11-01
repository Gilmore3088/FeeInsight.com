import { describe, expect, it } from "vitest";

import { HAND_LINK_REJECT_REASON } from "@/lib/agents/atlas/hand-link-repair";
import { DOCUMENT_OWNER_REASON } from "@/lib/agents/darwin/document-owner";
import { UNCONFIRMED_HOST_REASON } from "@/lib/agents/hamilton/other-bank-document";
import { OTHER_BANK_HOST_CODE } from "@/lib/agents/magellan/other-bank-host";
import { isOwnershipReject, OWNERSHIP_REJECT_PREFIX, OWNERSHIP_REJECT_REASONS } from "./rejected-sources";

describe("ownership rejects a completed read never overturns (#1105)", () => {
  it("names each ownership writer's own reason", () => {
    expect([...OWNERSHIP_REJECT_REASONS].sort()).toEqual([DOCUMENT_OWNER_REASON, OTHER_BANK_HOST_CODE, UNCONFIRMED_HOST_REASON].sort());
    expect(OWNERSHIP_REJECT_PREFIX).toBe(HAND_LINK_REJECT_REASON);
  });

  it("tells an ownership verdict from a fee-page verdict", () => {
    expect(isOwnershipReject("document_owner")).toBe(true);
    expect(isOwnershipReject("hand_link_repair: Natbank (#2022): Canadian pages replaced")).toBe(true);
    expect(isOwnershipReject("No fee lines and only 0 dollar amounts: not a fee schedule")).toBe(false);
    expect(isOwnershipReject("HTTP 404")).toBe(false);
    expect(isOwnershipReject(null)).toBe(false);
  });
});
