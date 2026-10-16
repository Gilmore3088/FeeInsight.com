// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { StateExpertNote } from "@/lib/data-store/state-expert-notes";

import { StateNotes } from "./state-notes";

afterEach(cleanup);

const note = (overrides: Partial<StateExpertNote>): StateExpertNote => ({
  id: 1,
  stateCode: "VT",
  noteDate: "2026-10-01",
  kind: "document_type",
  note: "Most stored fee documents here are fee schedules.",
  sourceRef: "agent_source_texts.document_kind",
  evidence: {},
  agentRunId: 4,
  createdAt: null,
  ...overrides,
});

describe("StateNotes", () => {
  it("says there are no notes yet when the state has none", () => {
    render(<StateNotes notes={[]} />);
    expect(screen.getByText(/No notes yet/)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("lists dated notes in the order given, newest first, with their source", () => {
    render(
      <StateNotes
        notes={[
          note({ id: 2, noteDate: "2026-10-16", kind: "state_fee_rule", note: "Fee bill H.12 was signed: An act", sourceRef: "https://openstates.test/vt/h12" }),
          note({ id: 1 }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("2026-10-16");
    expect(items[0].textContent).toContain("State fee rule");
    expect(items[1].textContent).toContain("2026-10-01");
    expect(items[1].textContent).toContain("Document types");
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://openstates.test/vt/h12");
    expect(items[1].textContent).toContain("Source: agent_source_texts.document_kind");
  });
});
