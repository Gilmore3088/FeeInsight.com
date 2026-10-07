import { NextRequest } from "next/server";
import { validateApiKey } from "@/lib/api-auth";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";

/**
 * A Model Context Protocol server over the /api/v1 endpoints, so an AI
 * assistant (Claude, ChatGPT) can query Bank Fee Index in conversation.
 *
 * Stateless Streamable HTTP: each POST carries one JSON-RPC message (or a
 * batch) and gets a plain JSON reply; there is no session and no SSE stream.
 * Every tool call goes through the matching v1 route handler with the
 * caller's own key, so access, plan limits, usage logging and attribution
 * are exactly the API's. No model is called here.
 */

export type V1Handler = (request: NextRequest) => Promise<Response> | Response;

export interface McpV1Handlers {
  fees: V1Handler;
  index: V1Handler;
  institutions: V1Handler;
  revenue: V1Handler;
  feeChanges: V1Handler;
  branches: V1Handler;
  market: V1Handler;
}

const ENDPOINT_PATHS: Record<keyof McpV1Handlers, string> = {
  fees: "/api/v1/fees",
  index: "/api/v1/index",
  institutions: "/api/v1/institutions",
  revenue: "/api/v1/revenue",
  feeChanges: "/api/v1/fee-changes",
  branches: "/api/v1/branches",
  market: "/api/v1/market",
};

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INSTRUCTIONS =
  `${PRODUCT_NAME} (${SITE_URL}) publishes bank and credit union fees read from each institution's own fee schedule, ` +
  "plus FDIC/NCUA call report figures and CFPB complaint counts. Amounts are US dollars. " +
  "Start with get_fee_index for typical fees in a state or nationally, find_institutions to look a bank up by name, state, city or size, " +
  "rank_institutions_by_fee for who charges the most or least for one fee, and get_institution for one institution's fees with source links. " +
  "get_revenue_trend gives market-wide fee revenue by quarter back to 2010; get_fee_changes lists fee changes detected recently. " +
  "get_branches gives bank branch addresses with latitude/longitude (good for maps); get_local_market lists who competes in an institution's market with deposit share. " +
  "There is no full fee history yet, so do not infer fee trends from one snapshot. Credit the data as shown in each result's attribution field.";

type Endpoint = keyof McpV1Handlers;

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  endpoint: Endpoint;
  /** Turns tool arguments into the v1 query string. Throws ToolArgumentError on bad input. */
  toParams: (args: Record<string, unknown>) => Record<string, string>;
}

class ToolArgumentError extends Error {}

const stateProperty = { type: "string", description: "Two-letter state code, e.g. TX" };
const charterProperty = {
  type: "string",
  enum: ["bank", "credit_union"],
  description: "Limit to banks or to credit unions",
};
const assetTierProperty = {
  type: "string",
  description:
    "Asset-size tier(s), comma-separated: community_small (under $300M), community_mid ($300M-$1B), community_large ($1B-$10B), regional ($10B-$50B), large_regional ($50B-$250B), super_regional (over $250B)",
};

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolArgumentError(`${name} must be a string`);
  return value;
}

function optionalNumber(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new ToolArgumentError(`${name} must be a whole number`);
}

