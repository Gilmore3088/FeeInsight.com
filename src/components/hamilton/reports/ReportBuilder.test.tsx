import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCommitteePacket } from "@/lib/hamilton/committee-packet";
import { fullPacketInput } from "@/lib/hamilton/committee-packet.fixture";
import { builderData, presetLayout, type BuilderLayout } from "@/lib/hamilton/report-builder";
import { ReportBuilder } from "./ReportBuilder";

const data = builderData(buildCommitteePacket(fullPacketInput()));

function Harness({ initial = presetLayout("board") }: { initial?: BuilderLayout }) {
  const [layout, setLayout] = useState(initial);
  return <ReportBuilder data={data} layout={layout} onLayoutChange={setLayout} peerSetId={null} savedPeerSets={[]} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Reports builder", () => {
  it("adds a ticked section to the preview and the count", () => {
    render(<Harness />);
    expect(screen.getByText("4 of 7 on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Peer fee changes/ }));
    expect(screen.getByText("5 of 7 on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview every page" }));
    expect(screen.getByRole("button", { name: "Show one page" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/^5\. Peer fee changes$/)).toBeInTheDocument();
  });

  it("moves a section up and renumbers the preview", () => {
    render(<Harness />);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("checkbox")[0]).toHaveAccessibleName(/Fee position summary/);
    expect(screen.getByRole("button", { name: "Move Fee position summary up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Fees above the range up" }));
    expect(within(list).getAllByRole("checkbox")[0]).toHaveAccessibleName(/Fees above the range/);
    expect(screen.getByText(/^1\. Fees above the range$/)).toBeInTheDocument();
  });

  it("exports through the PDF route with the layout on screen", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(["%PDF"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Committee" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(await screen.findByRole("status")).toHaveTextContent("PDF ready");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ type: "report_builder", institutionId: data.institutionId, peerSetId: null, layout: "board:committee:4:LETTER:summary,above,trend,sources,-findings,-fees,-changes" });
    vi.unstubAllGlobals();
  });

  it("copies a share link that reopens these settings", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/pro/reports?instId=${data.institutionId}&build=board%3Aboard%3A4%3ALETTER`));
  });
});
