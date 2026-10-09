// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts as Record<string, string>;
const workflow = readFileSync(resolve(root, ".github/workflows/test.yml"), "utf8");
describe("validation entry points", () => {
  it("runs the complete suite rather than a manually selected subset", () => {
    expect(scripts.test).toBe("vitest run");
    expect(scripts.validate).toBe("npm run guard:legacy && npm run typecheck && npm run lint && npm test");
    expect(scripts["test:agentic"]).toBeTruthy();
    expect(workflow).toContain("run: npm run validate");
    expect(workflow).not.toContain("run: npm run test:agentic");
  });
  it("makes the build and disposable integration database explicit", () => {
    expect(scripts["validate:build"]).toBe("npm run validate && npm run build");
    expect(workflow).toContain("run: npm run build");
    expect(workflow).toContain("E2E_DATABASE_URL: postgres://postgres:postgres@localhost:5432/e2e");
    expect(workflow).toContain("npm run test:pipeline");
    expect(workflow).not.toContain("secrets.");
  });
  it("pins actions and does not give test jobs repository write access", () => {
    const actionRefs = [...workflow.matchAll(/uses:\s*[^\s@]+@([^\s]+)/g)].map((match) => match[1]);
    expect(actionRefs).toHaveLength(2);
    for (const ref of actionRefs) expect(ref).toMatch(/^[0-9a-f]{40}$/);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("contents: write");
  });
});
