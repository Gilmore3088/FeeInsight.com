import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src/app");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });
}

/** JSX <main …> openings, ignoring comments. */
function mainTags(source: string): number {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return (withoutComments.match(/<main[\s>]/g) ?? []).length;
}

describe("landmarks", () => {
  it("public pages do not nest a second <main> inside the public layout's", () => {
    const offenders = files(join(APP, "(public)"))
      .filter((file) => !file.endsWith("(public)/layout.tsx"))
      .filter((file) => mainTags(readFileSync(file, "utf8")) > 0)
      .map((file) => relative(APP, file));
    expect(offenders).toEqual([]);
  });

  it("Hamilton pages do not nest a second <main> inside HamiltonShell's", () => {
    const offenders = files(join(APP, "pro/(hamilton)"))
      .filter((file) => mainTags(readFileSync(file, "utf8")) > 0)
      .map((file) => relative(APP, file));
    expect(offenders).toEqual([]);
  });

  it.each([
    "(public)/layout.tsx",
    "page.tsx",
    "for-institutions/page.tsx",
    "submit-fees/page.tsx",
    "subscribe/page.tsx",
    "account/page.tsx",
    "not-found.tsx",
    "error.tsx",
  ])("%s has exactly one <main id=\"main-content\">", (file) => {
    const source = readFileSync(join(APP, file), "utf8");
    expect(mainTags(source)).toBe(1);
    expect(source).toContain('<main id="main-content"');
  });

  it("UtilityShell renders the one <main> for the utility pages that use it", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/utility/utility-shell.tsx"), "utf8");
    expect(mainTags(shell)).toBe(1);
    expect(shell).toContain('<main id="main-content"');
    expect(shell).toContain("<SkipLink />");
    const pages = [
      "(auth)/login/page.tsx",
      "(auth)/register/page.tsx",
      "(auth)/auth-card.tsx",
      "account/welcome/page.tsx",
      "account/billing-issue/page.tsx",
      "confirm-email/page.tsx",
      "email-preferences/page.tsx",
      "workspace-invite/page.tsx",
    ];
    for (const file of pages) {
      const source = readFileSync(join(APP, file), "utf8");
      expect(source, file).toContain("<UtilityShell");
      expect(mainTags(source), file).toBe(0);
    }
    expect(mainTags(readFileSync(join(APP, "(auth)/layout.tsx"), "utf8"))).toBe(0);
  });

  it("the shared header carries the skip link", () => {
    const nav = readFileSync(join(process.cwd(), "src/components/consumer-nav.tsx"), "utf8");
    expect(nav).toContain("<SkipLink />");
  });
});
