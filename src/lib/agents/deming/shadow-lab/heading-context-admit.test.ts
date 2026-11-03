// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertOfflineEnv } from "./env-guard";

/**
 * Knox v177's heading-category rows are admit-only (#1092, `knox/heading-category-rows.ts`): on every
 * text the lab holds, the free read with the heading-context trailer keeps every read main makes of the
 * same text without it, in the same order, holds nothing main does not hold, and adds only the rows
 * pinned here. The frozen texts carry no trailer, so Knox reads them exactly as main; the source replay's
 * HTML re-reads, with `HTML_HEADING_CONTEXT_LIVE` held on (and row pairing off, then on), carry one.
 */

const MANIFEST_PATH = join(__dirname, "frozen-inputs.json");
const TIMEOUT_MS = 600_000;

/** Every read the trailer adds on the 20 reproduced HTML documents, each checked by hand against the page. */
const PINNED_ADDS = [
  // "Night Depository" (h2) over "Bag Replacement: $25.00 each" (Sterling Federal Bank); answer key night_deposit $25.
  "missed_fees:state:10500 night_deposit 25 Night Depository - Bag Replacement",
  // "ATM Service" (h2 in a one-cell table row) over "All Other Transactions | $3.00" (Lenco FCU); key atm_non_network $3.
  "missed_fees:state:12821 atm_non_network 3 ATM Service - All Other Transactions",
];

type Read = { candidates: unknown[]; held: unknown[]; rates: unknown[] };

function expectAdmitOnly(base: Read, on: Read): void {
  expect(on.candidates.slice(0, base.candidates.length)).toEqual(base.candidates);
  for (const held of on.held) expect(base.held).toContainEqual(held);
  expect(on.rates).toEqual(base.rates);
}

describe("heading-category rows are admit-only", () => {
  it(
    "should_read_every_frozen_text_exactly_as_main",
    async () => {
      assertOfflineEnv();
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { runFreeSpecialists } = await import("@/lib/agents/knox/specialists");
      const { HEADING_CONTEXT_PREFIX, withoutHeadingContext } = await import("@/lib/heading-context-trailer");
      const frozen = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
      const texts = applyManifest(loadScenarios(), frozen).flatMap((c) => (c.document.text == null ? [] : [c.document.text]));
      expect(texts.length).toBeGreaterThan(100);
      for (const text of texts) {
        expect(text.includes(HEADING_CONTEXT_PREFIX)).toBe(false);
        expect(withoutHeadingContext(text)).toBe(text);
      }
      // No trailer: `runFreeSpecialists` is main's read by construction; checked read by read on every text.
      for (const text of texts) expect(runFreeSpecialists(text)).toEqual(runFreeSpecialists(withoutHeadingContext(text)));
    },
    TIMEOUT_MS,
  );

  it(
    "should_store_no_trailer_on_any_reread_while_the_switch_is_off",
    async () => {
      assertOfflineEnv();
      const { rereadAcceptedSources } = await import("./source-bytes");
      const { HEADING_CONTEXT_PREFIX } = await import("@/lib/heading-context-trailer");
      const today = await rereadAcceptedSources();
      const off = await rereadAcceptedSources(process.cwd(), { htmlHeadingContext: false });
      expect(today.size).toBe(38);
      for (const [key, read] of today) {
        expect(read).toEqual(off.get(key));
        if (read.ok) expect(read.text.includes(HEADING_CONTEXT_PREFIX)).toBe(false);
      }
    },
    TIMEOUT_MS,
  );

  for (const htmlRowPairing of [false, true]) {
    it(
      `should_keep_every_read_of_main_on_the_html_rereads_${htmlRowPairing ? "with" : "without"}_row_pairing`,
      async () => {
        assertOfflineEnv();
        const { readSourceManifest, loadSourceBytes, readSourceBytes } = await import("./source-bytes");
        const { runFreeSpecialists } = await import("@/lib/agents/knox/specialists");
        const { splitHeadingContext, withoutHeadingContext } = await import("@/lib/heading-context-trailer");
        const adds: string[] = [];
        let withTrailer = 0;
        for (const entry of readSourceManifest().accepted) {
          if (entry.reader !== "read.html_dom") continue;
          const read = await readSourceBytes(loadSourceBytes(entry), entry.contentType, entry.finalUrl, { htmlRowPairing, htmlHeadingContext: true });
          if (!read.ok) throw new Error(`${entry.caseKey}: ${read.reason}`);
          if (splitHeadingContext(read.text).lines) withTrailer += 1;
          const base = runFreeSpecialists(withoutHeadingContext(read.text));
          const on = runFreeSpecialists(read.text);
          expectAdmitOnly(base, on);
          for (const c of on.candidates.slice(base.candidates.length)) adds.push(`${entry.caseKey} ${c.canonicalHint} ${c.amount} ${c.feeName}`);
        }
        expect(withTrailer).toBeGreaterThan(10);
        expect(adds.sort()).toEqual(PINNED_ADDS);
      },
      TIMEOUT_MS,
    );
  }
});
