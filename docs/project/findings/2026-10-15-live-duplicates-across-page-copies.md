# 2026-10-15: live duplicates across page copies

**What happened:** At 2026-10-15 01:23:45 UTC (query 1 below, read-only), `published_fee_catalog` held
3,153 dollar rows that repeat another live row with the same institution, category, audience and amount.
They fall in 2,964 groups. The 6 pairs that #1329 handles were left out of the count. Each extra row was
classed against the other rows in its group:

| Class | Rows | Hand sample (stored text) |
|---|---|---|
| A. Same document, same name after punctuation, plural and "fee" are set aside | 90 | 10: 9 duplicate, 1 unclear |
| B. Same document, one name is the other plus one qualifier word | 24 | 7: 5 duplicate, 2 separate lines |
| C. Same document, different name | 1,326 | 14: 1 duplicate, 13 separate lines |
| D1. Two stored captures of one page, same or near name | 122 | 3: 2 duplicate, 1 unclear |
| D2. Two different documents, same or near name | 98 | 3: 2 same fee in two documents, 1 separate (personal and business schedules) |
| E1. Two captures of one page, different name | 676 | 5: 2 duplicate, 3 separate lines |
| E2. Two different documents, different name | 817 | 3: 3 same fee in two documents |

The sample covers 45 pairs. 19 are the same printed line published twice, 19 are separate printed
lines, 5 are the same fee printed in two different documents of the bank (a fee schedule and an EFT
disclosure, a PDF and a web page), and 2 are unclear. The classes come from SQL on names, documents and
URLs. Without a database connection in the session, `nearNames` and `linesApartOnPage` were not run
on the whole set, so the class sizes are not the number of rows the code would close.

All 122 rows in D1 have a partner whose document has `superseded_by_id` or `duplicate_of_id` set
(query 2, 01:24:04 UTC). These are rows from an older capture of a page that stayed live beside the
current capture's row for the same line, because the two readings name it slightly differently.
Examples are 117355 and 83484 (Dutch Point, "Overdraft Transfer Fee from Primary Share - each transfer"
with and without the dash) and 120373 and 101625 (FedChoice, "+" footnote mark).

Across the catalog at 01:23:54 UTC (query 3), 4,056 live rows at 1,229 institutions come from superseded
documents and 863 at 45 institutions from documents marked as duplicates. Those totals include fees
that only the old copy states. An earlier read the same night, with no recorded time, gave 4,143
superseded.

**Cause:** Two checks miss these rows.
- The exact duplicate collapse (`collapsePublishedDuplicates`) needs the same lower-cased name and agreeing frequencies.
- The near-name collapse from #1316 is switched off (`NEAR_NAME_COLLAPSE_LIVE = false`), and it only compares rows of one `source_document_id`.
- A newer capture keeps an old-copy fee live while the fee is still named in the newer copy (`newer-copy-retire.ts`). Nothing links the old row to the new row when the two names differ by punctuation.

**Fix:** Not yet.
1. Turn on #1316's collapse. In the sample, 14 of the A and B pairs were true duplicates. By its rules, #1316 would close 10 of them. It would keep the 2 separate "Stop Payment" / "ACH Stop Payment" lines through the #1303 page check. It would not touch the unclear pair (identical names with different frequencies). It would close none of the separate lines. The Oct 14 hand check on #1302 also passed (19 of 20, the miss fixed by #1328). Switching it on takes live rows down, so it is James's call.
2. A follow-up is needed for D1 and E1: run the same near-name and page check across captures of one page (the `superseded_by_id` chain), not only within one document.

**Queries (read-only, prod).**

Query 1 gives the extra rows, the groups and the class sizes. It was run at 01:23:45 UTC. `core` is
the lower-cased name with punctuation removed, words stemmed as `stem` in `hamilton/publish.ts`
does, and a leading article and trailing "fee"/"charge" dropped. It is an SQL approximation of
`nameCore`, not the code itself.

