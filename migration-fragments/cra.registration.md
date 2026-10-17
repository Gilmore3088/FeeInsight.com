# CRA loader: registration snippets

## src/lib/agents/magellan/registry/index.ts

Import:

```ts
import { CRA_SOURCE, runRegistryCra } from "./cra";
```

REGISTRY_SOURCES entry:

```ts
  {
    source: CRA_SOURCE,
    stepKey: "registry-cra",
    title: "Pull FFIEC CRA ratings and small business / small farm lending by county",
    run: async (input) => {
      const r = await runRegistryCra({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const what = r.kind === "ratings" ? "CRA exam ratings" : `CRA small business and farm lending rows for ${r.partitionKey}`;
      const gaps = r.missingFields.length > 0 ? `; fields not found: ${r.missingFields.join(", ")}` : "";
      return {
        summary: r.empty
          ? `No CRA data loaded for ${r.partitionKey}: ${r.emptyReason}${dry(r.dryRun)}.`
          : `Magellan read ${n(r.rows)} ${what}: ${n(r.writtenRows)} written, ${n(r.matchedRows)} linked to an institution we track, ${n(r.unmatchedRows)} kept unlinked${r.badLines > 0 ? `; ${n(r.badLines)} lines failed the layout check` : ""}${gaps}${dry(r.dryRun)}.`,
        detail: {
          kind: r.kind,
          source_url: r.sourceUrl,
          rows: r.rows,
          written_rows: r.writtenRows,
          matched_rows: r.matchedRows,
          unmatched_rows: r.unmatchedRows,
          respondents: r.respondents,
          missing_fields: r.missingFields,
          unexpected_fields: r.unexpectedFields,
          bad_lines: r.badLines,
          ratings_cleaning: r.ratingsCleaning,
          lending_cleaning: r.lendingCleaning,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

## src/lib/agents/registry-scheduler.ts

Import:

```ts
import { craPartitions, CRA_PARSER_VERSION, CRA_SOURCE } from "@/lib/agents/magellan/registry/cra";
import { CRA_LENDING_FIRST_YEAR } from "@/lib/regulatory/cra";
```

REGISTRY_PARSER_VERSIONS:

```ts
  [CRA_SOURCE]: CRA_PARSER_VERSION,
```

`dynamic` in registryPartitionsBySource ('ratings-current' first, then lending years newest first):

```ts
    [CRA_SOURCE]: craPartitions(now, Math.max(CRA_LENDING_FIRST_YEAR, from.year)),
```

## src/app/admin/data-feeds-panel.tsx

Label: `cra: "FFIEC CRA ratings and small business lending",`
Group: `cra: "national",`

## src/lib/agents/magellan/AGENTS.md "Current versions" table (guide-version-kill asks for it)

```
| `CRA_PARSER_VERSION` | — | v1 | `magellan/registry/cra.ts` |
```

## Could not confirm (FFIEC site blocked from the sandbox; all from memory)

1. URLs: ratings `https://www.ffiec.gov/craratings/CRA_Ratings.zip` (may be a different name, or not a zip); lending `https://www.ffiec.gov/cra/xls/{yy}exp_discl.zip` and `{yy}exp_trans.zip`. A 404 on the disclosure zip records the year as unpublished; a wrong ratings URL fails the step visibly.
2. Ratings layout: assumed delimited with a header row; headers matched by alias lists (ID_RSSD, Exam Date, Rating, Regulator, Exam Method, PE URL...). Unknown whether the file carries RSSD, FDIC cert or only the agency's own id, or a public-evaluation URL. The partition detail lists headers, the field each mapped to, missing fields and unexpected headers.
3. Lending fixed-width positions (D1-1/D2-1 and transmittal, 2016+ spec) and codes (loan type 4/5, action 1/6, agency 1-4). Every line is checked (table id, year, agency, digit-only fields, bucket ceilings); more than 2% bad lines writes nothing.
4. Report level '040' as the county-total row: the cleaning pass sums income-group rows against it and reports mismatches; the county aggregates rely on it.
5. The aggregate (A-table) file is not loaded: it is tract level, and county totals across all reporters are the sum of disclosure rows. Matching is RSSD only for lending (transmittal), RSSD then FDIC cert for ratings; agency ids are stored but not used to match.

## Row-count estimate per partition (estimate, not measured)

- `ratings-current`: roughly 70,000-100,000 exam rows (all CRA exams since 1990).
- Each lending year: roughly 500-800 reporters; D1-1/D2-1/D1-2/D2-2 rows roughly 0.5-1.5 million per year (each reporter x county x income group + total rows), plus ~700 respondent rows.
