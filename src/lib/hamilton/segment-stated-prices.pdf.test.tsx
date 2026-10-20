// @vitest-environment node
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("No database in PDF test"); } }));
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { marketBoardBriefInput } from "@/components/hamilton/intelligence/market-board-brief";
import type { Loaded } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
import { boardBriefFromMarket } from "./board-brief";

it("exports the actual board PDF with named source prices and all schedules (#1993)", async () => {
  const selection = { version: 1 as const, task: "compare" as const, scope: { kind: "national" as const }, charter: "all" as const, categories: ["money_order"] };
  const data: Loaded = { fees: null, feeMap: null, revenue: null, tiers: null, economy: null, complaints: null, articles: null, statePosts: null,
    peers: { category: "money_order", institutionsInScope: 1, rows: [{ institutionId: 1, name: "Synthetic Bank", amount: 3.325, charter: "bank", totalAssets: 10_000_000,
      documentUrl: null, documentUrls: ["https://bank.test/a.pdf", "https://bank.test/b.pdf"], publishedAt: null,
      several: { low: 1.65, high: 5, fees: [{ name: "Personal money order", amount: 1.65 }, { name: "Postal money order", amount: 5 }] },
    }] } };
  const report = boardBriefFromMarket(marketBoardBriefInput(selection, data, ["fees"], null));
  const pdf = await renderToBuffer(createElement(PdfDocument, { report, reportType: "board_brief" }) as ReactElement<DocumentProps>);
  const text = (await extractText(new Uint8Array(pdf), { mergePages: true })).text.replace(/\s+/g, " ");
  for (const value of ["Synthetic Bank", "$1.65", "$5.00", "Personal money order", "Postal money order", "https://bank.test/a.pdf", "https://bank.test/b.pdf"]) expect(text).toContain(value);
  expect(text).not.toContain("$3.33");
}, 20_000);
