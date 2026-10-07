import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { API_ROUTE_POLICIES } from "./policies";

const API_ROOT = join(process.cwd(), "src/app/api");

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listRouteFiles(fullPath);
    return /\/route\.tsx?$/.test(fullPath) ? [fullPath] : [];
  });
}

function normalizePath(path: string): string {
  return path.slice(process.cwd().length + 1);
}

function exportedMethods(path: string): string[] {
  const text = readFileSync(path, "utf8");
  return Array.from(text.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*=\s*withApiRoutePolicy\b/g))
    .map((match) => String(match[1]))
    .sort();
}

describe("API route policy coverage", () => {
  it("classifies every API route file", () => {
    const actualFiles = listRouteFiles(API_ROOT).map(normalizePath).sort();
    const policyFiles = API_ROUTE_POLICIES.map((policy) => policy.file).sort();

    expect(policyFiles).toEqual(actualFiles);
  });

  it("keeps allowed methods aligned with route exports", () => {
    for (const policy of API_ROUTE_POLICIES) {
      const absolutePath = join(process.cwd(), policy.file);
      expect(existsSync(absolutePath), policy.file).toBe(true);
      expect([...policy.allowedMethods].sort(), policy.routeId).toEqual(exportedMethods(absolutePath));
    }
  });

  it("does not allow public unauthenticated provider AI", () => {
    const publicProviderRoutes = API_ROUTE_POLICIES.filter(
      (policy) => policy.costPolicy === "provider_ai" && String(policy.authRequirement) === "public",
    );

    expect(publicProviderRoutes).toEqual([]);
  });

  it("marks spend-capable routes fail closed", () => {
    const spendRoutes = API_ROUTE_POLICIES.filter(
      (policy) => policy.costPolicy !== "none" && policy.costPolicy !== "webhook",
    );

    expect(spendRoutes.length).toBeGreaterThan(0);
    expect(spendRoutes.every((policy) => policy.failBehavior === "fail_closed")).toBe(true);
  });
});
