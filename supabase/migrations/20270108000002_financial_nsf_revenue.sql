-- Credit unions report overdraft and NSF fee income separately (NCUA 5300 accounts
-- IS0048 and IS0049). overdraft_revenue already exists; this adds nsf_revenue beside it.
--
-- Adds one nullable column. Changes no existing row; values arrive through the NCUA
-- registry runs, which re-pull each quarter because the parser version moved to 2.

BEGIN;

ALTER TABLE institution_financial_records
  ADD COLUMN IF NOT EXISTS nsf_revenue BIGINT;

COMMENT ON COLUMN institution_financial_records.overdraft_revenue IS
  'Overdraft fee income, in thousands. Banks: consumer overdraft-related service charges (RIAD H032, Schedule RI-E; banks over $1B), which combine overdraft and NSF. Credit unions: overdraft fee income (NCUA 5300 IS0048), year to date.';
COMMENT ON COLUMN institution_financial_records.nsf_revenue IS
  'Non-sufficient funds fee income, in thousands. Credit unions only (NCUA 5300 IS0049), year to date. Banks report NSF inside overdraft_revenue.';

COMMIT;