```sql
WITH c AS (
  SELECT c.fee_published_id AS id, c.institution_id AS i, c.canonical_fee_key AS k, COALESCE(c.fee_audience, 'unknown') AS a, c.amount AS amt,
         COALESCE(c.source_document_id, r.source_document_id) AS d, c.fee_name,
         (SELECT string_agg(w2, ' ' ORDER BY o) FROM (
            SELECT o, CASE WHEN length(w) > 4 AND w LIKE '%ies' THEN left(w, -3) || 'y'
                           WHEN length(w) > 5 AND w LIKE '%ing' THEN left(w, -3)
                           WHEN length(w) > 3 AND w LIKE '%s' AND w NOT LIKE '%ss' THEN left(w, -1) ELSE w END AS w2
              FROM unnest(regexp_split_to_array(trim(regexp_replace(lower(c.fee_name), '[^a-z0-9]+', ' ', 'g')), ' ')) WITH ORDINALITY t(w, o)) s) AS core0
    FROM published_fee_catalog c
    LEFT JOIN raw_fee_observations r ON r.fee_raw_id = c.fee_raw_id
   WHERE c.amount IS NOT NULL
     AND c.fee_published_id NOT IN (49603, 10238, 62577, 9647, 29162, 141769, 91820, 141768, 91981, 141770, 24188, 46888)),
c2 AS (
  SELECT c.*, regexp_replace(regexp_replace(core0, '^(a|an|the) ', ''), '( (fee|charge))+$', '') AS core,
         array_length(regexp_split_to_array(core0, ' '), 1) AS nw,
         lower(regexp_replace(regexp_replace(sd.document_url, '[?#].*$', ''), '^https?://(www\.)?', '')) AS u, sd.content_hash AS h
    FROM c LEFT JOIN source_documents sd ON sd.id = c.d),
g AS (SELECT i, k, a, amt, count(*) AS n FROM c2 GROUP BY 1, 2, 3, 4 HAVING count(*) > 1),
x AS (SELECT c2.*, row_number() OVER (PARTITION BY c2.i, c2.k, c2.a, c2.amt ORDER BY c2.id) AS rn FROM c2 JOIN g USING (i, k, a, amt)),
p AS (
  SELECT x.id, x.d = o.d AS samedoc,
         (lower(btrim(x.fee_name)) = lower(btrim(o.fee_name)) OR x.core = o.core) AS samecore,
         (abs(x.nw - o.nw) = 1 AND (x.core0 LIKE '% ' || o.core0 OR o.core0 LIKE '% ' || x.core0)) AS qual1,
         (x.u = o.u OR x.h = o.h) AS samepage
    FROM x JOIN x o ON o.i = x.i AND o.k = x.k AND o.a = x.a AND o.amt = x.amt AND o.id < x.id
   WHERE x.rn > 1),
b AS (
  SELECT id, CASE WHEN bool_or(samedoc AND samecore) THEN 'A'
                  WHEN bool_or(samedoc AND qual1) THEN 'B'
                  WHEN bool_or(NOT samedoc AND samecore AND samepage) THEN 'D1'
                  WHEN bool_or(samedoc) THEN 'C'
                  WHEN bool_or(NOT samedoc AND samecore) THEN 'D2'
                  WHEN bool_or(samepage) THEN 'E1'
                  ELSE 'E2' END AS cls
    FROM p GROUP BY id)
SELECT cls, count(*) AS rows, (SELECT count(*) FROM g) AS groups, (SELECT sum(n - 1) FROM g) AS extras, now() AS read_at
  FROM b GROUP BY cls ORDER BY cls;
```

Query 2 counts rows with a same-page, same-name partner on another document where either document is
marked. It was run at 01:24:04 UTC and returned 122.

