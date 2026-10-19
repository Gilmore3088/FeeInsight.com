import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ConsumerMarketLookup } from "./consumer-market-lookup";

describe("ConsumerMarketLookup", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("requires an explicit state or territory choice before exploring a market", () => {
    render(<ConsumerMarketLookup />);
    const select = screen.getByRole("combobox", { name: "Your state or territory" }) as HTMLSelectElement;
    expect(select).toHaveValue("");
    expect(select).toBeRequired();
    expect(select.validity.valueMissing).toBe(true);
    expect(select).toHaveAccessibleDescription(
      "Choose your state, then your city to see banks, credit unions and available fee schedules.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Explore local options" }));
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["CA", "/fees/city/ca"],
    ["DC", "/fees/city/dc"],
    ["PR", "/fees/city/pr"],
  ])("routes %s to its canonical city directory", (state, destination) => {
    render(<ConsumerMarketLookup />);
    fireEvent.change(screen.getByRole("combobox", { name: "Your state or territory" }), { target: { value: state } });
    fireEvent.click(screen.getByRole("button", { name: "Explore local options" }));
    expect(push).toHaveBeenCalledExactlyOnceWith(destination);
  });

  it("does not route an unsupported value injected into the selector", () => {
    render(<ConsumerMarketLookup />);
    const select = screen.getByRole("combobox", { name: "Your state or territory" });
    const option = document.createElement("option");
    option.value = "__proto__";
    select.appendChild(option);
    fireEvent.change(select, { target: { value: "__proto__" } });
    fireEvent.submit(screen.getByRole("form", { name: "Explore your local banking options" }));
    expect(push).not.toHaveBeenCalled();
  });
});
