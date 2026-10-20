/**
 * A full-size committee packet input for print checks: 12 peers with long names, 10 fees, 8 filed
 * income quarters and about 30 sources. Synthetic fee data only; it is not a claim about any real
 * institution's fees. Used by committee-packet.pdf.test.tsx.
 */
import type { CommitteePacketInput, PacketIncomeRow } from "./committee-packet";
import type { Fact, PeerValue } from "./workspace/types";

const PEERS = [
  "First Community Federal Savings and Loan Association of the Gulf Coast",
  "Example Savings Bank",
  "Harbor City Cooperative Bank",
  "Sunshine State Teachers Federal Credit Union",
  "Northwest Florida Farmers and Merchants Bank and Trust Company",
  "Palm Valley Community Bank",
  "Citrus County Credit Union",
  "Bay Area Savings and Trust",
  "Panhandle Regional Employees Federal Credit Union",
  "Coastal Heritage National Bank",
  "Riverbend State Bank",
  "Keys Mutual Savings Institution",
];

const FEES: { category: string; current: number | null; amounts: number[]; base: number; step: number; publishers: number }[] = [
  // Overdraft is compared at its highest tier, so several amounts still give one value to resolve.
  { category: "overdraft", current: 45, amounts: [45, 15], base: 25, step: 1.5, publishers: 12 },
  { category: "nsf", current: 34, amounts: [34], base: 22, step: 1.25, publishers: 11 },
  // Several different amounts and not overdraft: no single price, so no comparison value (#1930).
  { category: "monthly_maintenance", current: null, amounts: [4, 12, 25], base: 6, step: 1, publishers: 10 },
  { category: "atm_non_network", current: 3, amounts: [3], base: 2, step: 0.25, publishers: 12 },
  { category: "wire_domestic_outgoing", current: 30, amounts: [30], base: 20, step: 1, publishers: 9 },
  { category: "stop_payment", current: 30, amounts: [30], base: 25, step: 1, publishers: 8 },
  { category: "paper_statement", current: 2, amounts: [2], base: 1, step: 0.5, publishers: 7 },
  { category: "cashiers_check", current: 10, amounts: [10], base: 6, step: 0.5, publishers: 10 },
  { category: "wire_intl_outgoing", current: null, amounts: [], base: 40, step: 2, publishers: 6 },
  { category: "card_replacement", current: 5, amounts: [5], base: 5, step: 0, publishers: 3 },
];

/** How a schedule might word each fee. */
const WORDING: Record<string, string> = {
  overdraft: "Overdraft Item Fee",
  nsf: "Returned Item (NSF) Fee",
  monthly_maintenance: "Monthly Service Charge",
  atm_non_network: "Foreign ATM Withdrawal",
  wire_domestic_outgoing: "Outgoing Wire Transfer - Domestic",
  stop_payment: "Stop Payment Order",
  paper_statement: "Paper Statement Fee",
  cashiers_check: "Official Check",
  card_replacement: "Debit Card Replacement",
};

const OWN = 323;
const OWN_NAME = "Capital City Bank and Trust Company of North Florida";

/** The 12 named peers, then numbered ones for a longer list. */
function peerName(i: number): string {
  return PEERS[i] ?? `Example Regional Savings and Loan Association Number ${i + 1}`;
}

function peerValue(i: number, amount: number): PeerValue {
  const id = 1000 + i;
  return {
    institutionId: id,
    institutionName: peerName(i),
    amount,
    stateCode: "FL",
    sourceDocumentIds: [id * 10 + 1],
    documentUrls: [`https://www.example-bank-${i + 1}.test/disclosures/personal-banking/fee-schedule-${2026}-${i + 1}.pdf`],
    publishedAt: `2026-0${(i % 3) + 7}-1${i % 9}T00:00:00.000Z`,
  };
}

const RULES: Fact[] = Array.from({ length: 6 }, (_, i) => ({
  text: `Proposed rule ${i + 1}: overdraft and non-sufficient funds fee disclosures for accounts held by consumers, published for comment`,
  source: { label: `Federal Register document 2026-${2100 + i}`, table: "reg_tracker_items", asOf: `2026-09-0${i + 1}`, url: `https://www.federalregister.gov/documents/2026/09/0${i + 1}/2026-${2100 + i}/overdraft-and-nsf-fee-disclosures` },
}));

