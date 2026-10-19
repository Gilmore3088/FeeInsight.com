import { cleanup, render, screen, within } from "@testing-library/react";
import Ajv from "ajv";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public-stats", () => ({
  getPublicStatsSummary: vi.fn().mockResolvedValue({
    categories: 50,
    categoriesLabel: "50",
    institutionsLabel: "200",
    monitoredLabel: "1,000",
    freshnessLabel: "Updated October 19, 2026",
  }),
}));
vi.mock("@/lib/api-hardening/audit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-hardening/audit")>(),
  recordApiRouteAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import ApiDocsPage from "./page";
import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { API_ERROR_CODES } from "@/lib/api-v1";

afterEach(cleanup);

describe("API documentation", () => {
  it("provides complete JSON fixtures that match their published response contracts", async () => {
    const { container } = render(await ApiDocsPage());
    const spec = await (await getOpenApi()).json();
    const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    const endpoints = container.querySelectorAll("article");
    expect(endpoints.length).toBeGreaterThan(0);

    for (const endpoint of endpoints) {
      const path = endpoint.querySelector("code")!.textContent!.split("?")[0];
      const example = endpoint.querySelector('pre[aria-label^="Example response"] code')!.textContent!;
      const response = JSON.parse(example);
      const schema = spec.paths[path].get.responses["200"].content["application/json"].schema;
      const validate = ajv.compile({ ...schema, components: spec.components });
      expect(validate(response), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }

    const error = JSON.parse(screen.getByLabelText("Example error · HTTP 400").textContent!);
    const validateError = ajv.compile({ ...spec.components.schemas.Error, components: spec.components });
    expect(validateError(error)).toBe(true);
  });

  it("gives every endpoint a unique linked heading and labeled parameter headers", async () => {
    const { container } = render(await ApiDocsPage());
    const endpoints = screen.getAllByRole("article");
    const ids = endpoints.map((endpoint) => {
      const heading = within(endpoint).getByRole("heading", { level: 3 });
      expect(heading.id).not.toBe("");
      expect(endpoint).toHaveAttribute("aria-labelledby", heading.id);
      expect(within(heading).getByRole("link")).toHaveAttribute("href", `#${heading.id}`);

      const table = within(endpoint).queryByRole("table");
      if (!table) {
        expect(endpoint.querySelector("code")!.textContent).toBe("/hamilton-context");
        expect(within(endpoint).getByText("No query parameters.")).toBeInTheDocument();
        return heading.id;
      }
      expect(table).toHaveAccessibleName(/parameters$/);
      expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Name", "Type", "Description"]);
      for (const header of within(table).getAllByRole("columnheader")) expect(header).toHaveAttribute("scope", "col");
      for (const header of within(table).getAllByRole("rowheader")) expect(header).toHaveAttribute("scope", "row");
      return heading.id;
    });
    expect(new Set(ids).size).toBe(ids.length);

    const nav = screen.getByRole("navigation", { name: "API documentation" });
    for (const link of within(nav).getAllByRole("link")) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) expect(container.querySelector(href)).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Rate limits" })).toHaveAttribute("href", "#rate-limits");
    expect(within(nav).getByRole("link", { name: "Data notes" })).toHaveAttribute("href", "#data-notes");
  });

  it("keeps example counts, pagination, market shares and peer rankings internally consistent", async () => {
    const { container } = render(await ApiDocsPage());
    for (const endpoint of container.querySelectorAll("article")) {
      const path = endpoint.querySelector("code")!.textContent!.split("?")[0];
      const response = JSON.parse(endpoint.querySelector('pre[aria-label^="Example response"] code')!.textContent!);
      if (response.total !== undefined) {
        // These examples each show their whole result set; real paginated responses may have more pages.
        expect(response.total, path).toBe(response.data.length);
        if (response.page_size !== undefined) {
          expect(response.page).toBe(1);
          expect(response.pages).toBe(Math.ceil(response.total / response.page_size));
          expect(response.has_more).toBe(false);
        }
      }
      if (response.fees) expect(response.fee_count).toBe(response.fees.length);
      if (path === "/fee-changes") expect(response.count).toBe(response.data.length);
      if (path === "/market") {
        const members = response.data as { is_subject: boolean; market_deposits: number | null; deposit_share_pct: number | null }[];
        expect(response.competitor_count).toBe(members.filter((member) => !member.is_subject).length);
        expect(response.total_market_deposits).toBe(members.reduce((sum, member) => sum + (member.market_deposits ?? 0), 0));
        for (const member of members) {
          const share = member.market_deposits === null || response.total_market_deposits === 0
            ? null
            : Math.round(member.market_deposits / response.total_market_deposits * 1000) / 10;
          expect(member.deposit_share_pct).toBe(share);
        }
      }
      if (path === "/peers") {
        for (const category of response.categories) {
          expect(category.peer_count).toBe(category.peers_lower + category.peers_same + category.peers_higher);
          expect(category.percentile).toBe(Math.round(100 * (category.peers_lower + category.peers_same / 2) / category.peer_count));
          expect(category.amount_low).toBe(Math.min(...category.fees.map((fee: { amount: number }) => fee.amount)));
          expect(category.amount_high).toBe(Math.max(...category.fees.map((fee: { amount: number }) => fee.amount)));
        }
        if (response.categories.length === 1) expect(response.peer_group.peers_with_fees).toBe(response.categories[0].peer_count);
      }
    }
  });

  it("provides an HTTP status and recovery action for every stable API error code", async () => {
    render(await ApiDocsPage());
    const table = screen.getByRole("table", { name: "API error statuses, codes and recovery actions" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(API_ERROR_CODES.length);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([...API_ERROR_CODES]);
    for (const row of rows) {
      const cells = within(row).getAllByRole("cell");
      expect(cells[0].textContent).toMatch(/^(400|401|403|404|429|503)$/);
      expect(cells[1].textContent!.length).toBeGreaterThan(20);
    }
    expect(within(table).getByText("burst_limited").closest("tr")).toHaveTextContent("Retry-After");
    expect(within(table).getByText("rate_limited").closest("tr")).toHaveTextContent("X-RateLimit-Reset");
    expect(within(table).getByText("account_context_required").closest("tr")).toHaveTextContent("Generic partner keys");
    expect(within(table).getByText("context_unavailable").closest("tr")).toHaveTextContent("no partial account context");
  });

  it("documents holder context and saved-peer precedence without making institution_id mandatory", async () => {
    const { container } = render(await ApiDocsPage());
    const context = within(screen.getByRole("article", { name: "Read your saved institution and peer sets" }));
    expect(context.getByText("No query parameters.")).toBeInTheDocument();
    expect(context.getByText(/generic partner keys return 403 account_context_required/i)).toBeInTheDocument();
    const example = JSON.parse(context.getByLabelText("Example response · illustrative values, not live data").textContent!);
    expect(example.institution_source).toBe("manual");
    expect(example.peer_sets[0]).toMatchObject({ scope: "personal", workspace_institution_id: null });
    expect(example).not.toHaveProperty("user_id");
    expect(example).not.toHaveProperty("email");

    const peers = within(screen.getByRole("article", { name: "Compare one institution's fees with its peers" }));
    for (const name of ["institution_id", "saved_peer_set_id", "use_saved_context"]) {
      expect(peers.getByRole("rowheader", { name })).not.toHaveTextContent("required");
    }
    expect(peers.getByText(/explicit peer_ids or peer-group parameters bypass saved peer defaults/i)).toBeInTheDocument();
    expect(container).toHaveTextContent("get_hamilton_context");
  });
});
