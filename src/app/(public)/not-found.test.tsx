import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/public/not-found-content", () => ({ NotFoundContent: () => <p>Not here</p> }));

import { SITE_NAME } from "@/lib/constants";
import NotFound, { metadata } from "./not-found";

// 2026-10-15-layout-404-error-shell: a 404 thrown in a layout sends Next's error shell, so the
// browser draws this page and the server metadata never reaches the tab. The title is set both
// ways: metadata for the server HTML, a React <title> for the client render.
describe("public not-found page title", () => {
  it("sets the title in metadata for the server HTML", () => {
    expect(metadata.title).toBe("Page not found");
  });

  it("renders a <title> for the page the browser draws", () => {
    expect(renderToStaticMarkup(<NotFound />)).toContain(`<title>Page not found | ${SITE_NAME}</title>`);
  });
});
