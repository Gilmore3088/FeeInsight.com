import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { SITE_NAME, SITE_URL } from "@/lib/constants";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Bank Fee Index API",
    version: "1.2.0",
    description:
      "Programmatic access to bank and credit union fee benchmarking data across thousands of U.S. financial institutions. Covers a curated catalog of consumer and commercial fee categories, sourced from published fee schedules, FDIC, and NCUA registries. Access is by invitation: every request needs an API key, issued by hand.",
    contact: {
      name: SITE_NAME,
      email: "hello@bankfeeindex.com",
      url: "https://feeinsight.com/api-docs",
    },
    termsOfService: "https://feeinsight.com/terms",
  },
  servers: [
    {
      url: `${SITE_URL}/api/v1`,
      description: "Production",
    },
  ],
  security: [{ BearerAuth: [] }, { ApiKeyQuery: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Pass a manually issued API key as a Bearer token in the Authorization header.",
      },
      ApiKeyQuery: {
        type: "apiKey",
        in: "query",
        name: "api_key",
        description:
          "Pass a manually issued API key as a query parameter. Prefer the Authorization header: keys in URLs end up in logs and browser history.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        description: "Every error has a readable message and a stable machine code.",
        properties: {
          error: { type: "string", example: "state must be a two-letter code such as TX" },
          code: {
            type: "string",
            enum: [
              "api_key_required",
              "invalid_api_key",
              "invalid_parameter",
              "not_found",
              "plan_required",
              "rate_limited",
              "rate_limit_unavailable",
            ],
          },
          upgrade_url: { type: "string", description: "Present on plan_required errors." },
          limit: { type: "integer", description: "Present on rate_limited errors." },
          reset: { type: "string", format: "date-time", description: "Present on rate_limited errors." },
        },
        required: ["error", "code"],
      },
      FeeSummary: {
        type: "object",
        properties: {
          category: {
            type: "string",
            example: "overdraft",
          },
          display_name: {
            type: "string",
            example: "Overdraft Fee",
          },
          family: {
            type: "string",
            example: "Overdraft & NSF",
          },
          tier: {
            type: "string",
            enum: ["spotlight", "core", "extended", "comprehensive"],
          },
          median: { type: "number", example: 35.0 },
          p25: { type: "number", example: 30.0 },
          p75: { type: "number", example: 36.0 },
          min: { type: "number", example: 5.0 },
          max: { type: "number", example: 40.0 },
          institution_count: { type: "integer", example: 842 },
        },
      },
      FeeCategoryDetail: {
        type: "object",
        properties: {
          category: { type: "string" },
          display_name: { type: "string" },
          family: { type: "string" },
          tier: { type: "string" },
          summary: {
            type: "object",
            properties: {
              institution_count: { type: "integer" },
              observation_count: { type: "integer" },
            },
          },
          by_charter_type: {
            type: "object",
            description:
              "Breakdown by charter type (bank vs credit_union) with median, p25, p75, count.",
          },
          by_asset_tier: {
            type: "object",
            description:
              "Breakdown by asset size tier with median, p25, p75, count.",
          },
          by_fed_district: {
            type: "object",
            description:
              "Breakdown by Federal Reserve district (1-12) with median, p25, p75, count.",
          },
          by_state: {
            type: "object",
            description:
              "Breakdown by state code with median, p25, p75, count.",
          },
        },
      },
      IndexEntry: {
        type: "object",
        properties: {
          category: { type: "string", example: "monthly_maintenance" },
          display_name: {
            type: "string",
            example: "Monthly Maintenance Fee",
          },
          family: { type: "string", example: "Account Maintenance" },
          tier: { type: "string" },
          median: { type: "number", example: 12.0 },
          p25: { type: "number", example: 8.0 },
          p75: { type: "number", example: 15.0 },
          min: { type: "number", example: 0.0 },
          max: { type: "number", example: 30.0 },
          institution_count: { type: "integer", example: 1205 },
          bank_count: { type: "integer", example: 710 },
          cu_count: { type: "integer", example: 495 },
          maturity: {
            type: "string",
            enum: ["strong", "provisional", "insufficient"],
          },
        },
      },
      InstitutionSummary: {
        type: "object",
        properties: {
          id: { type: "integer", example: 123 },
          name: {
            type: "string",
            example: "First National Bank",
          },
          state: { type: "string", example: "NY" },
          city: { type: "string", example: "New York" },
          charter_type: {
            type: "string",
            enum: ["bank", "credit_union"],
          },
          asset_size: { type: "number", example: 1200000000 },
          asset_tier: { type: "string", example: "1B-10B" },
          fed_district: { type: "integer", example: 2 },
          fee_count: { type: "integer", example: 18 },
        },
      },
      InstitutionDetail: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          state: { type: "string" },
          city: { type: "string" },
          charter_type: { type: "string" },
          asset_size: { type: "number" },
          asset_tier: { type: "string" },
          fed_district: { type: "integer" },
          fee_count: { type: "integer" },
          fees: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fee_name: { type: "string", example: "Overdraft Fee" },
                amount: { type: "number", example: 35.0 },
                frequency: {
                  type: "string",
                  nullable: true,
                  example: "per item",
                },
                conditions: {
                  type: "string",
                  nullable: true,
                  example: "Waived for balances over $5,000",
                },
                review_status: {
                  type: "string",
                  enum: ["pending", "staged", "approved"],
                },
                category: { type: "string", nullable: true, example: "overdraft" },
                confidence: { type: "number", example: 0.97 },
                source_url: {
                  type: "string",
                  nullable: true,
                  description: "The institution's own fee schedule this fee was read from.",
                },
                published_at: { type: "string", format: "date-time", nullable: true },
              },
            },
          },
          call_reports: {
            type: "array",
            description:
              "Latest 8 quarters of FDIC (banks) or NCUA (credit unions) call report figures, newest first. Dollar amounts are whole dollars.",
            items: {
              type: "object",
              properties: {
                report_date: { type: "string", example: "2026-06-30" },
                source: { type: "string", enum: ["fdic", "ncua"] },
                total_assets: { type: "number", nullable: true },
                total_deposits: { type: "number", nullable: true },
                total_loans: { type: "number", nullable: true },
                service_charge_income: { type: "number", nullable: true },
                overdraft_revenue: { type: "number", nullable: true },
                other_noninterest_income: { type: "number", nullable: true },
                total_revenue: { type: "number", nullable: true },
                fee_income_ratio: { type: "number", nullable: true },
                net_interest_margin: { type: "number", nullable: true },
                efficiency_ratio: { type: "number", nullable: true },
                roa: { type: "number", nullable: true },
                roe: { type: "number", nullable: true },
                tier1_capital_ratio: { type: "number", nullable: true },
                branch_count: { type: "number", nullable: true },
                employee_count: { type: "number", nullable: true },
                member_count: { type: "number", nullable: true },
              },
            },
          },
          complaints: {
            type: "array",
            description: "CFPB consumer complaint totals by product.",
            items: {
              type: "object",
              properties: {
                product: { type: "string", example: "Checking or savings account" },
                complaint_count: { type: "integer" },
              },
            },
          },
          attribution: {
            type: "object",
            description: "Credit line to display with the data.",
            properties: {
              text: { type: "string", example: "Source: Bank Fee Index, feeinsight.com" },
              url: { type: "string", example: "https://feeinsight.com" },
            },
          },
        },
      },
    },
    responses: {
      BadRequest: {
        description: "A query parameter is malformed or out of range (code invalid_parameter)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Unauthorized: {
        description: "No API key was sent (code api_key_required), or it is unknown or revoked (code invalid_api_key)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      PlanRequired: {
        description: "The request needs a Pro or Enterprise key (code plan_required)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      RateLimited: {
        description: "The monthly allowance is used up (code rate_limited)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Unavailable: {
        description: "Usage tracking is temporarily down; retry after the Retry-After seconds (code rate_limit_unavailable)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
    parameters: {
      FormatParam: {
        name: "format",
        in: "query",
        schema: { type: "string", enum: ["csv"] },
        description: 'Set to "csv" for CSV download. Requires a pro or enterprise API key, or a signed-in Seat License export session.',
      },
    },
  },
  paths: {
    "/fees": {
      get: {
        operationId: "listFees",
        summary: "List fee categories",
        description:
          "Returns every fee category in the catalog with national median, P25/P75 percentiles, min/max, and institution counts. Free-tier keys are limited to 6 spotlight categories. Pass `category` for one category's breakdown by charter type, asset tier, Fed district, and state (Pro and Enterprise only).",
        tags: ["Fees"],
        parameters: [
          {
            name: "category",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Fee category slug (e.g., overdraft, nsf, monthly_maintenance). When set, returns that category's detail instead of the list.",
            example: "overdraft",
          },
          { $ref: "#/components/parameters/FormatParam" },
        ],
        responses: {
          "200": {
            description: "Fee category list, or one category's detail when `category` is set",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        total: { type: "integer", example: 60 },
                        data: {
                          type: "array",
                          items: { $ref: "#/components/schemas/FeeSummary" },
                        },
                      },
                    },
                    { $ref: "#/components/schemas/FeeCategoryDetail" },
                  ],
                },
              },
              "text/csv": {
                schema: { type: "string" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/PlanRequired" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": { $ref: "#/components/responses/Unavailable" },
          "404": {
            description: "Category not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/index": {
      get: {
        operationId: "getFeeIndex",
        summary: "National & peer fee index",
        description:
          "Returns the national fee index. The free tier gets the spotlight categories; Pro and Enterprise keys get every category. Apply filters for peer benchmarking by state, charter type, or Fed district. Includes maturity indicators and bank/CU counts.",
        tags: ["Index"],
        parameters: [
          {
            name: "state",
            in: "query",
            schema: { type: "string" },
            description: "Two-letter state code (e.g., CA, TX, NY)",
            example: "CA",
          },
          {
            name: "charter",
            in: "query",
            schema: {
              type: "string",
              enum: ["bank", "credit_union"],
            },
            description: "Filter by charter type",
          },
          {
            name: "district",
            in: "query",
            schema: { type: "string" },
            description:
              "Fed district number(s), comma-separated (1-12). Example: 7 or 2,7,12",
            example: "7",
          },
          { $ref: "#/components/parameters/FormatParam" },
        ],
        responses: {
          "200": {
            description: "Fee index entries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    scope: {
                      type: "string",
                      enum: ["national", "filtered"],
                    },
                    filters: {
                      type: "object",
                      properties: {
                        state: {
                          type: "string",
                          nullable: true,
                        },
                        charter: {
                          type: "string",
                          nullable: true,
                        },
                        district: {
                          type: "string",
                          nullable: true,
                        },
                      },
                    },
                    total: { type: "integer" },
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/IndexEntry",
                      },
                    },
                  },
                },
              },
              "text/csv": {
                schema: { type: "string" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/PlanRequired" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": { $ref: "#/components/responses/Unavailable" },
        },
      },
    },
    "/institutions": {
      get: {
        operationId: "listInstitutions",
        summary: "List institutions",
        description:
          "Paginated list of financial institutions with fee data. Filter by state and charter type. Maximum 200 results per page. Pass `id` for one institution's profile with fees, call reports and complaints (Pro and Enterprise only).",
        tags: ["Institutions"],
        parameters: [
          {
            name: "id",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Institution ID. When set, returns that institution's detail instead of the list.",
            example: 123,
          },
          {
            name: "state",
            in: "query",
            schema: { type: "string" },
            description: "Two-letter state code",
            example: "NY",
          },
          {
            name: "charter",
            in: "query",
            schema: {
              type: "string",
              enum: ["bank", "credit_union"],
            },
            description: "Filter by charter type",
          },
          {
            name: "has_fees",
            in: "query",
            schema: { type: "string", enum: ["true", "false"] },
            description: "Only institutions with at least one published fee (not applied with q)",
          },
          {
            name: "q",
            in: "query",
            schema: { type: "string", minLength: 2, maxLength: 100 },
            description:
              "Search by institution name, e.g. Frost. Institutions with published fees sort first; fed_district is null in name-search results.",
          },
          {
            name: "page",
            in: "query",
            schema: {
              type: "integer",
              default: 1,
              minimum: 1,
            },
            description: "Page number",
          },
          {
            name: "limit",
            in: "query",
            schema: {
              type: "integer",
              default: 50,
              minimum: 1,
              maximum: 200,
            },
            description: "Results per page",
          },
        ],
        responses: {
          "200": {
            description: "Paginated institution list, or one institution's detail when `id` is set",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        total: { type: "integer" },
                        page: { type: "integer" },
                        page_size: { type: "integer" },
                        pages: { type: "integer" },
                        has_more: { type: "boolean", description: "True when a later page exists" },
                        data: {
                          type: "array",
                          items: {
                            $ref: "#/components/schemas/InstitutionSummary",
                          },
                        },
                      },
                    },
                    { $ref: "#/components/schemas/InstitutionDetail" },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/PlanRequired" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": { $ref: "#/components/responses/Unavailable" },
          "404": {
            description: "Institution not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    {
      name: "Fees",
      description:
        "Fee category data -- national medians, percentiles, and segmented breakdowns.",
    },
    {
      name: "Index",
      description:
        "National and peer fee index -- the benchmark for U.S. financial institution fees.",
    },
    {
      name: "Institutions",
      description:
        "Institution profiles and their individual fee schedules.",
    },
  ],
  "x-rateLimit": {
    description:
      "One monthly allowance per API key, shared across all endpoints. Free keys: 100 requests/month. Pro keys: 10,000 requests/month. Enterprise: unlimited, so X-RateLimit-Limit and X-RateLimit-Remaining are omitted.",
    headers: {
      "X-RateLimit-Limit": "Maximum requests allowed in the current window",
      "X-RateLimit-Remaining": "Requests remaining in the current window",
      "X-RateLimit-Reset": "ISO 8601 UTC time when the monthly window resets",
    },
  },
};

async function handleGET() {
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const GET = withApiRoutePolicy("api.v1.openapi", "GET", handleGET);
