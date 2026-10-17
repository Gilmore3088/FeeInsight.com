# cfpb-card-agreements: registration snippets

## src/lib/agents/magellan/registry/index.ts

```ts
import { CFPB_CARD_AGREEMENTS_SOURCE, runRegistryCfpbCardAgreements } from "./cfpb-card-agreements";
```

REGISTRY_SOURCES entry:

```ts
  {
    source: CFPB_CARD_AGREEMENTS_SOURCE,
    stepKey: "registry-cfpb-card-agreements",
    title: "Pull CFPB card and prepaid agreements and the Terms of Credit Card Plans survey",
    run: async (input) => {
      const r = await runRegistryCfpbCardAgreements({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const pending = r.feePending > 0 ? `; ${n(r.feePending)} agreements wait for the next run` : "";
      return {
        summary: r.empty
          ? `No CFPB ${r.family} agreements for ${r.period}: ${r.emptyReason}.`
          : `Magellan loaded ${n(r.agreements)} CFPB ${r.family} agreements for ${r.period} from ${n(r.issuers)} issuers (${n(r.matchedIssuers)} matched, ${n(r.unmatchedIssuers)} unmatched): ${n(r.feeRead)} read, ${n(r.terms)} fee terms${pending}${dry(r.dryRun)}.`,
        detail: {
          family: r.family,
          period: r.period,
          source_url: r.sourceUrl,
          agreements: r.agreements,
          issuers: r.issuers,
          matched_issuers: r.matchedIssuers,
          unmatched_issuers: r.unmatchedIssuers,
          fee_read: r.feeRead,
          fee_no_text: r.feeNoText,
          fee_fetch_failed: r.feeFetchFailed,
          fee_kept: r.feeKept,
          fee_pending: r.feePending,
          terms: r.terms,
          written_rows: r.writtenRows,
          missing_headers: r.missingHeaders,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

## src/lib/agents/registry-scheduler.ts

```ts
import {
  CFPB_CARD_AGREEMENTS_PARSER_VERSION,
  CFPB_CARD_AGREEMENTS_SOURCE,
  cfpbCardAgreementsPartitions,
} from "@/lib/agents/magellan/registry/cfpb-card-agreements";
```

REGISTRY_PARSER_VERSIONS:

```ts
  [CFPB_CARD_AGREEMENTS_SOURCE]: CFPB_CARD_AGREEMENTS_PARSER_VERSION,
```

registryPartitionsBySource `dynamic`:

```ts
    [CFPB_CARD_AGREEMENTS_SOURCE]: cfpbCardAgreementsPartitions(now, from),
```

## src/app/admin/data-feeds-panel.tsx

```ts
  "cfpb-card-agreements": "CFPB card and prepaid agreements, TCCP survey",
```
scope map:
```ts
  "cfpb-card-agreements": "national",
```

## src/lib/agents/magellan/AGENTS.md versions table

```
| `CFPB_CARD_AGREEMENTS_PARSER_VERSION` | — | v1 | `magellan/registry/cfpb-card-agreements.ts` |
```

## Not confirmed (written from memory; the CFPB site is blocked from the sandbox)

1. URLs: card zip `files.consumerfinance.gov/a/assets/credit-card-agreements/archive-zips/Credit_Card_Agreements_YYYY_QN.zip`, prepaid `.../prepaid-agreements/prepaid_metadata_all_agreements.csv`, TCCP `.../tccp/TCCP_YYYY_MM.csv`. A wrong URL records an empty partition (HTTP 404), never a guess.
2. Card zip layout (issuer folder / product PDF); the run reports `layout_depths` and any `index_files` so a different layout shows in the partition detail.
3. Prepaid metadata column names (issuer_name, product_name, agreement_id, agreement_url/direct_download, effective_date, current_status, withdrawal_date) and TCCP column names (Institution Name, Product Name, Annual Fee, Late Fee, Foreign Transaction Fee(s), Cash Advance Fee, Balance Transfer Fee, Returned Payment Fee, Purchase APR Median); each run reports missing and unexpected headers, and a file without an issuer or product column loads nothing.
4. Publication lags (card archive ~90 days after quarter end, TCCP ~180 days after the survey month) and the first periods (card 2018Q1, TCCP 2021H1) are estimates; early runs of a not-yet-published period are recorded empty and retried in 3 days.
5. Fee-line labels are tuned to the Schumer box and the prepaid short-form disclosure; PDFs laid out differently (or scanned) give `no_text` or no terms, and no real CFPB PDF was available to test against. The cleaning pass lists ambiguous-term counts per fee so the hit rate is visible.

## Row estimates (estimates, not counts)

- card-YYYYQN: roughly 1,500 to 2,500 agreement rows from 400 to 600 issuers per quarter; terms up to 6 per read agreement. At 300 PDFs per run, a fresh quarter takes about 5 to 9 runs (hourly retries while any are pending).
- prepaid-YYYYQN: roughly 1,500 to 3,000 agreement rows (all agreements on file, current and withdrawn); up to 3 terms each; same per-run PDF limit.
- tccp-YYYYHN: roughly 600 to 1,000 plan rows from about 150 to 200 issuers; up to 7 terms each, no PDFs.
- Issuer matching: many card issuers are the bank itself and should match; prepaid issuers are mostly a handful of sponsor banks; program managers are not issuers and are not matched. No match rate has been measured.
