-- Studio data pack: one institution -> full report JSON.
-- Usage: psql "$DATABASE_URL" -v inst=860 -t -A -f pull-data.sql > packs/860.json
-- Reads published_fee_catalog + institution_sources (+ public Call Report tables) only.
--
-- Value rules (v2, 2026-10). The catalog's canonical_fee_key is not trusted on its own:
--   * a row counts for a category only when its own fee_name supports it (include/exclude
--     patterns below), e.g. an "ATM withdrawal" row filed under overdraft is ignored;
--   * values outside a plausible band for the category are dropped (lo/hi);
--   * fee caps are ignored;
--   * one representative line per institution and category: positive charges before $0, the
--     generic line before channel variants (online, business, fax, trace...), the shortest
--     (most generic) label, then the highest per-item amount -- except monthly maintenance,
--     which takes the lowest positive amount (entry checking). has_zero_tier records that a
--     $0 / waivable option exists;
--   * the same rules apply to the institution and to every peer.
-- Peer cohort: same charter + asset tier, in the institution's state when at least
-- MIN_PEERS (15) such peers publish data; otherwise its Fed district; otherwise national when
-- 40+ same-tier peers publish data; otherwise national across adjacent asset tiers
-- (cohort_scope = 'national_widened'). Percentiles and flags need 8+ peers on the line.
WITH rules(k, source_keys, inc, exc, lo, hi, allow_zero) AS (VALUES
  ('monthly_maintenance', ARRAY['monthly_maintenance','minimum_balance'],
     '(maintenance|monthly service|service charge|monthly fee)',
     '(savings|money market|club|night deposit|safe deposit|box|annual|dormant|inactive|statement|\mira\M|certificate|\mcd\M|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\mhsa\M|health|escrow|trust|address|fax|cop(y|ies))',
     0, 30, true),
  ('overdraft', ARRAY['overdraft','nsf'],
     '(overdraft|overdrawn|\mod\M|o/d|paid item|paid nsf|courtesy pay|bounce protection|privilege)',
     '(transfer|sweep|daily|continuous|extended|sustained|limit|line of credit|protection plan|\mcap\M|maximum|return)',
     5, 45, false),
  ('nsf', ARRAY['nsf','overdraft'],
     '(nsf|insufficient|non-?sufficient|returned item|return(ed)? (check|item|ach|payment)|unpaid item)',
     '(deposit|\mcap\M|daily max|maximum|\mpaid\M|others|re-?present|credit card|loan|transfer|cover)',
     5, 45, false),
  ('atm_non_network', ARRAY['atm_non_network'],
     'atm', '(replace|deposit|statement|card fee|annual|\mpin\M|inquir|denied|declin)', 0.5, 10, false),
  ('wire_domestic_outgoing', ARRAY['wire_domestic_outgoing'],
     'wire', '(incoming|receiv|international|foreign|intl|trace|reversal|recall|amend|investigat|return)', 5, 50, false),
  ('wire_intl_outgoing', ARRAY['wire_intl_outgoing'],
     'wire', '(incoming|receiv|trace|reversal|recall|amend|investigat|return|check|deposit|collection)', 15, 100, false),
  ('wire_domestic_incoming', ARRAY['wire_domestic_incoming'],
     'wire', '(outgoing|send|sent|international|foreign|intl|trace|reversal|recall|amend|investigat|return)', 0, 30, true),
  ('stop_payment', ARRAY['stop_payment'], 'stop', '(release|cancel|revoc|line of credit|heloc|loan|cashier|official)', 10, 45, false),
  ('cashiers_check', ARRAY['cashiers_check'],
     '(cashier|official check|bank check|treasurer|certified|teller check)', '(cop(y|ies)|stop|replace|lost|research)', 2, 20, false),
  ('od_protection_transfer', ARRAY['od_protection_transfer'],
     '(overdraft|\mod\M|\modp\M|o/d|sweep|protection)', '(balance transfer|wire|telephone|phone|online|internal|\mach\M|external|book|set-?up|excess|money market)', 2, 20, false),
  ('paper_statement', ARRAY['paper_statement'],
     'statement', '(cop(y|ies)|address|research|re-?print|duplicate|interim|special|photo|image|e-?statement)', 0.5, 10, false),
  ('card_replacement', ARRAY['card_replacement'],
     '(replace|reissue|lost|stolen)', '(check|statement|key|book|expedit|rush|overnight)', 1, 30, false),
  ('deposited_item_return', ARRAY['deposited_item_return','nsf'],
     '(deposit(ed)? (item|check)|return(ed)? deposit|deposit return|chargeback)', '(night|safe|box|mobile deposit fee|remote|collection|correction)', 3, 40, false)
),
params AS (SELECT 15 AS min_peers),
target AS (
  SELECT id, institution_name, charter_type, asset_size_tier, fed_district,
         state_code, city, asset_size
  FROM institution_sources WHERE id = :inst
),
-- every catalog row that passes its category's name + plausibility rules
guarded AS (
  SELECT c.institution_id, r.k AS canonical_fee_key, c.amount, c.fee_name, r.allow_zero
  FROM published_fee_catalog c
  JOIN rules r ON c.canonical_fee_key = ANY (r.source_keys)
  WHERE c.amount IS NOT NULL
    AND coalesce(c.is_fee_cap, false) = false
    AND c.fee_name ~* r.inc AND c.fee_name !~* r.exc
    AND ((c.amount BETWEEN r.lo AND r.hi AND c.amount > 0) OR (c.amount = 0 AND r.allow_zero))
),
-- one representative amount per institution+category, with the fee line it came from
inst_fees AS (
  SELECT DISTINCT ON (institution_id, canonical_fee_key)
         institution_id, canonical_fee_key, amount, fee_name,
         bool_or(amount = 0) OVER (PARTITION BY institution_id, canonical_fee_key) AS has_zero_tier
  FROM guarded
  ORDER BY institution_id, canonical_fee_key, (amount = 0),
           (fee_name ~* '(online|mobile|internet|electronic|trace|business|commercial|cash management|renewal|\mach\M|\mvia\M|initiated|fax|recurring)'),
           length(fee_name),
           CASE WHEN canonical_fee_key = 'monthly_maintenance' THEN amount ELSE -amount END
),
same_tier AS (
  SELECT s.id, s.state_code, s.fed_district, s.asset_size, s.institution_name, s.city, s.asset_size_tier
  FROM institution_sources s JOIN target t
    ON s.charter_type = t.charter_type
   AND s.asset_size_tier = ANY (CASE t.asset_size_tier
         WHEN 'community_small' THEN ARRAY['community_small','community_mid']
         WHEN 'community_mid' THEN ARRAY['community_small','community_mid','community_large']
         WHEN 'community_large' THEN ARRAY['community_mid','community_large']
         ELSE ARRAY[t.asset_size_tier] END)
  WHERE EXISTS (SELECT 1 FROM inst_fees f WHERE f.institution_id = s.id)
),
scope AS (
  SELECT CASE
    WHEN (SELECT count(*) FROM same_tier st, target t WHERE st.asset_size_tier = t.asset_size_tier AND st.state_code = t.state_code AND st.id <> t.id)
         >= (SELECT min_peers FROM params) THEN 'state'
    WHEN (SELECT count(*) FROM same_tier st, target t WHERE st.asset_size_tier = t.asset_size_tier AND st.fed_district = t.fed_district AND st.id <> t.id)
         >= (SELECT min_peers FROM params) THEN 'district'
    WHEN (SELECT count(*) FROM same_tier st, target t WHERE st.asset_size_tier = t.asset_size_tier AND st.id <> t.id) >= 40 THEN 'national'
    ELSE 'national_widened' END AS scope
),
cohort_members AS (
  SELECT st.* FROM same_tier st, target t, scope sc
  WHERE sc.scope = 'national_widened'
     OR (st.asset_size_tier = t.asset_size_tier AND (
          sc.scope = 'national'
       OR (sc.scope = 'state' AND st.state_code = t.state_code)
       OR (sc.scope = 'district' AND st.fed_district = t.fed_district)))
     OR st.id = t.id
),
cohort AS (
  SELECT f.canonical_fee_key, f.institution_id, f.amount
  FROM inst_fees f JOIN cohort_members m ON m.id = f.institution_id
),
peer_stats AS (
  SELECT canonical_fee_key,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY amount) AS median,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) AS p75,
         min(amount) AS min, max(amount) AS max,
         count(*) AS n
  FROM cohort WHERE institution_id <> :inst GROUP BY 1
),
national AS (
  SELECT f.canonical_fee_key,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY f.amount) AS median
  FROM inst_fees f
  JOIN institution_sources s ON s.id = f.institution_id
  JOIN target t ON s.charter_type = t.charter_type
  GROUP BY 1
),
target_fees AS (
  SELECT f.canonical_fee_key, f.amount, f.fee_name, f.has_zero_tier,
         (SELECT count(*) FROM cohort c2
          WHERE c2.canonical_fee_key = f.canonical_fee_key AND c2.institution_id <> :inst
            AND c2.amount <= f.amount)::float
         / nullif((SELECT count(*) FROM cohort c3
          WHERE c3.canonical_fee_key = f.canonical_fee_key AND c3.institution_id <> :inst), 0) * 100 AS pctile
  FROM inst_fees f WHERE f.institution_id = :inst
),
fee_rows AS (
  SELECT r.k AS category,
         tf.amount AS their_value,
         tf.fee_name AS their_fee_name,
         coalesce(tf.has_zero_tier, false) AS has_zero_tier,
         CASE WHEN ps.n >= 8 THEN round(tf.pctile::numeric, 0) END AS percentile,
         round(ps.p25::numeric, 2) AS peer_p25,
         round(ps.median::numeric, 2) AS peer_median,
         round(ps.p75::numeric, 2) AS peer_p75,
         round(ps.min::numeric, 2) AS peer_min,
         round(ps.max::numeric, 2) AS peer_max,
         coalesce(ps.n, 0) AS peer_count,
         round(n.median::numeric, 2) AS national_median,
         CASE
           WHEN coalesce(ps.n, 0) < 8 THEN CASE WHEN tf.amount IS NULL THEN NULL ELSE 'thin_peer_data' END
           WHEN tf.amount IS NULL THEN 'data_gap'
           WHEN ps.median > 0 AND tf.amount >= 2 * ps.median THEN 'well_above'
           WHEN tf.amount > ps.p75 THEN 'above_band'
           WHEN tf.amount = 0 AND ps.median > 0 THEN 'free'
           WHEN tf.amount < ps.p25 THEN 'below_band'
           ELSE NULL
         END AS flag
  FROM rules r
  LEFT JOIN target_fees tf ON tf.canonical_fee_key = r.k
  LEFT JOIN peer_stats ps ON ps.canonical_fee_key = r.k
  LEFT JOIN national n ON n.canonical_fee_key = r.k
),
-- named peers: same state first, then closest in asset size, then best fee coverage
peer_table AS (
  SELECT m.institution_name, m.city, m.state_code,
         jsonb_object_agg(c.canonical_fee_key, c.amount) AS fees,
         count(*) AS n_cats
  FROM cohort c JOIN cohort_members m ON m.id = c.institution_id, target t
  WHERE c.institution_id <> :inst
  GROUP BY m.id, m.institution_name, m.city, m.state_code, m.asset_size, t.state_code, t.asset_size
  HAVING count(*) FILTER (WHERE c.canonical_fee_key IN (SELECT canonical_fee_key FROM target_fees)) >= 3
  ORDER BY (m.state_code = t.state_code) DESC,
           count(*) FILTER (WHERE c.canonical_fee_key IN (SELECT canonical_fee_key FROM target_fees)) DESC,
           abs(coalesce(m.asset_size, 0) - coalesce(t.asset_size, 0)) ASC
  LIMIT 8
),
all_fees AS (
  SELECT DISTINCT ON (lower(fee_name), amount)
         fee_name, amount, frequency, conditions, is_fee_cap
  FROM published_fee_catalog
  WHERE institution_id = :inst AND amount IS NOT NULL
  ORDER BY lower(fee_name), amount
),
-- Call Report financials (FDIC/NCUA public data): latest snapshot + last full year
fin_latest AS (
  SELECT * FROM institution_financial_records
  WHERE institution_id = :inst AND source IN ('fdic','ncua')
  ORDER BY report_date DESC LIMIT 1
),
fin_year AS (
  SELECT * FROM institution_financial_records
  WHERE institution_id = :inst AND source IN ('fdic','ncua')
    AND extract(month FROM report_date::date) = 12
  ORDER BY report_date DESC LIMIT 1
),
-- cohort financial benchmarks: latest Dec-31 record per same charter+tier institution
fin_cohort AS (
  SELECT DISTINCT ON (r.institution_id) r.institution_id, r.service_charge_income,
         r.total_assets, r.roa, r.efficiency_ratio,
         CASE WHEN r.total_assets > 0
              THEN r.service_charge_income::float / r.total_assets ELSE NULL END AS sc_per_assets
  FROM institution_financial_records r
  JOIN institution_sources s ON s.id = r.institution_id
  JOIN target t ON s.charter_type = t.charter_type
              AND s.asset_size_tier = t.asset_size_tier
  WHERE r.source IN ('fdic','ncua') AND extract(month FROM r.report_date::date) = 12
  ORDER BY r.institution_id, r.report_date DESC
),
fin_cohort_stats AS (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sc_per_assets) AS sc_per_assets_median,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY roa) AS roa_median,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY efficiency_ratio) AS efficiency_median,
         count(*) AS n
  FROM fin_cohort WHERE sc_per_assets IS NOT NULL
),
-- Fee-economics metrics (per fee-revenue-correlation skill):
-- dependency = SC / (SC + other noninterest income); intensity = SC / assets (bps);
-- fee_to_net_income via full-year ROA-derived net income.
fin_cohort_full AS (
  SELECT DISTINCT ON (r.institution_id) r.institution_id,
         r.service_charge_income AS sc, r.total_assets,
         CASE WHEN r.service_charge_income + coalesce(r.other_noninterest_income,0) > 0
              THEN r.service_charge_income::float
                   / (r.service_charge_income + r.other_noninterest_income)
         END AS dependency,
         CASE WHEN r.total_assets > 0
              THEN r.service_charge_income::float / r.total_assets * 10000 END AS intensity_bps,
         CASE WHEN r.roa IS NOT NULL AND r.roa != 0 AND r.total_assets > 0
              THEN r.service_charge_income::float / (r.roa/100.0 * r.total_assets)
         END AS fee_to_ni
  FROM institution_financial_records r
  JOIN institution_sources s ON s.id = r.institution_id
  JOIN target t ON s.charter_type = t.charter_type AND s.asset_size_tier = t.asset_size_tier
  WHERE r.source IN ('fdic','ncua') AND extract(month FROM r.report_date::date) = 12
  ORDER BY r.institution_id, r.report_date DESC
),
fee_econ AS (
  SELECT
    (SELECT to_jsonb(x) FROM fin_cohort_full x WHERE x.institution_id = :inst) AS mine,
    (SELECT jsonb_build_object(
      'dependency_p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY dependency),
      'dependency_median', percentile_cont(0.5) WITHIN GROUP (ORDER BY dependency),
      'dependency_p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY dependency),
      'intensity_p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY intensity_bps),
      'intensity_median', percentile_cont(0.5) WITHIN GROUP (ORDER BY intensity_bps),
      'intensity_p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY intensity_bps),
      'fee_to_ni_median', percentile_cont(0.5) WITHIN GROUP (ORDER BY fee_to_ni),
      'sc_median', percentile_cont(0.5) WITHIN GROUP (ORDER BY sc),
      'n', count(*)) FROM fin_cohort_full WHERE intensity_bps IS NOT NULL) AS cohort,
    (SELECT round(100.0 * count(*) FILTER (WHERE c.intensity_bps <=
        (SELECT intensity_bps FROM fin_cohort_full WHERE institution_id = :inst))
        / nullif(count(*),0), 0)
     FROM fin_cohort_full c WHERE c.intensity_bps IS NOT NULL) AS intensity_pctile,
    (SELECT round(100.0 * count(*) FILTER (WHERE c.dependency <=
        (SELECT dependency FROM fin_cohort_full WHERE institution_id = :inst))
        / nullif(count(*),0), 0)
     FROM fin_cohort_full c WHERE c.dependency IS NOT NULL) AS dependency_pctile
),
-- 3-year fee-revenue trend (year-end filings)
fin_history AS (
  SELECT report_date, service_charge_income,
         CASE WHEN total_assets > 0
              THEN round((service_charge_income::float / total_assets * 10000)::numeric, 1)
         END AS intensity_bps
  FROM institution_financial_records
  WHERE institution_id = :inst AND source IN ('fdic','ncua')
    AND extract(month FROM report_date::date) = 12
  ORDER BY report_date DESC LIMIT 3
),
-- deposit market presence (FDIC Summary of Deposits), when available
deposits AS (
  SELECT count(*) AS branch_rows, sum(NULLIF(deposits, 0)) AS total_branch_deposits,
         count(DISTINCT county_fips) AS counties, max(year) AS sod_year
  FROM institution_branch_deposits WHERE institution_id = :inst AND year = (SELECT max(year) FROM institution_branch_deposits WHERE institution_id = :inst)
),
-- provenance: the actual source documents the fees were extracted from
sources AS (
  SELECT url, sum(n_fees) AS n_fees FROM (
    SELECT coalesce(c.document_url, c.source_url, d.document_url) AS url, count(*) AS n_fees
    FROM published_fee_catalog c
    LEFT JOIN source_documents d ON d.id = c.source_document_id
    WHERE c.institution_id = :inst
    GROUP BY 1
    UNION ALL
    SELECT fee_schedule_url, 0 FROM institution_sources WHERE id = :inst
  ) z
  WHERE url IS NOT NULL AND url <> ''
  GROUP BY url ORDER BY sum(n_fees) DESC LIMIT 6
)
SELECT jsonb_build_object(
  'institution', (SELECT to_jsonb(t) FROM target t),
  'fees', (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.category) FROM fee_rows f),
  'peers', (SELECT jsonb_agg(to_jsonb(p)) FROM peer_table p),
  'all_fees', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.fee_name) FROM all_fees a),
  'sources', (SELECT jsonb_agg(to_jsonb(s)) FROM sources s),
  'financials', jsonb_build_object(
     'latest', (SELECT jsonb_build_object('report_date', report_date, 'source', source,
        'total_assets', total_assets, 'total_deposits', total_deposits,
        'branch_count', branch_count, 'employee_count', employee_count,
        'member_count', member_count, 'roa', round(roa::numeric,2),
        'efficiency_ratio', round(efficiency_ratio::numeric,1)) FROM fin_latest),
     'last_full_year', (SELECT jsonb_build_object('report_date', report_date,
        'service_charge_income', service_charge_income,
        'fee_income_ratio', fee_income_ratio,
        'sc_per_assets', CASE WHEN total_assets > 0
           THEN round((service_charge_income::float/total_assets)::numeric, 5) END)
        FROM fin_year),
     'cohort', (SELECT jsonb_build_object(
        'sc_per_assets_median', round(sc_per_assets_median::numeric, 5),
        'roa_median', round(roa_median::numeric, 2),
        'efficiency_median', round(efficiency_median::numeric, 1),
        'n', n) FROM fin_cohort_stats)
  ),
  'deposits', (SELECT to_jsonb(d) FROM deposits d),
  'fee_econ', (SELECT jsonb_build_object('mine', mine, 'cohort', cohort,
      'intensity_pctile', intensity_pctile, 'dependency_pctile', dependency_pctile)
      FROM fee_econ),
  'fin_history', (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.report_date) FROM fin_history h),
  'meta', jsonb_build_object(
     'pull_date', now()::date,
     'rules_version', 2,
     'cohort', (SELECT charter_type || ' / ' || asset_size_tier FROM target),
     'cohort_tiers', (SELECT jsonb_agg(DISTINCT m.asset_size_tier) FROM cohort_members m),
     'cohort_scope', (SELECT scope FROM scope),
     'cohort_size', (SELECT count(DISTINCT institution_id) FROM cohort WHERE institution_id <> :inst),
     'source', 'published_fee_catalog (verified pipeline), name- and range-checked per category'
  )
);
