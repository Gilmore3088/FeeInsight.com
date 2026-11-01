// @vitest-environment node
/**
 * V5 T6 (data rights): a Hamilton data file is a check of what the screen showed, never a bulk
 * copy of the cleaned database. One file holds at most HAMILTON_EXPORT_MAX_ROWS rows; an account
 * downloads at most HAMILTON_EXPORT_DAILY_FILES a day; an unreadable count refuses the file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  used: 0 as number | Error,
  inserts: [] as unknown[][],
  members: 0,
}));

vi.mock("@/lib/data-store/connection", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("INSERT INTO public.api_route_audit_events")) {
      state.inserts.push(values);
      return Promise.resolve([]);
    }
    if (state.used instanceof Error) return Promise.reject(state.used);
    return Promise.resolve([{ used: state.used }]);
  };
  return { sql, getSql: () => sql };
});
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => state.user) }));
vi.mock("@/lib/hamilton/fee-workspace-data", () => ({
  loadFeeWorkspace: vi.fn(async () => ({
    fee: "overdraft",
    local: null,
    layers: [{
      key: "national",
      n: state.members,
      members: Array.from({ length: state.members }, (_, i) => ({
        institutionId: i + 1, institutionName: `Synthetic Bank ${i + 1}`, amount: 20 + (i % 15), stateCode: "KS",
        sourceDocumentIds: [], documentUrls: [`https://bank${i + 1}.example.test/fees.pdf`], publishedAt: "2026-09-01",
      })),
    }],
  })),
}));

import {
  EXPORT_LIMIT_MESSAGE, EXPORT_UNAVAILABLE_MESSAGE, HAMILTON_EXPORT_DAILY_FILES, HAMILTON_EXPORT_MAX_ROWS, PEER_CSV_EXPORT_POLICY,
  capExportRows, checkExportAllowance,
} from "./export-limits";
import { GET } from "@/app/pro/(hamilton)/research/peers/route";

const pro = { id: 9921001, role: "premium", subscription_status: "active", workspace_seat: false };
const csv = () => GET(new Request("http://localhost/pro/research/peers?fee=overdraft&layer=national"));
const dataRows = (text: string) => text.trim().split("\n").slice(1).filter((l) => !/^"?Note:/.test(l));

beforeEach(() => {
  state.user = pro;
  state.used = 0;
  state.inserts = [];
  state.members = 0;
});

describe("Hamilton export limits (V5 T6)", () => {
  it("caps one file's rows and says so", () => {
    expect(HAMILTON_EXPORT_MAX_ROWS).toBe(500);
    expect(capExportRows([1, 2, 3], 2)).toEqual({ rows: [1, 2], truncated: true });
    expect(capExportRows([1, 2], 2)).toEqual({ rows: [1, 2], truncated: false });
  });

  it("counts only this account's served files today, and fails closed when the count is unreadable", async () => {
    state.used = HAMILTON_EXPORT_DAILY_FILES - 1;
    expect(await checkExportAllowance(1)).toEqual({ allowed: true, used: HAMILTON_EXPORT_DAILY_FILES - 1 });
    state.used = HAMILTON_EXPORT_DAILY_FILES;
    expect(await checkExportAllowance(1)).toEqual({ allowed: false, reason: "limit", used: HAMILTON_EXPORT_DAILY_FILES });
    state.used = new Error("relation does not exist");
    expect(await checkExportAllowance(1)).toEqual({ allowed: false, reason: "unreadable", used: 0 });
  });

  it("a nation-wide layer of 3,000 institutions downloads as 500 rows plus a note, and the file is recorded", async () => {
    state.members = 3000;
    const res = await csv();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(dataRows(text)).toHaveLength(HAMILTON_EXPORT_MAX_ROWS);
    expect(text).toContain("Note: the screen counted 3000 institutions; a file lists at most 500, lowest amount first.");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toContain(PEER_CSV_EXPORT_POLICY.routeId);
    expect(state.inserts[0]).toContain(pro.id);
  });

  it("a small layer downloads whole, with no note", async () => {
    state.members = 12;
    const text = await (await csv()).text();
    expect(dataRows(text)).toHaveLength(12);
    expect(text).not.toContain("Note:");
  });

  it("refuses the 51st file of the day with a plain message, and an unreadable count with another", async () => {
    state.members = 12;
    state.used = HAMILTON_EXPORT_DAILY_FILES;
    const limited = await csv();
    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe(EXPORT_LIMIT_MESSAGE);
    state.used = new Error("timeout");
    const down = await csv();
    expect(down.status).toBe(503);
    expect(await down.text()).toBe(EXPORT_UNAVAILABLE_MESSAGE);
  });

  it("gives an account without Hamilton access nothing", async () => {
    state.user = { id: 9921002, role: "viewer", subscription_status: "canceled", workspace_seat: false };
    state.members = 12;
    const res = await csv();
    expect(res.status).toBe(401);
    expect(state.inserts).toHaveLength(0);
  });
});
