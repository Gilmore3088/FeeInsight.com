import { describe, expect, it } from "vitest";
import { colors } from "@/brand/tokens/tokens";
import { renderLeadEmailHtml, renderLeadEmailText } from "./lead-notification";

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

  it("leaves a sentence's final period outside the link", () => {
    const html = renderLeadEmailHtml({ subject: "S", lines: ["Compare any fee at https://feeinsight.com/fees."] });
    expect(html).toContain('<a href="https://feeinsight.com/fees"');
    expect(html).toContain("https://feeinsight.com/fees</a>.");
  });

  it("links a line to the URL on the line under it", () => {
    const html = renderLeadEmailHtml({ subject: "S", lines: ["Overdraft: $32.00 → $35.00 (up $3.00)\nhttps://feeinsight.com/institution/1"] });
    expect(html).toContain('<a href="https://feeinsight.com/institution/1"');
    expect(html).toContain(">Overdraft: $32.00 → $35.00 (up $3.00)</a>");
  });

  it("heads each section and keeps the plain text in the same order", () => {
    const content = { subject: "S", lines: [], sections: [{ heading: "Capital City Bank", lines: ["One"] }, { heading: "M&T Bank", lines: ["Two"] }] };
    const html = renderLeadEmailHtml(content);
    expect(html).toContain(">Capital City&nbsp;Bank</h2>");
    expect(html).toContain(">M&amp;T&nbsp;Bank</h2>");
    expect(renderLeadEmailText(content)).toMatch(/^Capital City Bank\nOne\n\nM&T Bank\nTwo\n/);
  });

  it("sets text in the brand's text colours, never the control-border grey", () => {
    const html = renderLeadEmailHtml({ subject: "S", lines: ["Body"], eyebrow: "Your quote" });
    expect(html.toLowerCase()).not.toContain(colors.light["control-border"].toLowerCase());
    expect(html).toContain("font-weight:800");
    expect(html).not.toContain("Geist Mono");
  });
});
