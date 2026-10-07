import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({
  status: "ready" as string,
  messages: [] as Array<{ id: string; role: string; parts: Array<{ type: string; text?: string }> }>,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chat.messages,
    status: chat.status,
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    error: undefined,
    clearError: vi.fn(),
  }),
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: vi.fn() }));

import { AnalyzeWorkspace } from "./AnalyzeWorkspace";

const ANSWER = "## Hamilton's View\nYour overdraft fee is in line with community_mid peers.\n\n## Why It Matters\n- Overdraft draws the most complaints.";

function render() {
  return renderToStaticMarkup(<AnalyzeWorkspace userId={0} institutionId={null} />);
}

describe("AnalyzeWorkspace send button", () => {
  beforeEach(() => {
    chat.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "How is our overdraft fee?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: ANSWER }] },
    ];
  });

  it("spins while the answer streams", () => {
    chat.status = "streaming";
    const html = render();
    expect(html).toContain("animate-spin");
    expect(html).toContain("$300M to $1B peers");
  });

  it("stops spinning once the stream completes", () => {
    chat.status = "ready";
    expect(render()).not.toContain("animate-spin");
  });

  it("stops spinning when the stream fails", () => {
    chat.status = "error";
    expect(render()).not.toContain("animate-spin");
  });
});

describe("Ask Hamilton helpers", () => {
  it("says plainly when the preview has no AI key", async () => {
    const { askErrorMessage } = await import("./AnalyzeWorkspace");
    expect(askErrorMessage(new Error('{"error":"AI service not configured. Set ANTHROPIC_API_KEY."}'))).toMatch(/preview copy/);
    expect(askErrorMessage(new Error("boom"))).toMatch(/couldn't finish/);
  });

  it("names the lookups an answer used", async () => {
    const { lookupsUsed } = await import("./AnalyzeWorkspace");
    expect(lookupsUsed([{ type: "text" }, { type: "tool-getPeerFees" }, { type: "tool-search_complaints" }, { type: "tool-getPeerFees" }])).toEqual([
      "peer fees",
      "complaints",
    ]);
  });

  it("never shows lens tabs or the old recommendation hint", () => {
    chat.status = "ready";
    const html = render();
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toMatch(/recommendations, use Simulate/);
  });
});

describe("withEarlierQuestion", () => {
  it("gives a follow-up the question before it, and leaves a first question alone", async () => {
    const { withEarlierQuestion } = await import("./AnalyzeWorkspace");
    expect(withEarlierQuestion("how does this compare nationally?", "")).toBe("how does this compare nationally?");
    expect(withEarlierQuestion("how does this compare nationally?", "What is our overdraft fee against Florida peers?")).toContain(
      'my previous question was: "What is our overdraft fee against Florida peers?"',
    );
  });
});

describe("AnalyzeWorkspace while a written answer is drafted", () => {
  beforeEach(() => {
    chat.messages = [];
  });

  it("says what is happening and how long it has taken, never an empty page", () => {
    chat.status = "submitted";
    const html = render();
    expect(html).toContain("Hamilton is writing this answer from the fee data and filings.");
    expect(html).toContain("0s so far.");
  });

  it("keeps the progress note while the stream has started but no answer text is readable yet", () => {
    chat.status = "streaming";
    chat.messages = [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "## Hamilton's View\n" }] }];
    expect(render()).toContain("Hamilton is writing this answer");
  });
});