/** `peerCount` above 12 adds numbered peers, so every long table runs onto a second page. */
export function fullPacketInput(over: Partial<CommitteePacketInput> = {}, peerCount = PEERS.length): CommitteePacketInput {
  const names = Array.from({ length: peerCount }, (_, i) => peerName(i));
  const scale = peerCount / PEERS.length;
  const income: PacketIncomeRow[] = [
    { institutionId: OWN, institutionName: OWN_NAME, reportDate: "2026-06-30", source: "fdic", serviceChargeIncomeThousands: 4200, totalAssetsThousands: 4_300_000, incomePer10kAssets: 9.77 },
    ...names.map((name, i) => ({
      institutionId: 1000 + i,
      institutionName: name,
      reportDate: "2026-06-30",
      source: i % 3 === 0 ? "ncua" : "fdic",
      serviceChargeIncomeThousands: 800 + i * 350,
      totalAssetsThousands: 1_200_000 + i * 600_000,
      incomePer10kAssets: Math.round(((800 + i * 350) / (1_200_000 + i * 600_000)) * 10000 * 100) / 100,
    })),
  ];
  return {
    institutionId: OWN,
    institutionName: OWN_NAME,
    generatedAt: "2026-10-17T12:00:00.000Z",
    peerSetLabel: "Florida community banks and credit unions, $1B to $10B",
    feeListSource: "published",
    fees: FEES.map((f) => ({
      feeCategory: f.category,
      current: f.current,
      peerLabel: "Florida community banks and credit unions, $1B to $10B",
      peers: names.slice(0, Math.round(f.publishers * scale)).map((_, i) => peerValue(i, Math.round((f.base + (i % 12) * f.step + Math.floor(i / 12) * 0.25) * 100) / 100)),
      ownRows: f.amounts.map((amount, j) => ({
        amount,
        sourceDocumentId: 32301 + j,
        documentUrl: `https://www.capitalcitybank.test/documents/consumer-fee-schedule-${j + 1}.pdf`,
        publishedAt: "2026-10-01T00:00:00.000Z",
        feeName: j === 0 ? `${WORDING[f.category] ?? "Service fee"} - Personal Checking` : `${WORDING[f.category] ?? "Service fee"} - Premier Checking, tier ${j}`,
        frequency: f.category === "monthly_maintenance" ? "monthly" : "per_item",
        conditions: f.category === "monthly_maintenance" ? "Waived with a $1,500 minimum daily balance or $500 in monthly direct deposits" : null,
      })),
    })),
    quarterly: { kind: "first", quarter: "2026-Q4" },
    changesSince: "2026-07-01",
    changes: [
      { institutionId: 1001, institutionName: PEERS[1], feeCategory: "overdraft", oldAmount: 25, newAmount: 26.5, changedAt: "2026-09-02T00:00:00.000Z", scheduleUrl: "https://www.example-bank-2.test/fees.pdf" },
      { institutionId: 1004, institutionName: PEERS[4], feeCategory: "nsf", oldAmount: 30, newAmount: 27, changedAt: "2026-08-14T00:00:00.000Z", scheduleUrl: null },
    ],
    financials: {
      source: "fdic",
      label: "Service charges on deposit accounts (FDIC call report)",
      quarters: Array.from({ length: 8 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 5 - i * 3 + 1, 0));
        return { quarterEnd: d.toISOString().slice(0, 10), amount: 4_200_000 - i * 60_000 };
      }),
      latestTtm: 16_440_000,
      priorTtm: 15_480_000,
      yoyPct: 6.2,
      quarterEnd: "2026-06-30",
      sourceRef: { label: "Service charges on deposit accounts (FDIC call report)", table: "institution_financial_records", asOf: "2026-06-30" },
      peerMedian: {
        label: "Banks, $1B to $10B in assets",
        quarters: Array.from({ length: 8 }, (_, i) => {
          const d = new Date(Date.UTC(2026, 5 - i * 3 + 1, 0));
          return { quarterEnd: d.toISOString().slice(0, 10), amount: 2_500_000 - i * 20_000, institutions: 412 - i };
        }),
        sourceRef: { label: "FDIC call report filers, Banks, $1B to $10B in assets, median quarterly service charges", table: "institution_financial_records", asOf: "2026-06-30" },
      },
    } as CommitteePacketInput["financials"],
    rules: RULES,
    income,
    ...over,
  };
}
