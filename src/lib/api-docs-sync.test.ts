import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/openapi.json/route";
import { MCP_TOOLS } from "@/lib/api-v1-mcp";
import { PEER_GROUP_PARAMS } from "@/lib/peer-set-dimensions";

/**
 * The API's docs rule: an API change that leaves the docs behind fails CI. Every v1 data route,
 * every query parameter a route reads, and every connector tool must appear in the OpenAPI spec
 * (/api/v1/openapi.json) and on /api-docs. scripts/ci-guards.sh api-docs-kill adds the other half:
 * a PR that changes the API must bump API_VERSION in src/lib/api-v1.ts.
 */

const ROOT = process.cwd();
const V1_DIR = join(ROOT, "src/app/api/v1");
const DOCS_PAGE = readFileSync(join(ROOT, "src/app/(public)/api-docs/page.tsx"), "utf8");
const NOT_DATA_ROUTES = new Set(["mcp", "openapi.json"]);
const AUTH_PARAMS = new Set(["api_key"]);

// Shared parsers in src/lib/api-v1.ts and the peer-group parser read these query parameters.
const HELPER_PARAMS: Record<string, string[]> = {
  stateParam: ["state"],
  charterParam: ["charter"],
  districtParam: ["district"],
  formatParam: ["format"],
  assetTierParam: ["asset_tier"],
  peerSetRequestParams: PEER_GROUP_PARAMS.map((p) => p.name),
};
const NAMED_PARAM_CALL = /\b(?:searchParams\.(?:get|has|getAll)|(?:intParam|dateTimeParam|idListParam)\([^,)]*,)\s*\(?\s*"([a-z_]+)"/g;
const HELPER_CALL = /\b([A-Za-z]+)\((?:request\.nextUrl\.)?searchParams\)/g;

const dataRoutes = readdirSync(V1_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !NOT_DATA_ROUTES.has(entry.name))
  .map((entry) => entry.name)
  .sort();

function routeParams(route: string): Set<string> {
  const source = readFileSync(join(V1_DIR, route, "route.ts"), "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(NAMED_PARAM_CALL)) names.add(match[1]);
  for (const match of source.matchAll(HELPER_CALL)) {
    const helper = HELPER_PARAMS[match[1]];
    if (!helper) throw new Error(`${route}/route.ts reads searchParams through ${match[1]}; add it to HELPER_PARAMS`);
    for (const name of helper) names.add(name);
  }
  for (const name of AUTH_PARAMS) names.delete(name);
  return names;
}

type SpecParam = { name?: string; $ref?: string };
async function specParams(): Promise<Map<string, Set<string>>> {
  const spec = await (await GET()).json();
  const shared = spec.components.parameters as Record<string, { name: string }>;
  const byPath = new Map<string, Set<string>>();
  for (const [path, item] of Object.entries(spec.paths as Record<string, { get: { parameters?: SpecParam[] } }>)) {
    const names = (item.get.parameters ?? []).map((p) => p.name ?? shared[p.$ref!.split("/").pop()!].name);
    byPath.set(path, new Set(names));
  }
  return byPath;
}

/** The parameter rows of every <Endpoint> card on /api-docs whose path is this route. */
function docsPageParams(route: string): Set<string> {
  const names = new Set<string>();
  for (const card of DOCS_PAGE.split("<Endpoint").slice(1)) {
    const path = card.match(/path="([^"]+)"/)?.[1] ?? "";
    if (path.split("?")[0] !== `/${route}`) continue;
    const params = card.slice(card.indexOf("params={["), card.indexOf("curlExample="));
    for (const match of params.matchAll(/name: "([a-z_]+)"/g)) names.add(match[1]);
    if (params.includes("...PEER_GROUP_PARAMS")) for (const p of PEER_GROUP_PARAMS) names.add(p.name);
  }
  return names;
}

/** The query parameters a tool sends for one argument, trying a sample value of each type the tools accept. */
function sentParams(tool: (typeof MCP_TOOLS)[number], property: string): string[] | null {
  const required = Object.fromEntries(tool.required.map((name) => [name, "1"]));
  for (const value of ["1", true, 1, "bank", "TX"]) {
    try {
      return Object.keys(tool.toParams({ ...required, [property]: value }));
    } catch {
      // Not a value this argument takes; try the next type.
    }
  }
  return null;
}

describe("API docs stay in step with the API", () => {
  it.each(dataRoutes)("documents every query parameter /%s reads, in the spec and on /api-docs", async (route) => {
    const read = [...routeParams(route)].sort();
    const spec = (await specParams()).get(`/${route}`);
    expect(spec, `/${route} is missing from the OpenAPI spec`).toBeDefined();
    expect(read.filter((name) => !spec!.has(name)), `parameters /${route} reads but the spec leaves out`).toEqual([]);
    expect(docsPageParams(route).size, `/${route} has no card on /api-docs`).toBeGreaterThan(0);
    const onPage = docsPageParams(route);
    expect(read.filter((name) => !onPage.has(name)), `parameters /${route} reads but /api-docs leaves out`).toEqual([]);
  });

  it("documents no parameter a route does not read", async () => {
    const stale: string[] = [];
    for (const [path, names] of await specParams()) {
      const read = routeParams(path.slice(1));
      for (const name of names) if (!read.has(name)) stale.push(`spec ${path}: ${name}`);
      for (const name of docsPageParams(path.slice(1))) if (!read.has(name)) stale.push(`/api-docs ${path}: ${name}`);
    }
    expect(stale).toEqual([]);
  });

  it("lists every connector tool on /api-docs, and each tool only sends parameters its endpoint documents", async () => {
    const spec = await specParams();
    for (const tool of MCP_TOOLS) {
      expect(DOCS_PAGE.includes(tool.name) || DOCS_PAGE.includes("MCP_TOOLS"), `${tool.name} is not on /api-docs`).toBe(true);
      const documented = spec.get(tool.path);
      expect(documented, `${tool.name} calls ${tool.path}, which the spec leaves out`).toBeDefined();
      for (const property of tool.inputProperties) {
        const sent = sentParams(tool, property);
        expect(sent, `${tool.name} rejects every sample value for ${property}`).not.toBeNull();
        for (const name of sent!) expect(documented!.has(name), `${tool.name} sends ${name} to ${tool.path}`).toBe(true);
      }
    }
  });
});
