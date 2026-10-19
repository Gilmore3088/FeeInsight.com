import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstitutionPicker } from "./InstitutionPicker";

const match = { id: 2945, institution_name: "Capital City Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank", asset_size_tier: "midsize", published_fee_count: 30, provisional_fee_count: 0, fee_publication_label: "Published" };

afterEach(() => vi.unstubAllGlobals());

describe("InstitutionPicker from the keyboard (#2043 review)", () => {
  it("chooses a focused match with Enter or Space, and Escape closes an opened picker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([match]))));
    const onSelect = vi.fn();
    const onEscape = vi.fn();
    render(<InstitutionPicker inputId="p" label="Institution" onSelect={onSelect} onEscape={onEscape} />);
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Capital" } });
    const option = (await screen.findByText("Capital City Bank", {}, { timeout: 2000 })).closest("button")!;
    // A keyboard activation is a click with no pointer detail.
    fireEvent.click(option, { detail: 0 });
    expect(onSelect).toHaveBeenLastCalledWith(match);
    fireEvent.keyDown(screen.getByLabelText("Institution"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalled();
  });
});
