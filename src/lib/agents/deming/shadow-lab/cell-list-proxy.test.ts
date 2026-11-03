// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { assertOfflineEnv } from "./env-guard";

/**
 * A PROXY, not the replay (#1092, `HTML_CELL_LIST_PAIRING_LIVE`). St. Cloud FCU (answer key
 * state:9308) holds 22 of the lab's 44 R3 misses, but no copy of its page passes the same-document
 * test: the rates changed after the key was made. Its 2025-02-09 Internet Archive capture prints the
 * same rows, so it is committed as test-only bytes (`__fixtures__/proxy-bytes/`, outside the
 * source-bytes manifest and its denominator) and read here with the switch off and on.
 *
 * What it pins: every label-price pair the switch writes on the capture, each checked by hand
 * against the capture's markup (a pair with the wrong price fails the test), and which of the 22 R3
 * keys a published fee now carries in the key's category at the price the capture prints beside
 * the label. The capture is not the keyed document, so these are not recall figures.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === "function"
        ? () => {
            provider.calls += 1;
            throw new Error(`cell-list proxy: paid provider call refused (${name})`);
          }
        : value,
    ]),
  );
});

const OUT = process.env.SHADOW_LAB_OUT;
const PROXY_DIR = "src/lib/agents/deming/__fixtures__/proxy-bytes";
const MISSES = "docs/project/findings/data/2026-11-02-lab-misses-by-root-cause.json";
const CASE = "missed_fees:state:9308";
const TIMEOUT_MS = 120_000;

interface Proxy {
  caseKey: string;
  file: string;
  sourceUrl: string;
  captureUrl: string;
  sha256: string;
  contentType: string;
  sameDocument: boolean;
}

/** Every pair the switch writes on the capture, as the capture's markup prints it (checked by hand). */
const CAPTURE_PAIRS = [
  "Cashier’s Check For Paying Bills | $2.00",
  "Cashier’s Check Stop Payment | $10.00",
  "Checking Accounts Reward, Regular, Dividend, Prestige | $3.95 per month",
  "Checking Accounts Harvest Checking – if requirements are not met | $5.95 per month",
  "Debit Card Rush Order – Overnight FedEx | $50.00",
  "Debit Card Rush Order – 2 day FedEx Shipping | $35.00",
  "Foreign Check Exchange Cash Letter | $10.00",
  "Foreign Check Exchange Collection | $25.00",
  "International Draft US Currency | $25.00",
  "International Draft Foreign Currency | $25.00",
  "NSF Items (checks, debit card purchases, and automatic withdrawals) Return Item | $35.00",
  "NSF Items (checks, debit card purchases, and automatic withdrawals) Courtesy Pay Item | $35.00",
  "NSF Items (checks, debit card purchases, and automatic withdrawals) Deposit Item Return - Check drawn on the member’s account at another institution | $35.00",
  "NSF Items (checks, debit card purchases, and automatic withdrawals) Deposit Item Return - Previously paid mobile/remote deposit check | $35.00",
  "NSF Items (checks, debit card purchases, and automatic withdrawals) Deposit Item Return - Check from another party | $5.00",
  "Safe Deposit Boxes 3 x 5 | $18.00 a year",
  "Safe Deposit Boxes 3 x 10 | $30.00 a year",
  "Safe Deposit Boxes 5 x 10 | $40.00 a year",
  "Safe Deposit Boxes 10 x 10 | $80.00 a year",
  "Safe Deposit Boxes Lost Key | $25.00",
  "Safe Deposit Boxes Drilled Box | $250.00",
  "Wincentive Savings Account (S40) First Withdrawal | $10.00",
  "Wincentive Savings Account (S40) Second Withdrawal | $25.00",
  "Wire Transfer Outgoing Within USA | $20.00",
  "Wire Transfer Incoming | $10.00",
];

/**
 * The 22 R3 keys: the pair label the capture prints for each, or why the switch writes none.
 * `price` is the capture's price beside that label (the key's own price in parentheses in the report).
 */
