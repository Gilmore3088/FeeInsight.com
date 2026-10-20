import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist-sans-variable", className: "geist-sans" } }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "geist-mono-variable", className: "geist-mono" } }));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@/components/public/marketing-touch-recorder", () => ({ MarketingTouchRecorder: () => null }));

import RootLayout from "./layout";

const root = join(__dirname, "..", "..");

describe("site fonts", () => {
  // 2026-10-15-geist-font-variable-scope: with the next/font variable classes on <body>, the brand
  // tokens declared on :root (--fi-font-sans) could not read --font-geist-sans, and every heading,
  // button and tag fell back to a system font.
  it("puts the next/font variable classes on <html>, where tokens on :root can read them", () => {
    const html = renderToStaticMarkup(RootLayout({ children: <p>page</p> }));
    const htmlClass = html.match(/<html[^>]*\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(htmlClass).toEqual(expect.arrayContaining(["geist-sans-variable", "geist-mono-variable"]));
  });

  // 2026-10-10-next-font-build-reproduction: next/font/google broke the Turbopack build on Google's
  // extensionless font URLs and needs the network at build time; the fonts are self-hosted instead.
  it("loads no font through next/font/google", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(c|m)?[jt]sx?$/.test(file) && !/\.test\.[jt]sx?$/.test(file));
    const offenders = files.filter((file) => /["']next\/font\/google["']/.test(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
