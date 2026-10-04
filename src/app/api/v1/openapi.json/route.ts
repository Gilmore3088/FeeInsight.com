import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { SITE_NAME, SITE_URL } from "@/lib/constants";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Bank Fee Index API",
    version: "1.0.0",
    description:
      "Programmatic access to bank and credit union fee benchmarking data covering 49 fee categories across thousands of U.S. financial institutions. Data sourced from published fee schedules, FDIC, and NCUA registries. Unauthenticated JSON reads are supported with free-tier rate limits; API keys are manually issued and are not self-serve from Account yet.",
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
  security: [{}, { BearerAuth: [] }, { ApiKeyQuery: [] }],
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
        description: "Pass a manually issued API key as a query parameter.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
        required: ["error"],
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
              },
            },
          },
        },
      },
    },
    parameters: {
      FormatParam: {
        name: "format",
        in: "query",
        schema: { type: "string", enum: ["csv"] },
        description: 'Set to "csv" for CSV download. Requires a signed-in Seat License export session.',
      },
    },
  },
  paths: {
    "/fees": {
      get: {
        operationId: "listFees",
        summary: "List fee categories",
        description:
          "Returns all 49 fee categories with national median, P25/P75 percentiles, min/max, and institution counts. Free tier is limited to 6 spotlight categories.",
        tags: ["Fees"],
        parameters: [
          { $ref: "#/components/parameters/FormatParam" },
        ],
        responses: {
          "200": {
            description: "Fee category list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    total: { type: "integer", example: 49 },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/FeeSummary" },
                    },
                  },
                },
              },
              "text/csv": {
                schema: { type: "string" },
              },
            },
          },
          "403": {
            description: "CSV export requires a Seat License",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/fees?category={category}": {
      get: {
        operationId: "getFeeCategoryDetail",
        summary: "Get fee category detail",
        description:
          "Detailed breakdown for a single fee category including segmentation by charter type, asset tier, Fed district, and state. Pro and Enterprise only.",
        tags: ["Fees"],
        parameters: [
          {
            name: "category",
            in: "query",
            required: true,
            schema: { type: "string" },
            description:
              "Fee category slug (e.g., overdraft, nsf, monthly_maintenance)",
            example: "overdraft",
          },
        ],
        responses: {
          "200": {
            description: "Category detail with segmentation breakdowns",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/FeeCategoryDetail",
                },
              },
            },
          },
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
          "Returns the national fee index for all categories. Apply filters for peer benchmarking by state, charter type, or Fed district. Includes maturity indicators and bank/CU counts.",
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
        },
      },
    },
    "/institutions": {
      get: {
        operationId: "listInstitutions",
        summary: "List institutions",
        description:
          "Paginated list of financial institutions with fee data. Filter by state and charter type. Maximum 200 results per page.",
        tags: ["Institutions"],
        parameters: [
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
            description: "Paginated institution list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    total: { type: "integer" },
                    page: { type: "integer" },
                    page_size: { type: "integer" },
                    pages: { type: "integer" },
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/InstitutionSummary",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/institutions?id={id}": {
      get: {
        operationId: "getInstitutionDetail",
        summary: "Get institution detail",
        description:
          "Returns a single institution's profile with all extracted fees. Pro and Enterprise only.",
        tags: ["Institutions"],
        parameters: [
          {
            name: "id",
            in: "query",
            required: true,
            schema: { type: "integer" },
            description: "Institution ID",
            example: 123,
          },
        ],
        responses: {
          "200": {
            description: "Institution profile with fees",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InstitutionDetail",
                },
              },
            },
          },
          "400": {
            description: "Invalid ID",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
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
      "Rate limits are applied per API key when present and by anonymous request source otherwise. Free: 100 requests/month. Manually issued Pro keys: 10,000 requests/month. Enterprise: custom.",
    headers: {
      "X-RateLimit-Limit": "Maximum requests allowed in the current window",
      "X-RateLimit-Remaining": "Requests remaining in the current window",
      "X-RateLimit-Reset": "UTC epoch timestamp when the window resets",
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
