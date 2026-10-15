import { describe, expect, it } from "vitest";
import {
  CONVERSATION_CONTEXT_TURNS,
  MAX_REQUEST_MESSAGES,
  MAX_USER_MESSAGE_CHARS,
  MESSAGE_TOO_LONG_ERROR,
  TOO_MANY_MESSAGES_ERROR,
  messageBoundsError,
  questionOnly,
  withConversationContext,
} from "./conversation-context";

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

  it("keeps the reader's own words in the older form when the current block follows them (#1273)", () => {
    const typed = 'Compare these\n\n(For context, my previous question was: "y")';
    const text = withConversationContext(typed, [{ question: "List ten peers", lead: "Ten banks." }]);
    expect(questionOnly(text)).toBe(typed);
  });
});

describe("messageBoundsError (#1273)", () => {
  const user = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });

  it("allows the longest message the Analyze screen can build", () => {
    const longest = withConversationContext(
      "q".repeat(600),
      Array.from({ length: CONVERSATION_CONTEXT_TURNS }, () => ({ question: "p".repeat(900), lead: "l".repeat(900) })),
    );
    // The Ask box stops the question itself at 500; carried turns are cut by the builder.
    const fromAskBox = withConversationContext(
      "q".repeat(500),
      Array.from({ length: CONVERSATION_CONTEXT_TURNS }, () => ({ question: "p".repeat(900), lead: "l".repeat(900) })),
    );
    expect(fromAskBox.length).toBe(MAX_USER_MESSAGE_CHARS);
    // 500 (question) + 46 (block start) + 3 x 816 (turn lines) + 2 newlines + 2 (close).
    expect(MAX_USER_MESSAGE_CHARS).toBe(2998);
    expect(longest.length).toBe(MAX_USER_MESSAGE_CHARS + 100);
    expect(messageBoundsError([user(fromAskBox)])).toBeNull();
    expect(messageBoundsError([user(fromAskBox + "x")])).toBe(MESSAGE_TOO_LONG_ERROR);
  });

  it("counts only user messages' text toward the length cap", () => {
    expect(messageBoundsError([{ role: "assistant", parts: [{ type: "text", text: "x".repeat(MAX_USER_MESSAGE_CHARS * 2) }] }])).toBeNull();
    expect(messageBoundsError([null as unknown as { role: string }, { role: "user", parts: "nope" }])).toBeNull();
  });

  it("caps the number of messages", () => {
    const ok = Array.from({ length: MAX_REQUEST_MESSAGES }, () => user("hi"));
    expect(messageBoundsError(ok)).toBeNull();
    expect(messageBoundsError([...ok, user("one more")])).toBe(TOO_MANY_MESSAGES_ERROR);
  });
});
