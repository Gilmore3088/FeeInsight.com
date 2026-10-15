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
ALTER TABLE public.agent_source_texts
  ADD COLUMN IF NOT EXISTS document_kind text,
  ADD COLUMN IF NOT EXISTS document_kind_version integer;

ALTER TABLE public.agent_source_texts
  DROP CONSTRAINT IF EXISTS agent_source_texts_document_kind_check;
ALTER TABLE public.agent_source_texts
  ADD CONSTRAINT agent_source_texts_document_kind_check
  CHECK (document_kind IS NULL OR document_kind IN ('fee_schedule', 'truth_in_savings', 'account_agreement', 'product_page', 'other'));

COMMENT ON COLUMN public.agent_source_texts.document_kind IS
  'What kind of document the text is, decided by Rosetta from the content at read (#1094). NULL until the next read.';
COMMENT ON COLUMN public.agent_source_texts.document_kind_version IS
  'DOCUMENT_KIND_VERSION of the rules that decided document_kind.';