```sql
WITH c AS (
  SELECT c.fee_published_id AS id, c.institution_id AS i, c.canonical_fee_key AS k, COALESCE(c.fee_audience, 'unknown') AS a, c.amount AS amt,
         COALESCE(c.source_document_id, r.source_document_id) AS d,
         regexp_replace(regexp_replace((SELECT string_agg(CASE WHEN length(w) > 4 AND w LIKE '%ies' THEN left(w, -3) || 'y'
                           WHEN length(w) > 5 AND w LIKE '%ing' THEN left(w, -3)
                           WHEN length(w) > 3 AND w LIKE '%s' AND w NOT LIKE '%ss' THEN left(w, -1) ELSE w END, ' ' ORDER BY o)
              FROM unnest(regexp_split_to_array(trim(regexp_replace(lower(c.fee_name), '[^a-z0-9]+', ' ', 'g')), ' ')) WITH ORDINALITY t(w, o)),
           '^(a|an|the) ', ''), '( (fee|charge))+$', '') AS core
    FROM published_fee_catalog c LEFT JOIN raw_fee_observations r ON r.fee_raw_id = c.fee_raw_id
   WHERE c.amount IS NOT NULL
     AND c.fee_published_id NOT IN (49603, 10238, 62577, 9647, 29162, 141769, 91820, 141768, 91981, 141770, 24188, 46888)),
c2 AS (SELECT c.*, lower(regexp_replace(regexp_replace(sd.document_url, '[?#].*$', ''), '^https?://(www\.)?', '')) AS u, sd.content_hash AS h,
              (sd.superseded_by_id IS NOT NULL OR sd.duplicate_of_id IS NOT NULL) AS marked
         FROM c LEFT JOIN source_documents sd ON sd.id = c.d),
pairs AS (SELECT x.id FROM c2 x JOIN c2 o ON o.i = x.i AND o.k = x.k AND o.a = x.a AND o.amt = x.amt AND o.id < x.id
           WHERE x.d <> o.d AND x.core = o.core AND (x.u = o.u OR x.h = o.h) AND (x.marked OR o.marked))
SELECT count(DISTINCT id) AS rows_with_marked_same_page_partner, now() AS read_at FROM pairs;
```

Query 3 counts live rows by the state of their document. It was run at 01:23:54 UTC. It returned
4,056 superseded, 863 marked duplicate, and 72,010 neither.

```sql
SELECT (sd.superseded_by_id IS NOT NULL) AS superseded, (sd.duplicate_of_id IS NOT NULL) AS duplicate_doc,
       count(*) AS live_rows, count(DISTINCT c.institution_id) AS institutions, now() AS read_at
  FROM published_fee_catalog c
  LEFT JOIN raw_fee_observations r ON r.fee_raw_id = c.fee_raw_id
  LEFT JOIN source_documents sd ON sd.id = COALESCE(c.source_document_id, r.source_document_id)
 GROUP BY 1, 2 ORDER BY 3 DESC;
```

The hand sample read `agent_source_texts.normalized_text` (the newest row per document) around each
name. The sampled pairs (extra row / partner) and verdicts:
- **Duplicate (19):** 21903/12242, 15800/7819, 101000/11964, 128896/13013, 110153/10672, 141191/9559,
  61700/8437, 56661/6639, 61292/12912, 35945/13208, 49593/10949, 49594/10961, 135756/5777,
  137341/12974, 94102/7625, 117355/83484, 120373/101625, 31631/1006, 103915/10914.
- **Separate lines (19):** 6363/6352, 141585/141583, 57167/57166, 59465/59464, 97000/30740, 105120/41785,
  105216/18994, 107345/55284, 107350/58248, 109207/53391, 109649/76926, 121750/121628, 129546/129466,
  141787/14037, 142134/142133, 105885/86557, 123328/69949, 125011/103989, 135426/126471.
- **Same fee in two documents (5):** 131541/112624, 61388/51531, 142196/138974, 139821/133637,
  109868/104696.
- **Unclear (2):** 97434/9643 (doc 8040 prints the line twice, and the two rows' frequencies differ),
  106412/101866 (two captures, different maintenance lines).

**Lesson:** A duplicate check keyed on `source_document_id` misses the commonest repeat: the same page
captured twice. Key repeats on the page, meaning the document and its supersession chain.
