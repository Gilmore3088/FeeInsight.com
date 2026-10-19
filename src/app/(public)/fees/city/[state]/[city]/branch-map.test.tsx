import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BranchMapLive } from "./branch-map";

vi.mock("next/dynamic", () => ({ default: (_loader: unknown, options: { ssr: boolean }) => {
  if (options.ssr !== false) throw new Error("The WebGL map must stay client-only");
  return function SyntheticMap({ onFail }: { onFail: () => void }) { return <button onClick={onFail}>Synthetic map failure</button>; };
} }));

describe("plain branch list fallback", () => {
  it("keeps institutions, safe names, addresses and unplaced branches after map failure", () => {
    render(<BranchMapLive label="Test City" branchesById={{ 1: 1, 2: 1 }} points={[
      { lat: 28, lon: -81, institution_id: 1, name: "Invented Bank", charter: "bank", address: "1 Test Road" },
      { lat: 28.1, lon: -81.1, institution_id: 2, name: "Invented CU", charter: "credit_union", address: "2 Test Road" },
    ]} unplaced={[{ institution_id: 3, name: "Unplaced Bank", charter: "bank", address: "3 Test Road" }]} />);
    fireEvent.click(screen.getByText("Synthetic map failure"));
    expect(screen.getByRole("list", { name: "Branch locations in Test City, by institution" })).toBeInTheDocument();
    for (const address of ["1 Test Road", "2 Test Road", "3 Test Road"]) expect(screen.getByText(address)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unplaced Bank's fees" })).toHaveAttribute("href", "/institution/3");
    expect(screen.getByText(/Branch records from the FDIC/)).toBeInTheDocument();
  });
});
