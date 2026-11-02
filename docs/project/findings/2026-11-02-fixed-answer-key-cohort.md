# 2026-11-02: The answer-key score had no fixed cohort, so its daily moves proved nothing

**What happened (#2533):** The daily answer-key score (`score-answer-key`, "Internal precision v3" and
"Source-first recall v3") scores only the answer keys whose reference passed that day's live
re-check of the bank's site (`answer-key-eligibility.ts`, #1862). That check depends on the site on
the day, so the cohort moves. On Nov 1 it scored 1 of the 62 confirmed institutions (37 of 2,276
key fees). On Nov 2 it scored 8 of 62 (213 fees): precision 89.78%, recall 62.44% (scorer v3, score
run 97, agent run 18508). A day-over-day move can come from the cohort changing as easily as
from the pipeline, so neither number shows whether a pipeline change made the data better.
(Read-only queries of `answer_key_score_runs` on project rmhwbbjjctzfaqjyhomu, 2026-11-02.)

**Why 54 of 62 were excluded on Nov 2** (`by_stage._reference.byReason` of score run 97; one
reason per key, 2,063 key fees in all):

| Reason | Keys |
| --- | --- |
| `key_line_not_in_reference` (a key line is not in today's page text) | 17 |
| `consumer_scope_unproven` | 11 |
| `reference_source_superseded` (a newer stored copy replaced the key's bytes) | 11 |
| `business_document` | 5 |
| `official_current_link_unproven` | 5 |
| `priced_schedule_unproven` | 1 |
| `key_line_audience_ambiguous` | 1 |
| `official_discovery_incomplete` | 1 |
| `candidate_classification_unknown` | 1 |
| `key_line_consumer_scope_unproven` | 1 |

None of these is about the pipeline's output. They ask whether the key is still the bank's current
consumer schedule. That is a fair question about the key, but it is no reason to change who is
scored from one day to the next.

**Fix:** Deming scores a fixed cohort every day in the same step
(`src/lib/agents/deming/fixed-cohort.ts`, run from `score-answer-key` in `run-store.ts`):

- **Cohort:** all 62 confirmed answer keys as they stood on Nov 2 (2,276 mapped, confirmed key
  fees), frozen in code by answer-key id, institution id, fee count and a fingerprint of each key's
  scored content (document hash, then each fee's id, category, cents and amount kind). The keys
  were last confirmed on Oct 19. Every one of the 62 key documents is a document we hold: on Nov 2
  each key's `content_hash` matched a non-failed `source_documents` row for its institution. So
  "all 62" and "every key whose document we hold" are the same list, and nothing is left out.
  The list changes only when James says so, and then as a new `FIXED_COHORT_ID`.
- **Scoring (protocol 1):** the expected fees are each key fee as confirmed. The predictions are the
  institution's distinct (category, amount) rows in `published_fee_catalog` and (category, rate)
  rows in `published_fee_rate_catalog`, from whatever document they were read. That is what a
  reader sees for the bank. A fee matches by answer-key scorer v3's rule (`predictionMatches`: same
  category, amount within one cent, "free" is $0, "varies" takes any amount, a rate matches only a
  "varies" fee). Precision is right predictions over predictions; recall is key fees found live
  over key fees.
- **Never dropped:** an institution with no live fees is scored, so its key fees count as missed.
  An institution whose key was edited (`key_changed`) or removed (`key_missing`), or whose read
  failed (`read_failed`), is counted as unscored with its reason. Confirmed keys added after
  Nov 2 are counted (`notInCohort`), not scored.
- **Stored:** one `deming.fixed_cohort_accuracy` event on the step (the full per-institution
  score), the step's `fixed_cohort` detail, and the goal scorecard (`goal.fixedCohort`). Through the
  scorecard it reaches each daily `pipeline_scoreboard_snapshots` row, so it outlives event
  retention, and the morning brief shows the move since the day before. The accuracy history reads
  it back as `fixedCohort`. No migration.

**Baseline (Nov 2, read-only, before the code first runs):** all 62 scored, none unscored, none
without live fees.

| | Count | Rate |
| --- | --- | --- |
| Precision | 1,364 of 1,564 live predictions match the key | **87.21%** |
| Recall | 1,518 of 2,276 key fees are live | **66.70%** |
| Dollar fees only | precision 87.12%, recall 64.98% | |
| The 8 keys eligible on Nov 2 | 125 of 140 right (89.29%), 135 of 213 found (63.38%) | |
| The 54 excluded keys | 1,239 of 1,424 right (87.01%), 1,383 of 2,063 found (67.04%) | |

Check: the same SQL restricted to the 8 eligible institutions and to dollar fees gives 89.21%
precision and 62.91% recall, the stored scorer v1 numbers of score run 95 (v1 compares every live
row at the bank, dollars only). So the SQL reproduces the scorer's own matching.

```sql
WITH ak AS (SELECT id, institution_id FROM answer_key_institutions WHERE status = 'confirmed'),
kf AS (SELECT f.id, ak.institution_id, f.canonical_key, f.amount::numeric AS amount, f.amount_kind
         FROM answer_key_fees f JOIN ak ON ak.id = f.answer_key_institution_id
        WHERE f.status = 'confirmed' AND f.canonical_key <> 'unmapped'),
preds AS (
  SELECT DISTINCT institution_id, canonical_fee_key AS ck, round(amount::numeric, 2) AS amt, NULL::numeric AS rate
    FROM published_fee_catalog
   WHERE institution_id IN (SELECT institution_id FROM ak) AND canonical_fee_key IS NOT NULL AND canonical_fee_key <> ''
  UNION
  SELECT DISTINCT institution_id, canonical_fee_key, NULL::numeric, round(rate_percent::numeric, 4)
    FROM published_fee_rate_catalog
   WHERE rate_percent IS NOT NULL AND institution_id IN (SELECT institution_id FROM ak)
     AND canonical_fee_key IS NOT NULL AND canonical_fee_key <> ''),
m AS (SELECT e.id AS eid, p.* FROM kf e JOIN preds p ON p.institution_id = e.institution_id AND p.ck = e.canonical_key
       AND (CASE WHEN p.rate IS NOT NULL THEN e.amount_kind = 'varies'
                 ELSE e.amount_kind = 'varies' OR COALESCE(abs(p.amt - CASE WHEN e.amount_kind = 'free' THEN 0 ELSE e.amount END) <= 0.010000001, false) END))
SELECT (SELECT count(*) FROM kf) AS expected,
       (SELECT count(DISTINCT eid) FROM m) AS matched,
       (SELECT count(*) FROM preds) AS predicted,
       (SELECT count(*) FROM preds p WHERE EXISTS (SELECT 1 FROM m WHERE m.institution_id = p.institution_id AND m.ck = p.ck
          AND m.amt IS NOT DISTINCT FROM p.amt AND m.rate IS NOT DISTINCT FROM p.rate)) AS correct;
```

The frozen fingerprints came from this read-only SQL, and `fixed-cohort.test.ts` checks that the
code computes the same value for key 108:

```sql
SELECT ak.id, ak.institution_id, x.n, x.fp FROM answer_key_institutions ak
CROSS JOIN LATERAL (SELECT count(*) AS n, encode(sha256(convert_to(concat_ws(E'\n',
    'fixed-answer-key-cohort@1|' || ak.id || '|' || ak.institution_id || '|' || coalesce(ak.content_hash, ''),
    string_agg(f.id || '|' || f.canonical_key || '|' || coalesce(round(f.amount * 100)::bigint::text, '') || '|' || f.amount_kind, E'\n' ORDER BY f.id)), 'UTF8')), 'hex') AS fp
  FROM answer_key_fees f WHERE f.answer_key_institution_id = ak.id AND f.status = 'confirmed' AND f.canonical_key <> 'unmapped') x
WHERE ak.status = 'confirmed' ORDER BY ak.id;
```

**Limits:** the key is the bank's schedule as confirmed in October. Where a bank has since
changed a fee, a pipeline that follows the bank scores lower on this cohort. That lowers the
absolute number, but the error is the same every day, so the day-over-day move is still the
pipeline's. The eligibility exclusions above stay the list of keys to send back through the
re-key path; a re-keyed key is a new cohort James names. Precision counts every live fee at the
institution, so a correct fee from a second bank document the key does not cover counts as not in
the key. James's weekly live review of 50 institutions is still the launch accuracy measure.

**Lesson:** a measure meant to show movement needs a frozen population and a frozen rule, and
every unit it cannot score that day is shown as unscored, never dropped. Agent lesson:
deming/fixed-cohort-before-movement.
