-- IRS Statistics of Income: individual income tax returns by ZIP code, one row per ZIP and
-- tax year, loaded by Magellan's registry-irs-zip-income step. Amounts are in thousands of
-- dollars as the IRS publishes them. Taxable interest by ZIP is the closest public measure of
-- local deposit balances; AGI per return and earned income credit returns show local income.
--
-- Additive only: one new empty table. No existing row changes value.

BEGIN;

CREATE TABLE IF NOT EXISTS public.irs_zip_income (
  tax_year integer NOT NULL,
  zip text NOT NULL,
  state text,
  state_fips text,
  returns bigint,
  individuals bigint,
  agi_thousands bigint,
  wages_thousands bigint,
  interest_returns bigint,
  taxable_interest_thousands bigint,
  dividends_thousands bigint,
  eitc_returns bigint,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tax_year, zip)
);
COMMENT ON TABLE public.irs_zip_income IS
  'IRS SOI individual returns by ZIP (all income sizes). *_thousands columns are thousands of dollars. ZIPs under 100 returns are suppressed by the IRS and absent.';

CREATE INDEX IF NOT EXISTS idx_irs_zip_income_zip ON public.irs_zip_income (zip, tax_year DESC);

ALTER TABLE public.irs_zip_income ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.irs_zip_income FROM PUBLIC, anon, authenticated;

COMMIT;
