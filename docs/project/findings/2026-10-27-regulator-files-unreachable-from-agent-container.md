# 2026-10-27: The regulators' bulk files cannot be read from the agent container
**What happened:** Gate G3/D3 (#1925) needs Hamilton's shown quarterly financials checked against
the regulators' own filings, not only against `institution_call_report_items`. On 2026-10-27 from
the agent container, every regulator host answered `curl: (56) CONNECT tunnel failed, response 403`
at the egress proxy: cdr.ffiec.gov (bulk download page), www.ffiec.gov, ncua.gov and www.ncua.gov
(including `files/publications/analysis/call-report-data-2026-06.zip`), mapping.ncua.gov,
api.fdic.gov, banks.data.fdic.gov and www.federalreserve.gov. The proxy status endpoint records
each as "gateway answered 403 to CONNECT (policy denial or upstream failure)". WebFetch read NCUA's
quarterly-data page (its zip links match `ncuaZipUrl`, and NCUA marks 2023-12, 2024-03, 2024-12
and 2025-03 as revised), but it cannot return a zip's bytes.
**Cause:** the session's egress policy does not allow these hosts. It is not a fault in the
loaders, which run on Vercel.
**Fix:** none in the container. Following the 2026-10-18 FFIEC finding, there is no workaround
through other proxies or mirrors. The direct check (`src/lib/hamilton/filings-direct-check.ts`,
`scripts/filings-direct-check.ts`) reads zips downloaded anywhere else: `sql` prints a read-only
SELECT for the read-only SQL tool, and `check` compares the result with the zips in
`<dir>/ffiec` and `<dir>/ncua`.
**Lesson:** a check meant to be independent of our copy of the filings needs the regulator's file
itself. When the host can't be reached, say so with the exact error and run on fixtures, never on
the stored copy under the same name.

**Agent lesson:** hamilton/issue-1925-check-shown-figures-against-the-filing
