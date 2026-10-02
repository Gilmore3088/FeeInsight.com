// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ askCrew: vi.fn(), confirmCrewCommand: vi.fn() }));
vi.mock("./crew-actions", () => ({ askCrew: mocks.askCrew, confirmCrewCommand: mocks.confirmCrewCommand }));

import { CrewCommandBar } from "./crew-command-bar";

afterEach(() => {
  cleanup();
  mocks.askCrew.mockReset();
  mocks.confirmCrewCommand.mockReset();
});

describe("CrewCommandBar", () => {
  it("shows the reply and only acts after Confirm", async () => {
    mocks.askCrew.mockResolvedValue({
      speaker: "Atlas",
      lines: ["Here's what I'll do. Confirm to go ahead."],
      confirm: { summary: "Atlas will run the full pipeline for Georgia.", commandText: "Atlas, run Georgia" },
    });
    mocks.confirmCrewCommand.mockResolvedValue({ speaker: "Atlas", lines: ["Started Georgia (run #501)."] });

    render(<CrewCommandBar />);
    fireEvent.change(screen.getByLabelText("Command for the crew"), { target: { value: "Atlas, run Georgia" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(screen.getByText("Atlas will run the full pipeline for Georgia.")).toBeTruthy());
    expect(mocks.confirmCrewCommand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(screen.getByText("Started Georgia (run #501).")).toBeTruthy());
    expect(mocks.confirmCrewCommand).toHaveBeenCalledWith("Atlas, run Georgia");
  });

  it("sends quick commands", async () => {
    mocks.askCrew.mockResolvedValue({ speaker: "Atlas", lines: ["Nothing is stuck."] });
    render(<CrewCommandBar />);
    fireEvent.click(screen.getByText("what's stuck?"));
    await waitFor(() => expect(screen.getByText("Nothing is stuck.")).toBeTruthy());
    expect(mocks.askCrew).toHaveBeenCalledWith("what's stuck?");
  });
});
