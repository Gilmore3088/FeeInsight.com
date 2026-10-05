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
