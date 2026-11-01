# 2026-10-27: Darwin's category-model disputes measured; paid reads got no lessons

**What happened:** issue #2068 (pipeline learning audit, Oct 19) left two open lines.
- Knox's paid read sent fixed prompt text. It carried the newest ten role lessons for every step,
  but none of the free read's own (`appliesTo: ["extract"]`) and none of the category lessons the
  free read files by (`knox/lessons.ts`). A name Knox had learned to file right was read wrong again
  whenever the paid read found it.
- Darwin's learned category model (`darwin/category-model.ts`) recorded a dispute on every fee it
  doubted and acted on none. Nobody had measured whether a dispute meant anything.

**Measured on prod, Oct 27 (read-only).** All 308,108 `verify.category_model` attempts ran Oct 6 to
Oct 27. Darwin verified 143,607 of those fees, and the model disputed 3,919 of them (2.7%). Two
checks follow.
- *Later guard verdicts.* 94 of the 3,919 disputed fees (2.40%) were later rejected for their
  category, under the same key, by a guard (`pipeline_feedback.kind = 'wrong_category'` after the
  opinion). For the 139,688 undisputed fees the figure is 828 (0.59%). A dispute is four times as
  likely to mark a wrong category, but a hold would be right about one time in 40.
- *Hand-checked answer key.* 27 disputed fees match an answer-key line at the same bank and amount
  with a single key. Knox's category was right on 13 and the model's suggestion was right on 13;
  neither was right on 2. On 1,678 undisputed matches Knox was right on 1,599 (95.3%). The answer key
  is part of the model's training data, so even the 13-to-13 tie flatters the model.
- 1,185 of the disputed fees are still live under the disputed key. That count uses the opinions
  recorded when they were verified.

**Cause:** the paid prompt was written before lessons existed and only had the step-level reader
bolted on. The model's shadow mode was never followed by a measurement.

**Fix:**
- Knox paid extraction v3:
  - The fixed instructions and fee list move into a system block that the prompt cache marks, so
    every read in a run shares them.
  - A second block carries the role lessons of the paid and free extract steps that share at least
    3 topic words with the document (`lessonsForDocument`; at most 10 lessons and 6,000 characters;
    the paid step's own lessons always ride).
  - The same block carries the category lessons whose name or name family the document prints
    (`categoryLessonsForText`; this bank's, people's labels, then global ones; never another bank's;
    at most 20 lessons and 2,500 characters).
  - Each kept fee is then filed through the free read's lesson lookup (`knoxLessonFor`), with the
    same `knox_lesson:` flag.
  - The lessons sent are recorded in four places: the call's metadata, the attempt
    (`lessons_sent`, `lesson_refiles`), the step detail (`lessons_sent`) and one
    `knox.paid_lessons_sent` event.
- Darwin's decision: disputes stay recorded as a measured signal, not a hold, and the model never
  re-files a fee.
  - The signal is real: 4 times the base rate of later wrong-category rejection.
  - A hold would be right only 2.4% of the time, about one in 40, against the takedown spot-check
    bar of 9 in 10. Standing rules would also require any hold to ship with its live Darwin
    re-check.
  - The suggestion is no better than Knox's keyword category.
  - Revisit a hold only if the dispute's precision clears the takedown bar. Re-measure with the
    SQL below.
  - A per-step count of live disputes was tried and dropped. Scoring about 41,000 live
    name/category pairs (85,309 live fees, 53 categories) took about 2.7 s of blocking CPU on a
    synthetic set of that size. That is too much for the verify step, whose p99 is about 28 s.

**SQL (read-only):**
```sql
-- dispute vs later category rejection, verified fees
WITH op AS MATERIALIZED (
  SELECT DISTINCT ON ((detail->>'fee_raw_id')::bigint) (detail->>'fee_raw_id')::bigint AS fee_raw_id,
         detail->>'canonical_fee_key' AS key, (detail->>'disputed')::boolean AS disputed, created_at
    FROM pipeline_attempts
   WHERE strategy = 'verify.category_model' AND detail->>'decision' = 'verified'
   ORDER BY (detail->>'fee_raw_id')::bigint, created_at DESC
), wc AS MATERIALIZED (
  SELECT fee_raw_id, canonical_fee_key, min(created_at) AS at FROM pipeline_feedback
   WHERE kind = 'wrong_category' AND fee_raw_id IS NOT NULL GROUP BY 1, 2
), live AS MATERIALIZED (SELECT DISTINCT fee_raw_id, canonical_fee_key FROM published_fee_catalog)
SELECT op.disputed, count(*) AS fees,
       count(*) FILTER (WHERE wc.at > op.created_at) AS cat_wrong_later,
       count(*) FILTER (WHERE live.fee_raw_id IS NOT NULL) AS live_same_key
  FROM op
  LEFT JOIN wc ON wc.fee_raw_id = op.fee_raw_id AND wc.canonical_fee_key = op.key
  LEFT JOIN live ON live.fee_raw_id = op.fee_raw_id AND live.canonical_fee_key = op.key
 GROUP BY 1;
-- false: 139,688 / 828 / 57,242   true: 3,919 / 94 / 1,185

-- against the answer key (same bank, same amount, the fee's name inside the key's line)
WITH op AS MATERIALIZED (
  SELECT (detail->>'fee_raw_id')::bigint AS fee_raw_id, detail->>'canonical_fee_key' AS key,
         detail->>'suggested_key' AS suggested, (detail->>'disputed')::boolean AS disputed,
         (detail->>'amount')::numeric AS amount, detail->>'fee_name' AS fee_name, institution_id
    FROM pipeline_attempts WHERE strategy = 'verify.category_model' AND detail->>'decision' = 'verified'
), ak AS MATERIALIZED (
  SELECT institution_id, amount, lower(evidence->>'source_line') AS line, canonical_fee_key
    FROM pipeline_feedback WHERE kind = 'answer_key' AND signal = 'right'
), m AS (
  SELECT op.fee_raw_id, op.disputed, op.key, op.suggested, array_agg(DISTINCT ak.canonical_fee_key) AS keys
    FROM op JOIN ak ON ak.institution_id = op.institution_id AND ak.amount = op.amount
     AND length(op.fee_name) >= 4 AND position(lower(op.fee_name) IN ak.line) > 0
   GROUP BY 1, 2, 3, 4)
SELECT disputed, count(*) FILTER (WHERE cardinality(keys) = 1) AS unique_key,
       count(*) FILTER (WHERE cardinality(keys) = 1 AND keys[1] = key) AS knox_right,
       count(*) FILTER (WHERE cardinality(keys) = 1 AND keys[1] = suggested) AS model_right
  FROM m GROUP BY 1;
-- false: 1,678 / 1,599 / 1,592   true: 27 / 13 / 13
```

**Agent lesson:** knox/issue-2068-paid-reads-carry-the-free-reads-lessons,
darwin/issue-2068-measure-a-shadow-check-before-it-acts

**Guard:** `src/lib/agents/knox/paid-extract.test.ts`, `src/lib/agents/learning/lesson-reader.test.ts`
