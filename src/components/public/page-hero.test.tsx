import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));

import { PageHero } from "./page-hero";

describe("PageHero", () => {
  it("draws the curved navy band with the title as the section's label", () => {
    const html = renderToStaticMarkup(<PageHero eyebrow="Fee check" title="How do your fees compare?" lede="One line." />);
    expect(html).toContain('class="fi-page-hero serif-var');
    expect(html).toContain('aria-labelledby="page-title"');
    expect(html).toMatch(/<h1 id="page-title"[^>]*>How do your fees compare\?<\/h1>/);
    expect(html).toContain("One line.");
  });

  it("splits into two columns only when the page gives an aside", () => {
    expect(renderToStaticMarkup(<PageHero title="T" />)).not.toContain("lg:grid-cols-");
    expect(renderToStaticMarkup(<PageHero title="T" aside={<div>card</div>} />)).toContain("lg:grid-cols-");
  });
});
