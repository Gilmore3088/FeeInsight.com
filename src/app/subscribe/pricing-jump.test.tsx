// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PricingJump } from "./pricing-jump";

afterEach(() => {
  document.body.innerHTML = "";
});

function setup(withInput: boolean) {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  render(
    <div>
      <PricingJump inputId="search" targetId="card" className="">
        See pricing
      </PricingJump>
      <h2 id="card">Card</h2>
      {withInput && <input id="search" aria-label="Find your institution" />}
    </div>,
  );
  return scroll;
}

describe("PricingJump", () => {
  it("lands on the institution search box and focuses it", () => {
    const scroll = setup(true);
    fireEvent.click(screen.getByText("See pricing"));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(screen.getByLabelText("Find your institution"));
  });

  it("scrolls to the card once an institution is picked", () => {
    const scroll = setup(false);
    fireEvent.click(screen.getByText("See pricing"));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("is a plain link to the card without JavaScript", () => {
    setup(true);
    expect(screen.getByText("See pricing").getAttribute("href")).toBe("#card");
  });
});
