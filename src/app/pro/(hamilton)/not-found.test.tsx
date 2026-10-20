// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/consumer-nav", () => ({
  ConsumerNav: () => {
    throw new Error("consumer chrome rendered inside Pro");
  },
}));
import HamiltonNotFound, { metadata } from "./not-found";

afterEach(cleanup);

it("answers a missing Pro page inside Hamilton, with ways back into the workspace", () => {
  render(<HamiltonNotFound />);
  expect(screen.getByRole("heading", { level: 1, name: "We couldn't find that page" })).toBeTruthy();
  const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
  expect(hrefs).toEqual(["/pro/hamilton", "/pro/saved"]);
  // Consumer destinations belong to the public 404, not the paid workspace.
  expect(hrefs).not.toContain("/institutions");
  expect(hrefs).not.toContain("/fees");
});

it("names the tab as a missing page", () => {
  expect(metadata.title).toBe("Page not found");
});
