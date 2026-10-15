-- #1094 step 1: the kind of document each stored text is.
--
-- Rosetta decides it from the content when it reads the document (`documentKind`,
-- src/lib/agents/learning/document-kind.ts): a fee schedule, a Truth in Savings disclosure, an
-- account agreement, a product page, or other. Knox and the scorecard read it; nothing decides it
-- a second time.
--
-- This file only adds. It adds two nullable columns to `agent_source_texts`, with a check on the
-- kind's values. It changes no stored data: existing texts keep NULL until Rosetta next reads
-- their document. Today's code never names the columns and runs unchanged against them. The code
-- that writes them checks that both columns exist first, so it is safe in either deploy order.
--
-- lock_timeout: adding a column and a constraint take an ACCESS EXCLUSIVE lock. If a Rosetta
-- transaction holds the table, this fails after 5 seconds instead of queueing every read behind
-- it; it can then be run again.
--
-- The check is added NOT VALID (no scan under the ACCESS EXCLUSIVE lock), then validated in its
-- own statement, which scans under a SHARE UPDATE EXCLUSIVE lock that lets reads and writes go on.
-- Every existing row is NULL, so the validation passes.
SET lock_timeout = '5s';

ALTER TABLE public.agent_source_texts
  ADD COLUMN IF NOT EXISTS document_kind text,
  ADD COLUMN IF NOT EXISTS document_kind_version integer;

ALTER TABLE public.agent_source_texts
  DROP CONSTRAINT IF EXISTS agent_source_texts_document_kind_check;
ALTER TABLE public.agent_source_texts
  ADD CONSTRAINT agent_source_texts_document_kind_check
  CHECK (document_kind IS NULL OR document_kind IN ('fee_schedule', 'truth_in_savings', 'account_agreement', 'product_page', 'other'))
  NOT VALID;
ALTER TABLE public.agent_source_texts
  VALIDATE CONSTRAINT agent_source_texts_document_kind_check;

COMMENT ON COLUMN public.agent_source_texts.document_kind IS
  'What kind of document the text is, decided by Rosetta from the content at read (#1094). NULL until the next read, and NULL when a read stores no text.';
COMMENT ON COLUMN public.agent_source_texts.document_kind_version IS
  'DOCUMENT_KIND_VERSION of the rules that decided document_kind.';
