import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const SOURCES = [...files(join(SRC, "app")), ...files(join(SRC, "components")), ...files(join(SRC, "lib"))].map(
  (file) => ({ file: relative(SRC, file), text: readFileSync(file, "utf8") }),
);

/** Every literal admin link that carries a fragment, e.g. "/admin/controls#atlas-safety". */
function adminAnchorLinks(): Array<{ file: string; path: string; id: string }> {
  return SOURCES.flatMap(({ file, text }) =>
    [...text.matchAll(/["'`](\/admin(?:\/[\w\-./[\]]*)?)#([\w-]+)["'`]/g)].map((match) => ({
      file,
      path: match[1],
      id: match[2],
    })),
  );
}

describe("admin anchor links", () => {
  it("never point at a fragment on Today (/admin), which has no section anchors", () => {
    const offenders = adminAnchorLinks()
      .filter((link) => link.path === "/admin")
      .map((link) => `${link.file}: /admin#${link.id}`);
    expect(offenders).toEqual([]);
  });

  it("only point at fragments some admin component renders as an id", () => {
    const ids = new Set(
      SOURCES.flatMap(({ text }) => [...text.matchAll(/\bid="([\w-]+)"/g)].map((match) => match[1])),
    );
    const offenders = adminAnchorLinks()
      .filter((link) => !ids.has(link.id))
      .map((link) => `${link.file}: ${link.path}#${link.id}`);
    expect(offenders).toEqual([]);
  });
});