const R3_KEYS: Record<string, { label: string; price: string } | { refused: string }> = {
  "atm_international:150": { refused: "3 label items over 2 prices (count mismatch)" },
  "cashiers_check:200": { label: "Cashier’s Check For Paying Bills", price: "$2.00" },
  "check_cashing:100": { refused: "nested <ul> under Non-Members, 2 items over 1 + a nested list" },
  "check_cashing:500": { refused: "nested <ul> under Non-Members, 2 items over 1 + a nested list" },
  "check_cashing:600": { refused: "nested <ul> under Non-Members, 2 items over 1 + a nested list" },
  "check_cashing:1100": { refused: "nested <ul> under Non-Members, 2 items over 1 + a nested list" },
  "collection_item:2500": { label: "Foreign Check Exchange Collection", price: "$25.00" },
  "deposited_item_return:3500": { label: "NSF Items (checks, debit card purchases, and automatic withdrawals) Deposit Item Return - Check drawn on the member’s account at another institution", price: "$35.00" },
  "deposited_item_return:500": { label: "NSF Items (checks, debit card purchases, and automatic withdrawals) Deposit Item Return - Check from another party", price: "$5.00" },
  "monthly_maintenance:395": { label: "Checking Accounts Reward, Regular, Dividend, Prestige", price: "$3.95 per month" },
  "monthly_maintenance:595": { label: "Checking Accounts Harvest Checking – if requirements are not met", price: "$5.95 per month" },
  "notary_fee:0": { refused: "<br> form, but the notary item states two prices (FREE for members, $5 for non-members)" },
  "nsf:3500": { label: "NSF Items (checks, debit card purchases, and automatic withdrawals) Return Item", price: "$35.00" },
  "overdraft:3500": { label: "NSF Items (checks, debit card purchases, and automatic withdrawals) Courtesy Pay Item", price: "$35.00" },
  "rush_card:3500": { label: "Debit Card Rush Order – 2 day FedEx Shipping", price: "$35.00" },
  "safe_deposit_box:2500": { label: "Safe Deposit Boxes Lost Key", price: "$25.00" },
  "safe_deposit_box:3000": { label: "Safe Deposit Boxes 3 x 10", price: "$30.00 a year" },
  "safe_deposit_box:4000": { label: "Safe Deposit Boxes 5 x 10", price: "$40.00 a year" },
  "safe_deposit_box:8000": { label: "Safe Deposit Boxes 10 x 10", price: "$80.00 a year" },
  "safe_deposit_box:25000": { label: "Safe Deposit Boxes Drilled Box", price: "$250.00" },
  "stop_payment:1000": { label: "Cashier’s Check Stop Payment", price: "$10.00" },
  "wire_intl_outgoing:5000": { refused: "the 2025-02-09 capture has no international wire row (today's live page does)" },
};

/** R3 keys a published fee carries with the switch on (category and the capture's price). */
const RECOVERED = [
  "cashiers_check:200", "collection_item:2500", "deposited_item_return:3500", "deposited_item_return:500",
  "monthly_maintenance:395", "nsf:3500", "overdraft:3500", "rush_card:3500", "safe_deposit_box:25000",
  "safe_deposit_box:2500", "safe_deposit_box:3000", "safe_deposit_box:4000", "safe_deposit_box:8000", "stop_payment:1000",
];

function loadProxy(): { proxy: Proxy; bytes: Uint8Array } {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), PROXY_DIR, "manifest.json"), "utf8")) as { proxies: Proxy[] };
  const proxy = manifest.proxies.find((item) => item.caseKey === CASE);
  if (!proxy) throw new Error(`no proxy bytes for ${CASE}`);
  const bytes = new Uint8Array(gunzipSync(readFileSync(join(process.cwd(), PROXY_DIR, proxy.file))));
  return { proxy, bytes };
}