function compact(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

const TOOLS: ToolDefinition[] = [
  {
    name: "get_fee_index",
    title: "Typical fees",
    description:
      "Median, 25th-75th percentile, min and max for every fee category, nationally or for a state, charter type, Fed district or asset size, with how many institutions each figure comes from.",
    inputSchema: {
      type: "object",
      properties: {
        state: stateProperty,
        charter: charterProperty,
        district: { type: "string", description: "Fed district number 1-12, or several comma-separated, e.g. 11 or 6,11" },
        asset_tier: assetTierProperty,
      },
      additionalProperties: false,
    },
    endpoint: "index",
    toParams: (args) =>
      compact({
        state: optionalString(args, "state"),
        charter: optionalString(args, "charter"),
        district: optionalString(args, "district") ?? optionalNumber(args, "district"),
        asset_tier: optionalString(args, "asset_tier"),
      }),
  },
  {
    name: "list_fee_categories",
    title: "Fee categories",
    description:
      "Every fee category with its national median, range and institution count. Use the category key with get_fee_category.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: "fees",
    toParams: () => ({}),
  },
  {
    name: "get_fee_category",
    title: "One fee nationally",
    description:
      "One fee category (for example overdraft, nsf, monthly_maintenance) broken down by charter type, asset size, Fed district and state.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category key from list_fee_categories, e.g. overdraft" },
      },
      required: ["category"],
      additionalProperties: false,
    },
    endpoint: "fees",
    toParams: (args) => {
      const category = optionalString(args, "category");
      if (!category) throw new ToolArgumentError("category is required");
      return { category };
    },
  },
  {
    name: "find_institutions",
    title: "Find banks",
    description:
      "Find banks and credit unions by name, state, city or asset size. Returns ids, city, assets and how many published fees each has. Use the id with get_institution. City and asset_tier can't be combined with name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Part of the institution's name, e.g. Frost" },
        state: stateProperty,
        charter: charterProperty,
        city: { type: "string", description: "Exact city name, e.g. Austin" },
        asset_tier: assetTierProperty,
        has_fees: { type: "boolean", description: "Only institutions with published fees (ignored when name is given)" },
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    endpoint: "institutions",
    toParams: (args) => {
      const hasFees = args.has_fees;
      if (hasFees !== undefined && typeof hasFees !== "boolean") {
        throw new ToolArgumentError("has_fees must be true or false");
      }
      return compact({
        q: optionalString(args, "name"),
        state: optionalString(args, "state"),
        charter: optionalString(args, "charter"),
        city: optionalString(args, "city"),
        asset_tier: optionalString(args, "asset_tier"),
        has_fees: hasFees === true ? "true" : undefined,
        page: optionalNumber(args, "page"),
        limit: optionalNumber(args, "limit"),
      });
    },
  },
  {
    name: "get_institution",
    title: "One bank in full",
    description:
      "One institution's published fees (amount, conditions, the source link it was read from and the date), its FDIC/NCUA call report figures by quarter (8 by default, up to 66, back to 2010), and its CFPB complaint counts.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", minimum: 1, description: "Institution id from find_institutions" },
        quarters: { type: "integer", minimum: 1, maximum: 66, default: 8, description: "Call report quarters to include" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    endpoint: "institutions",
    toParams: (args) => {
      const id = optionalNumber(args, "id");
      if (!id) throw new ToolArgumentError("id is required");
      return compact({ id, quarters: optionalNumber(args, "quarters") });
    },
  },
  {
    name: "rank_institutions_by_fee",
    title: "Who charges the most",
    description:
      "Rank banks and credit unions by one fee, highest or lowest first, optionally within a state, charter type or name match. Each row has fee_amount (the institution's lowest published amount for that fee); null means not published, never $0.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category key from list_fee_categories, e.g. overdraft" },
        sort: { type: "string", enum: ["highest", "lowest"], default: "highest" },
        state: stateProperty,
        charter: charterProperty,
        name: { type: "string", description: "Optional part of the institution's name" },
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 25 },
      },
      required: ["category"],
      additionalProperties: false,
    },
    endpoint: "institutions",
    toParams: (args) => {
      const category = optionalString(args, "category");
      if (!category) throw new ToolArgumentError("category is required");
      return compact({
        fee_category: category,
        sort: optionalString(args, "sort"),
        state: optionalString(args, "state"),
        charter: optionalString(args, "charter"),
        q: optionalString(args, "name"),
        page: optionalNumber(args, "page"),
        limit: optionalNumber(args, "limit") ?? "25",
      });
    },
  },
  {
    name: "get_revenue_trend",
    title: "Fee revenue over time",
    description:
      "Market-wide deposit service-charge income from FDIC and NCUA call reports, by quarter, newest first, in thousands of US dollars. view=national splits banks vs credit unions with year-over-year change; view=districts gives each Fed district.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["national", "districts"], default: "national" },
        quarters: { type: "integer", minimum: 1, maximum: 66, default: 8 },
      },
      additionalProperties: false,
    },
    endpoint: "revenue",
    toParams: (args) =>
      compact({ view: optionalString(args, "view"), quarters: optionalNumber(args, "quarters") }),
  },
  {
    name: "get_fee_changes",
    title: "Recent fee changes",
    description:
      "Fee changes detected when an institution's published schedule changed between reads (previous and new amount, date). Coverage is still small, so treat it as examples, not a market-wide trend.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 365, default: 90 },
        category: { type: "string", description: "Optional category key, e.g. overdraft" },
      },
      additionalProperties: false,
    },
    endpoint: "feeChanges",
    toParams: (args) =>
      compact({ days: optionalNumber(args, "days"), category: optionalString(args, "category") }),
  },
  {
    name: "get_branches",
    title: "Branch locations",
    description:
      "Bank branches from the FDIC Summary of Deposits (latest year): name, address, ZIP, county, metro area, latitude/longitude and deposits. Give an institution_id for one bank's branches, or a state with optional city or ZIP for every bank branch there. Credit unions are not included. Use latitude/longitude to draw a map.",
    inputSchema: {
      type: "object",
      properties: {
        institution_id: { type: "integer", minimum: 1, description: "Institution id from find_institutions" },
        state: stateProperty,
        city: { type: "string", description: "Exact city name, e.g. Austin (with state)" },
        zip: { type: "string", description: "Five-digit ZIP code (with state)" },
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      additionalProperties: false,
    },
    endpoint: "branches",
    toParams: (args) =>
      compact({
        institution_id: optionalNumber(args, "institution_id"),
        state: optionalString(args, "state"),
        city: optionalString(args, "city"),
        zip: optionalString(args, "zip"),
        page: optionalNumber(args, "page"),
        limit: optionalNumber(args, "limit"),
      }),
  },
  {
    name: "get_local_market",
    title: "Local competitors",
    description:
      "Who competes in an institution's local market (the counties holding most of its deposits), with each competitor's deposits there and deposit share. Credit unions appear when headquartered in a market city, with no deposit figure. Pair with rank_institutions_by_fee or get_institution to compare their fees.",
    inputSchema: {
      type: "object",
      properties: {
        institution_id: { type: "integer", minimum: 1, description: "Institution id from find_institutions" },
      },
      required: ["institution_id"],
      additionalProperties: false,
    },
    endpoint: "market",
    toParams: (args) => {
      const id = optionalNumber(args, "institution_id");
      if (!id) throw new ToolArgumentError("institution_id is required");
      return { institution_id: id };
    },
  },
];

