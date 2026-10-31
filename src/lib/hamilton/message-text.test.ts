import { describe, expect, it } from "vitest";
import { joinTextParts, messageText } from "./message-text";

describe("joinTextParts", () => {
  it("puts one space between sentences from separate text parts (the Oct 30 \"$35.00.Across\" join)", () => {
    expect(joinTextParts(["Capital City Bank's overdraft fee is $35.00.", "Across 7 peers, the median is $34."]))
      .toBe("Capital City Bank's overdraft fee is $35.00. Across 7 peers, the median is $34.");
  });

  it("never doubles a space a part already has", () => {
    expect(joinTextParts(["The fee is $35. ", "Across 7 peers."])).toBe("The fee is $35. Across 7 peers.");
    expect(joinTextParts(["The fee is $35.", " Across 7 peers."])).toBe("The fee is $35. Across 7 peers.");
    expect(joinTextParts(["The fee is $35.\n", "Across 7 peers."])).toBe("The fee is $35.\nAcross 7 peers.");
  });

  it("starts a Markdown block on its own line", () => {
    expect(joinTextParts(["The fee is $35.", "## Peers"])).toBe("The fee is $35.\n\n## Peers");
    expect(joinTextParts(["The fee is $35.", "- Peer median $34"])).toBe("The fee is $35.\n\n- Peer median $34");
    expect(joinTextParts(["The fee is $35.", "| Fee | Amount |"])).toBe("The fee is $35.\n\n| Fee | Amount |");
  });

  it("puts a code fence on its own line", () => {
    expect(joinTextParts(["The figures:", "```\nOD 35\n```"])).toBe("The figures:\n```\nOD 35\n```");
  });

  it("keeps table rows split across parts in one table", () => {
    expect(joinTextParts(["| Fee | Amount |\n|---|---|", "| Overdraft | $35 |"]))
      .toBe("| Fee | Amount |\n|---|---|\n| Overdraft | $35 |");
  });

  it("starts a new paragraph after a list item rather than gluing onto it", () => {
    expect(joinTextParts(["- Peer median $34", "Across 7 peers, the fee is high."]))
      .toBe("- Peer median $34\n\nAcross 7 peers, the fee is high.");
    expect(joinTextParts(["## Peers", "Across 7 peers."])).toBe("## Peers\n\nAcross 7 peers.");
    expect(joinTextParts(["- Peer median $34", "- Local median $35"])).toBe("- Peer median $34\n\n- Local median $35");
  });

  it("adds no space before closing punctuation", () => {
    for (const p of [",", ".", ";", ":", ")", "!", "?"]) {
      expect(joinTextParts(["The fee is $35", `${p} rest`])).toBe(`The fee is $35${p} rest`);
    }
  });

  it("skips empty parts and keeps a single part as it is", () => {
    expect(joinTextParts(["", "The fee is $35.", ""])).toBe("The fee is $35.");
    expect(joinTextParts([])).toBe("");
  });
});

describe("messageText", () => {
  it("reads only the text parts of a message", () => {
    const message = { parts: [
      { type: "text", text: "The fee is $35.00." },
      { type: "tool-getPeers", output: {} },
      { type: "text", text: "Across 7 peers, the median is $34." },
    ] };
    expect(messageText(message)).toBe("The fee is $35.00. Across 7 peers, the median is $34.");
    expect(messageText({})).toBe("");
  });
});
