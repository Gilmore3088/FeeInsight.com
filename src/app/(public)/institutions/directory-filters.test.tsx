import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
// A navigation that never finishes, like a directory render that takes seconds.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DirectoryFilters } from "./directory-filters";

beforeEach(() => {
  push.mockReset();
  push.mockReturnValue(new Promise(() => {}));
});

describe("DirectoryFilters (#1953)", () => {
  it("keeps the first choice on screen and in the next filter's link while the page loads", () => {
    render(<DirectoryFilters query="" stateCode="" charterType="" />);
    const state = screen.getByLabelText("Filter by state") as HTMLSelectElement;
    const charter = screen.getByLabelText("Filter by institution type") as HTMLSelectElement;
    fireEvent.change(state, { target: { value: "FL" } });
    expect(push).toHaveBeenLastCalledWith("/institutions?state=FL");
    expect(state.value).toBe("FL");
    expect(charter.disabled).toBe(false);
    fireEvent.change(charter, { target: { value: "credit_union" } });
    expect(push).toHaveBeenLastCalledWith("/institutions?state=FL&charter=credit_union");
    expect(state.value).toBe("FL");
    expect(charter.value).toBe("credit_union");
  });
});