type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function callTool(
  request: NextRequest,
  handlers: McpV1Handlers,
  params: Record<string, unknown>,
) {
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return null;

  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (typeof args !== "object" || Array.isArray(args)) {
    return toolResult("arguments must be an object", true);
  }

  let query: Record<string, string>;
  try {
    query = tool.toParams(args);
  } catch (error) {
    if (error instanceof ToolArgumentError) return toolResult(error.message, true);
    throw error;
  }

  const url = new URL(ENDPOINT_PATHS[tool.endpoint], request.nextUrl.origin);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

  // Forward the caller's own credential, header or ?api_key=, so the v1 route
  // applies their key's plan and usage allowance.
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  const queryKey = request.nextUrl.searchParams.get("api_key");
  if (queryKey) url.searchParams.set("api_key", queryKey);
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const response = await handlers[tool.endpoint](new NextRequest(url, { headers }));
  const body = await response.text();
  return toolResult(body, !response.ok);
}

async function handleMessage(
  request: NextRequest,
  handlers: McpV1Handlers,
  message: JsonRpcMessage,
): Promise<object | null> {
  const isNotification = message.id === undefined;
  const id = message.id ?? null;

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Invalid request");
  }
  if (isNotification) return null;

  const params = (message.params ?? {}) as Record<string, unknown>;

  switch (message.method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "bank-fee-index", title: PRODUCT_NAME, version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const result = await callTool(request, handlers, params);
      return result ? rpcResult(id, result) : rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcpPost(request: NextRequest, handlers: McpV1Handlers): Promise<Response> {
  // Invitation only, like the API: no issued key, no connection.
  const auth = await validateApiKey(request);
  if (!auth.valid) {
    return Response.json(
      {
        error: auth.error ?? "An API key is required. Ask hello@bankfeeindex.com for access.",
        code: auth.error ? "invalid_api_key" : "api_key_required",
      },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) return Response.json(rpcError(null, -32600, "Invalid request"), { status: 400 });
    const replies = (
      await Promise.all(payload.map((m) => handleMessage(request, handlers, (m ?? {}) as JsonRpcMessage)))
    ).filter((reply): reply is object => reply !== null);
    return replies.length > 0 ? Response.json(replies) : new Response(null, { status: 202 });
  }

  const reply = await handleMessage(request, handlers, (payload ?? {}) as JsonRpcMessage);
  return reply ? Response.json(reply) : new Response(null, { status: 202 });
}

export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name);