describe("cell-list pairing proxy: St. Cloud's archived page (not the replay)", () => {
  it(
    "should_keep_the_capture_out_of_the_source_bytes_replay",
    async () => {
      const { readSourceManifest } = await import("./source-bytes");
      const { proxy, bytes } = loadProxy();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(proxy.sha256);
      expect(proxy.sameDocument).toBe(false);
      const manifest = readSourceManifest();
      expect(manifest.accepted.map((entry) => entry.caseKey)).not.toContain(CASE);
      expect(manifest.accepted.map((entry) => entry.sha256)).not.toContain(proxy.sha256);
      const rejected = manifest.rejected.find((entry) => entry.caseKey === CASE);
      expect(rejected?.archiveTried?.map((capture) => capture.sha256)).toContain(proxy.sha256);
    },
    TIMEOUT_MS,
  );

  it(
    "should_write_only_hand_checked_pairs_and_recover_the_pinned_r3_keys",
    async () => {
      assertOfflineEnv();
      const { extractHtmlDomText } = await import("@/lib/agents/rosetta/html-dom");
      const { decodeTextBytes } = await import("@/lib/agents/rosetta/glyph-repair");
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { currentVariant } = await import("./variants");
      const { readSourceBytes } = await import("./source-bytes");
      const { rereadCase } = await import("./source-replay");
      const { runCase } = await import("./run-case");
      const { matches } = await import("./metrics");

      const { proxy, bytes } = loadProxy();
      const html = decodeTextBytes(bytes, proxy.contentType);
      const textLines = (cellListPairing: boolean) =>
        extractHtmlDomText(html, { cellListPairing }).text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
      const off = textLines(false);
      const on = textLines(true);
      const offSet = new Set(off);
      const written = on.filter((line) => !offSet.has(line));
      // Every new line is a pair checked against the capture's markup, and no other.
      expect(written).toEqual(CAPTURE_PAIRS);
      // Only the nine joined rows' lines went; every other line of the page reads as before.
      const onSet = new Set(on);
      expect(off.filter((line) => !onSet.has(line))).toHaveLength(9);

      const frozen = JSON.parse(readFileSync(join(__dirname, "frozen-inputs.json"), "utf8")) as Record<string, string>;
      const c = applyManifest(loadScenarios(), frozen).find((item) => item.caseKey === CASE);
      if (!c) throw new Error(`${CASE} is not a lab case`);
      const misses = (JSON.parse(readFileSync(join(process.cwd(), MISSES), "utf8")) as Array<{ label: string; case: string; key: string; amt: number }>)
        .filter((miss) => miss.label === "R3" && `missed_fees:${miss.case}` === CASE)
        .map((miss) => `${miss.key}:${miss.amt}`);
      expect(misses.sort()).toEqual(Object.keys(R3_KEYS).sort());

      const trace = async (htmlCellListPairing: boolean) => {
        const read = await readSourceBytes(bytes, proxy.contentType, proxy.sourceUrl, { htmlCellListPairing });
        if (!read.ok) throw new Error(read.reason);
        return runCase(currentVariant, rereadCase(c, read.text));
      };
      const outside = (published: Awaited<ReturnType<typeof trace>>["published"]) =>
        published
          .filter((fee) => !c.expected.publish.some((ref) => matches(ref, fee)))
          .map((fee) => `${fee.canonicalFeeKey}:${fee.amountCents ?? "none"} "${fee.feeName ?? ""}"`);
      const before = await trace(false);
      const after = await trace(true);
      const carried = (published: typeof after.published, key: string) => {
        const ref = c.expected.publish.find((item) => `${item.canonicalFeeKey}:${item.amountCents}` === key);
        return ref ? published.find((fee) => matches(ref, fee)) : undefined;
      };

      const recovered = Object.keys(R3_KEYS).filter((key) => carried(after.published, key) && !carried(before.published, key));
      expect(recovered.sort()).toEqual([...RECOVERED].sort());
      for (const key of recovered) {
        const pair = R3_KEYS[key];
        // The fee that carries the key is named by the pair's own label, and that pair prints the key's price.
        expect("label" in pair, key).toBe(true);
        if (!("label" in pair)) continue;
        expect(carried(after.published, key)?.feeName, key).toContain(pair.label.slice(0, 60));
        expect(CAPTURE_PAIRS, key).toContain(`${pair.label} | ${pair.price}`);
      }
      // No R3 key is lost, and nothing new is published outside the key.
      for (const key of Object.keys(R3_KEYS)) if (carried(before.published, key)) expect(carried(after.published, key), key).toBeDefined();
      const outsideAfter = outside(after.published);
      const outsideBefore = new Set(outside(before.published));
      expect(outsideAfter.filter((fee) => !outsideBefore.has(fee))).toEqual([]);
      expect(provider.calls).toBe(0);

      if (OUT) {
        const found = (t: typeof after) => c.expected.publish.filter((ref) => t.published.some((fee) => matches(ref, fee))).length;
        const report = [
          "# HTML cell-list pairing: St. Cloud proxy (state:9308)",
          "",
          `A PROXY: ${proxy.captureUrl} fails the same-document test (the rates changed), so it is not in the source-bytes replay. ` +
            "Keys are matched by category and amount against the capture's text; the capture is not the keyed document.",
          "",
          "| Measure | Switch off | Switch on |",
          "|---|---|---|",
          `| Key fees published on the capture (of ${c.expected.publish.length}) | ${found(before)} | ${found(after)} |`,
          `| Of the 22 R3 keys | ${Object.keys(R3_KEYS).filter((key) => carried(before.published, key)).length} | ${Object.keys(R3_KEYS).filter((key) => carried(after.published, key)).length} |`,
          `| Published outside the key | ${outsideBefore.size} | ${outsideAfter.length} |`,
          "",
          `## Pairs written (${written.length}; each checked by hand against the capture's markup, 0 with the wrong price)`,
          ...written.map((line) => `- ${line}`),
          "",
          "## The 22 R3 keys",
          ...Object.entries(R3_KEYS).map(([key, pair]) => {
            const fee = carried(after.published, key);
            return "label" in pair
              ? `- ${key}: ${fee ? "published" : "not published"} as "${fee?.feeName ?? pair.label}"; the capture prints ${pair.price} (key ${key.split(":")[1]} cents)`
              : `- ${key}: refused, ${pair.refused}`;
          }),
          "",
          "## Published outside the key, switch on",
          ...outsideAfter.map((fee) => `- ${fee}`),
          "",
        ].join("\n");
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, "cell-list-proxy-state-9308.md"), report);
      }
    },
    TIMEOUT_MS,
  );
});
