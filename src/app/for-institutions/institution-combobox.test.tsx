import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstitutionCombobox } from "./institution-combobox";

const ROWS = [
  { id: 117, institution_name: "Banner Bank", city: "Walla Walla", state_code: "WA" },
  { id: 118, institution_name: "Banner Savings", city: "Boise", state_code: "ID" },
];

describe("InstitutionCombobox", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function typeAndWait(input: HTMLElement, text: string) {
    fireEvent.change(input, { target: { value: text } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }

  it("suggests institutions and reports the one picked, with its state", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(ROWS))));
    vi.stubGlobal("fetch", fetchMock);
    const onPick = vi.fn();
    render(<InstitutionCombobox id="i" name="institution" defaultValue="" readOnly={false} className="" onPick={onPick} />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Banner");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/institutions?q=Banner");
    fireEvent.mouseDown(screen.getByText("Banner Bank"));
    expect(onPick).toHaveBeenLastCalledWith({ id: 117, name: "Banner Bank", stateCode: "WA" });
    expect((input as HTMLInputElement).value).toBe("Banner Bank");
  });

  it("clears the pick when the name is edited afterwards", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(ROWS)))));
    const onPick = vi.fn();
    render(<InstitutionCombobox id="i" name="institution" defaultValue="" readOnly={false} className="" onPick={onPick} />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Banner");
    fireEvent.mouseDown(screen.getByText("Banner Bank"));
    fireEvent.change(input, { target: { value: "Banner Bank of Oregon" } });
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("does not search when the field is locked to a known institution", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<InstitutionCombobox id="i" name="institution" defaultValue="Banner Bank" readOnly className="" onPick={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
