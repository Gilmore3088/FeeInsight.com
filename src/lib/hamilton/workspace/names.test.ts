import { describe, expect, it } from "vitest";
import { directionalTitle, feeArticle, inSentence, proseFeeName } from "./names";
import { DISPLAY_NAMES, getDisplayName } from "@/lib/fee-taxonomy";
import { plainFeeName } from "@/lib/hamilton/briefing-observations";

describe("proseFeeName", () => {
  it("keeps a wire's direction, which the bracket used to carry", () => {
    expect(proseFeeName("wire_domestic_outgoing")).toBe("outgoing domestic wire");
    expect(proseFeeName("wire_domestic_incoming")).toBe("incoming domestic wire");
    expect(proseFeeName("wire_intl_outgoing")).toBe("outgoing international wire");
  });
  it("still drops an abbreviation in brackets", () => {
    expect(proseFeeName("overdraft")).toBe("overdraft");
    expect(proseFeeName("atm_non_network")).toBe("non-network ATM");
  });
});

describe("directionalTitle", () => {
  it("titles a wire with its direction and leaves other fees to the usual name", () => {
    expect(directionalTitle("wire_domestic_outgoing")).toBe("Outgoing Domestic Wire");
    expect(directionalTitle("overdraft")).toBeNull();
  });
});

describe("inSentence (#1896)", () => {
  it("gives every fee the same in-sentence name as its heading, from the workspace's display name", () => {
    for (const category of Object.keys(DISPLAY_NAMES)) {
      const workspaceName = directionalTitle(category) ?? plainFeeName(getDisplayName(category));
      expect(inSentence(workspaceName)).toBe(proseFeeName(category));
    }
  });
  it("keeps an acronym's capitals mid-sentence", () => {
    expect(inSentence("NSF / Returned Item")).toBe("NSF / returned item");
    expect(inSentence("Daily OD & NSF Fee Cap")).toBe("daily OD & NSF fee cap");
  });
});

describe("feeArticle", () => {
  it("picks the article by sound", () => {
    expect(feeArticle("overdraft")).toBe("an");
    expect(feeArticle("NSF / returned item")).toBe("an");
    expect(feeArticle("stop payment")).toBe("a");
    expect(feeArticle("ACH origination")).toBe("an");
  });
});
