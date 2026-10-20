// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ROWS } from "./limits";
import { receiveUpload } from "./service";

const mocks = vi.hoisted(() => ({
  createUpload: vi.fn(), getUpload: vi.fn(), saveMemoryFact: vi.fn(), setUploadStatus: vi.fn(),
  workspaceSchemaReady: vi.fn(), recordProRequest: vi.fn(), resolve: vi.fn(),
}));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.recordProRequest }));
vi.mock("@/lib/data-store/hamilton-workspace", () => mocks);
vi.mock("../workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceSchemaReady.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue({ institution: { id: 42 } });
  mocks.createUpload.mockResolvedValue({ id: "synthetic-upload" });
});

describe("failed parse has no upload/preview, ledger, or fee-memory writes", () => {
  it.each([
    ["fees.csv", Buffer.from("Fee name,Count\n" + "Overdraft,0\n".repeat(MAX_ROWS))],
    ["fees.csv", Buffer.from('Fee name,Count\nOverdraft,"unclosed')],
    ["fees.xlsx", Buffer.from(zipSync({ "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="ZZZZ1"><v>1</v></c></row></sheetData></worksheet>') }))],
    ["fees.xlsx", Buffer.from("PK")],
  ])("returns an actionable 400 without persisting %s", async (fileName, bytes) => {
    const result = await receiveUpload({ id: 7 }, { institutionId: 42, fileName, contentType: null, bytes });
    expect(result).toMatchObject({ status: 400, body: { error: expect.stringMatching(/Export|export/) } });
    expect(result.body).not.toHaveProperty("preview");
    for (const write of [mocks.createUpload, mocks.recordProRequest, mocks.saveMemoryFact, mocks.setUploadStatus]) expect(write).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: 42, persistUrlSelection: false });
  });
  it("still saves a complete valid zero-valued preview, leaving application separate", async () => {
    const result = await receiveUpload({ id: 7 }, { institutionId: 42, fileName: "fees.csv", contentType: "text/csv", bytes: Buffer.from("Fee name,Count\nOverdraft,0\n") });
    expect(result.status).toBe(200);
    expect(mocks.createUpload).toHaveBeenCalledWith(expect.objectContaining({ status: "mapped", preview: expect.objectContaining({ rowsRead: 1, fees: [expect.objectContaining({ annualItems: 0 })] }) }));
    expect(mocks.recordProRequest).toHaveBeenCalledTimes(1);
    expect(mocks.saveMemoryFact).not.toHaveBeenCalled();
    expect(mocks.setUploadStatus).not.toHaveBeenCalled();
  });
});
