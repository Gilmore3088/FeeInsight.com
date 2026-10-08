import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });
}

describe("header search", () => {
  // The header's Search button only dispatches an event; SearchModal is what opens. A screen that
  // renders the header without it has a dead search box (Pro's Regulatory Wire, James 2026-10-08).
  it("every screen that renders the site header also mounts SearchModal", () => {
    const offenders = files(SRC)
      .filter((file) => !file.endsWith("consumer-nav.tsx"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /<ConsumerNav\s*\/>/.test(source) && !/<SearchModal\s*\/>/.test(source);
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
