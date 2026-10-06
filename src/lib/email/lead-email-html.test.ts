import { describe, expect, it } from "vitest";
import { renderLeadEmailHtml } from "./lead-notification";

describe("renderLeadEmailHtml", () => {
  it("renders Name: value lines as a details table", () => {
    const html = renderLeadEmailHtml({ subject: "S", lines: ["Institution: Example CU", "Email: a@b.co"] });
    expect(html).toContain("<table role=\"presentation\"");
    expect(html).toContain(">Institution</td>");
    expect(html).toContain(">Example CU</td>");
  });

  it("names a trailing link after its last sentence instead of printing the URL", () => {
    const url = "https://feeinsight.com/email-preferences?action=confirm&token=x";
    const html = renderLeadEmailHtml({ subject: "S", lines: [`Want updates? Confirm your address: ${url}`] });
    expect(html).toContain("Want updates? <a href=\"https://feeinsight.com/email-preferences?action=confirm&amp;token=x\"");
    expect(html).toContain(">Confirm your address</a>");
  });

  it("links bare URLs and still escapes text", () => {
    const html = renderLeadEmailHtml({ subject: "<b>", lines: ["See https://feeinsight.com/x and <script>"] });
    expect(html).toContain("<a href=\"https://feeinsight.com/x\"");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;");
  });
});
