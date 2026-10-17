# designation-lists: registration snippets

Branch `worker/designation-lists`. Table SQL: `migration-fragments/designation-lists.sql`.

## 1. REGISTRY_SOURCES entry (`src/lib/agents/magellan/registry/index.ts`)

```ts
import { DESIGNATION_LISTS_SOURCE, runRegistryDesignationLists } from "./designation-lists";
```

```ts
  {
    source: DESIGNATION_LISTS_SOURCE,
    stepKey: "registry-designation-lists",
    title: "Pull designation lists (FDIC MDI and charter flags, NCUA low-income and FOM, NCUA MDI, CDFI Fund, Bank On)",
    run: async (input) => {
      const r = await runRegistryDesignationLists({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.fieldsMissing.length > 0 ? `; fields not found: ${r.fieldsMissing.join(", ")}` : "";
      return {
        summary: r.empty
          ? `No designations from ${r.partitionKey}: ${r.emptyReason}.`
          : `Magellan read ${n(r.records)} designations from ${r.partitionKey}: ${n(r.matched)} matched, ${n(r.unmatched)} unmatched, ${n(r.writtenRows)} written, ${n(r.removedRows)} removed${gaps}${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          as_of: r.asOf,
          rows_read: r.rowsRead,
          records: r.records,
          matched: r.matched,
          unmatched: r.unmatched,
          written_rows: r.writtenRows,
          removed_rows: r.removedRows,
          fields_missing: r.fieldsMissing,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

## 2. Scheduler (`src/lib/agents/registry-scheduler.ts`)

```ts
import {
  DESIGNATION_LISTS_PARSER_VERSION,
  DESIGNATION_LISTS_SOURCE,
  designationListsPartitions,
} from "@/lib/agents/magellan/registry/designation-lists";
```

In `REGISTRY_PARSER_VERSIONS`:

```ts
  [DESIGNATION_LISTS_SOURCE]: DESIGNATION_LISTS_PARSER_VERSION,
```

In `registryPartitionsBySource` → `dynamic`:

```ts
    [DESIGNATION_LISTS_SOURCE]: designationListsPartitions(now),
```

Partitions (fixed list keys, not dates): `fdic-institution-flags`, `ncua-foicu-flags`, `ncua-mdi`,
`cdfi-fund`, `bank-on`. Refresh: FDIC and FOICU weekly, the three published lists every 30 days,
empty partitions retried after 24 h.

## 3. Data-feeds panel (`src/app/admin/data-feeds-panel.tsx`)

Label map: `"designation-lists": "Designation lists (MDI, low-income, CDFI, Bank On)",`
Group map: `"designation-lists": "national",`

## 4. AGENTS.md versions row (`src/lib/agents/magellan/AGENTS.md`)

```
| `DESIGNATION_LISTS_PARSER_VERSION` | — | v1 | `magellan/registry/designation-lists.ts` |
```

## 5. Peer dimension patch (PR #1768 files; not edited here)

`src/lib/peer-set-dimensions.ts`, add to the file and to `PEER_GROUP_PARAMS`:

```ts
/** Designations from institution_designations that can define a peer group (all flags; "same" takes the institution's own). */
export const PEER_DESIGNATIONS = {
  mdi: { designation: "minority_depository", label: "minority depository institutions" },
  low_income: { designation: "low_income", label: "low-income designated credit unions" },
  cdfi: { designation: "cdfi", label: "certified CDFIs" },
  bank_on: { designation: "bank_on_certified", label: "Bank On certified" },
  subchapter_s: { designation: "subchapter_s", label: "Subchapter S banks" },
  mutual: { designation: "ownership_form", value: "mutual", label: "mutual institutions" },
} as const;
export type PeerDesignation = keyof typeof PEER_DESIGNATIONS;
```

```ts
  { name: "designation", example: "mdi,cdfi", description: "mdi, low_income, cdfi, bank_on, subchapter_s or mutual, comma-separated (all must hold), or same" },
  { name: "specialty_group", example: "Commercial Lending Specialization", description: "Banks only: FDIC specialty group name, or same" },
```

`src/lib/data-store/peer-sets.ts`:

```ts
import { PEER_DESIGNATIONS, type PeerDesignation } from "@/lib/peer-set-dimensions";

// PeerSetDefinition
  designations?: PeerDesignation[];
  specialty_group?: string;
// PeerSetRequest
  designations?: PeerDesignation[] | "same";
  specialty_group?: string | "same";
// PeerSubject (loaded with the subject: SELECT array of matched designations for s.id)
  designations?: PeerDesignation[] | null;
  specialty_group?: string | null;

// ADVANCED_KEYS: add "designations", "specialty_group"

// definitionFor
  if (request.designations) {
    def.designations = request.designations === "same"
      ? (subject.designations?.length ? subject.designations : missing("designation"))
      : request.designations;
  }
  if (request.specialty_group) {
    def.specialty_group = request.specialty_group === "same" ? subject.specialty_group ?? missing("FDIC specialty group") : request.specialty_group;
  }

// describePeerSet
  if (def.designations?.length) parts.push(`that are ${def.designations.map((d) => PEER_DESIGNATIONS[d].label).join(" and ")}`);
  if (def.specialty_group) parts.push(`in the FDIC ${def.specialty_group} specialty group`);

// resolvePeerInstitutionIds, after the holding_company line
  for (const key of def.designations ?? []) {
    const d = PEER_DESIGNATIONS[key];
    const value = "value" in d ? d.value : null;
    add(
      (p) => `EXISTS (SELECT 1 FROM institution_designations dz WHERE dz.institution_id = s.id AND dz.designation = ${p}[1] AND (${p}[2] IS NULL OR dz.value = ${p}[2]))`,
      [d.designation, value],
    );
  }
  if (def.specialty_group) {
    add((p) => `EXISTS (SELECT 1 FROM institution_designations dz WHERE dz.institution_id = s.id AND dz.designation = 'fdic_specialty_group' AND dz.value = ${p})`, def.specialty_group);
  }
```

Subject lookup for "same": `SELECT designation, value FROM institution_designations WHERE institution_id = $1`
mapped back through `PEER_DESIGNATIONS`.

## 6. Shared FDIC / FOICU fields: whether to move them

The FDIC specialty group, MUTUAL and SUBCHAPS fields and FOICU's LIMITED_INC, TOM_CODE and
YEAR_OPENED are read here by this step's own requests: it calls BankFind `institutions` with
ACTIVE:1 and re-downloads the newest 5300 zip once a week. Recommendation: keep them here for now.
Moving them into `FDIC_INSTITUTION_FIELDS` / `parseNcuaInstitution` (shared, owned by Data
quality) would save one BankFind call and one zip download a week. It would also make
`fdic-universe` depend on field names nobody has checked yet: if BankFind rejects an unknown
field in `fields=`, the whole universe sync fails. This step retries without `fields` on an
HTTP 400 and reports the missing names. Once one live run confirms the names (partition detail
`fields_found`), Data quality can move them into the shared loaders and point this step at
`institution_sources`.

Existing columns checked: `institution_sources.specialty` exists, but no code under `src/` writes
it. It is empty, so the specialty group is held in `institution_designations`
(`fdic_specialty_group`). If Data quality moves SPECGRPN into `fdic-universe`, that column is
the natural home. `institution_sources.established_date` is filled for banks only, by
`fdic-universe` from ESTYMD (COALESCE, so it never overwrites). Nothing fills it for credit
unions, so `year_chartered` from FOICU YEAR_OPENED is the only charter year for credit unions.
It is a year, not a date, so it is not written into `established_date`.

## 7. Not confirmed (regulator sites blocked from the sandbox; all from memory)

1. BankFind field names MDI_STATUS_CODE, MDI_STATUS_DESC, SPECGRP, SPECGRPN, MUTUAL and SUBCHAPS, and their codes (MUTUAL 1 = mutual; MDI code "0" or blank means not an MDI). A missing field is reported in `fields_missing` and produces no rows.
2. FOICU column names LIMITED_INC, TOM_CODE and YEAR_OPENED (aliases tried: LOW_INCOME/LID, FOM_CODE/FOM_TYPE, YEAR_CHARTERED). TOM_CODE is stored as filed, with no label for its codes. FOICU may also carry an MDI column; MINORITY_FLAG/MDI/MDI_FLAG are tried.
3. Page URLs and link patterns: the NCUA MDI page (`ncua.gov/.../minority-depository-institution-preservation`), the CDFI Fund certification page and `joinbankon.org/accounts/`. Each file's column headers are matched by alias, and the header row is found at run time.
4. Whether Bank On's page links a file or renders a table (or loads its list by JavaScript, which this reader cannot see; that would show as an empty partition). A nationwide account has no state and stays unmatched (`no_state`), because matching is exact name + state only.
5. The CDFI list's "Organization Type" wording, which decides which rows are depository institutions. Holding-company CDFIs are kept unmatched (`holding_company`) and are not pushed down to their banks.

## 8. Row-count estimate per partition (ESTIMATE, not measured)

- fdic-institution-flags: about 4,400 active banks. That gives about 4,400 specialty rows, about 4,400 ownership rows, about 1,800 Subchapter S rows and about 150 MDI rows. Total about 10,000–11,000.
- ncua-foicu-flags: about 4,500 credit unions. That gives about 4,500 FOM rows, about 4,500 year rows and about 2,700 low-income rows. Total about 11,000–12,000.
- ncua-mdi: about 500 rows.
- cdfi-fund: about 1,400 certified CDFIs in total, about 500–600 of them depository types once loan and venture funds are skipped.
- bank-on: about 300–500 account rows, which come to fewer institution rows after duplicates are merged.
