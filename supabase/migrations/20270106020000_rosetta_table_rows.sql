-- Rosetta pass 2 and 3: structured table rows and the reader that produced each text.
--
-- table_rows: {"version": 1, "rows": [{"table": 0, "page": null, "cells": ["Overdraft fee", "$35.00"],
--              "header": false, "origin": "html_table"}]}. Each row's cells joined by " | " is one
--              line of normalized_text. NULL when the document has no tables.
-- reader:     the specialist whose text is stored (read.html_dom, read.pdf_layout,
--              read.ocr_tesseract, read.js_fallback, read.paid_transcribe).
-- Contract: src/lib/agents/rosetta/AGENTS.md. Rosetta writes texts as before until this
-- migration is applied.

ALTER TABLE public.agent_source_texts ADD COLUMN IF NOT EXISTS table_rows jsonb;
ALTER TABLE public.agent_source_texts ADD COLUMN IF NOT EXISTS reader text;
