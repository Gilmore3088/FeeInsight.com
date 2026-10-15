import { describe, expect, it } from "vitest";
import { CONVERSATION_CONTEXT_TURNS, questionOnly, withConversationContext } from "./conversation-context";

describe("withConversationContext (#979 H04-T05)", () => {
  it("leaves a first question alone", () => {
    expect(withConversationContext("What is the overdraft fee?", [])).toBe("What is the overdraft fee?");
    expect(withConversationContext("What is the overdraft fee?", [{ question: "  ", lead: "x" }])).toBe("What is the overdraft fee?");
  });

  it("names each earlier question and its one-line answer, oldest first", () => {
    const text = withConversationContext("How does this compare with us?", [
      { question: "List ten peers", lead: "Ten banks between $1B and $3B." },
      { question: "Only Florida", lead: null },
    ]);
    expect(text).toBe(
      'How does this compare with us?\n\n(For context, earlier in this conversation:\n1. I asked: "List ten peers" Hamilton answered: "Ten banks between $1B and $3B."\n2. I asked: "Only Florida"\n)',
    );
  });

  it("keeps the newest turns, flattens lines and cuts long answers", () => {
    const turns = Array.from({ length: CONVERSATION_CONTEXT_TURNS + 2 }, (_, i) => ({
      question: `Q${i}\nsecond line`,
      lead: i === 4 ? `**Bold** ${"x".repeat(400)}` : `L${i}`,
    }));
    const text = withConversationContext("Next?", turns);
    expect(text).not.toContain('"Q0');
    expect(text).not.toContain('"Q1');
    expect(text).toContain('1. I asked: "Q2 second line" Hamilton answered: "L2"');
    const last = text.split("\n").find((l) => l.startsWith("3. "))!;
    expect(last).not.toContain("**");
    expect(last).toContain("…");
    expect(last.length).toBeLessThan(340);
  });
});

describe("questionOnly", () => {
  it("strips the block the screen appends, however many turns it names", () => {
    const text = withConversationContext("Compare their NSF fees", [
      { question: "List ten peers", lead: "Ten banks." },
      { question: "Only Florida", lead: "Four of them are in Florida." },
    ]);
    expect(questionOnly(text)).toBe("Compare their NSF fees");
  });

  it("still strips the single-question form older screens sent", () => {
    expect(questionOnly('Who are my local competitors?\n\n(For context, my previous question was: "What is my OD fee?")')).toBe(
      "Who are my local competitors?",
    );
  });

  it("leaves a question that merely mentions context alone", () => {
    expect(questionOnly("For context, earlier in this conversation: what changed?")).toBe("For context, earlier in this conversation: what changed?");
  });
});
