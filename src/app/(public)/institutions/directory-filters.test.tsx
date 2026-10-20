import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
// A navigation that never finishes, like a directory render that takes seconds.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { StatePicker } from "./directory-filters";

beforeEach(() => {
  push.mockReset();
  push.mockReturnValue(new Promise(() => {}));
});

describe("StatePicker (#1953)", () => {
  it("keeps the picked state on screen and usable while the page loads", () => {
    render(<StatePicker query="" stateCode="" charter="credit_union" />);
    const state = screen.getByLabelText("State") as HTMLSelectElement;
    fireEvent.change(state, { target: { value: "FL" } });
    expect(push).toHaveBeenLastCalledWith("/institutions?state=FL&charter=credit_union");
    expect(state.value).toBe("FL");
    expect(state.disabled).toBe(false);
  });
});
