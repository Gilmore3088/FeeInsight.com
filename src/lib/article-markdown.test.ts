import { describe, expect, it } from "vitest";
import { renderArticleMarkdown } from "./article-markdown";

const BASE = "https://feeinsight.com";

describe("renderArticleMarkdown", () => {
  it("wraps a list in one ul and keeps this site's links in the same tab", () => {
    const html = renderArticleMarkdown(
      "## Lowest\n\n- [Texas](https://feeinsight.com/research/state/TX): $30\n- [Ohio](https://example.com/oh): $25",
      BASE,
    );
    expect(html).toBe(
      '<h2>Lowest</h2><ul><li><a href="https://feeinsight.com/research/state/TX">Texas</a>: $30</li>' +
        '<li><a href="https://example.com/oh" target="_blank" rel="noopener noreferrer">Ohio</a>: $25</li></ul>',
    );
  });

  it("builds a table with a header row", () => {
    const html = renderArticleMarkdown("| State | Median |\n|---|---|\n| Texas | $30 |", BASE);
    expect(html).toBe("<table><thead><tr><th>State</th><th>Median</th></tr></thead><tbody><tr><td>Texas</td><td>$30</td></tr></tbody></table>");
  });

  it("escapes raw HTML and leaves non-http links as text", () => {
    const html = renderArticleMarkdown('<script>x</script> **bold** [x](javascript:alert(1))', BASE);
    expect(html).toBe("<p>&lt;script&gt;x&lt;/script&gt; <strong>bold</strong> [x](javascript:alert(1))</p>");
  });
});
