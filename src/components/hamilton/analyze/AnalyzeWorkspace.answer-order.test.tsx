// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// H05-T04 (#980): a written answer opens on its figures; a figure that could not be traced is
// flagged before the commentary it qualifies; the identity record follows the answer. Made-up text.

const chat = vi.hoisted(() => ({
  opts: null as null | { onFinish?: (e: { message: unknown; isError?: boolean; isAbort?: boolean }) => Promise<void> },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: (opts: typeof chat.opts) => ((chat.opts = opts), {
    messages: [], status: "ready", sendMessage: vi.fn(), setMessages: vi.fn(), error: undefined, clearError: vi.fn(), stop: vi.fn(),
  }),
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: vi.fn(async () => ({ id: "row" })) }));

import { AnalyzeWorkspace } from "./AnalyzeWorkspace";

afterEach(cleanup);

const ANSWER = [
  "## Hamilton's View",
  "Your overdraft fee of $35 sits above the $29 peer median.",
  "",
  "A second paragraph of commentary.",
  "",
  "## Evidence",
  "- Overdraft: $35 — against a $29 peer median",
].join("\n");

const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("AnalyzeWorkspace written answer order", () => {
  it("shows figures, then the untraced-figure warning, then the commentary, then the identity record", async () => {
    render(<AnalyzeWorkspace userId={1} institutionId="8109" />);
    await act(async () => {
      await chat.opts?.onFinish?.({
        message: {
          id: "m1", role: "assistant",
          metadata: { savedAnalysisId: "row", hamiltonIdentity: { version: 1, researchInstitutionId: 8109, accountInstitutionId: null, accountStatus: "unlinked", researchInstitutionName: "Example Bank" } },
          parts: [{ type: "text", text: ANSWER }],
        },
        isError: false,
        isAbort: false,
      });
    });
    const figures = screen.getByText("The figures behind this answer");
    const warning = screen.getByText("Check these figures:");
    const lead = screen.getByText(/sits above the \$29 peer median/);
    const identity = screen.getByText("Institution and peer group behind this answer");
    expect(before(figures, warning)).toBe(true);
    expect(before(warning, lead)).toBe(true);
    expect(before(lead, identity)).toBe(true);
    // One intro: the lead is written once.
    expect(screen.getAllByText(/sits above the \$29 peer median/)).toHaveLength(1);
  });
});
