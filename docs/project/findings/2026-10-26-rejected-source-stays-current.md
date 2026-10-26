# 2026-10-26: a rejected address came back as the profile's current source

**What happened:** an institution's playbook (`institution_source_profiles`) keeps the addresses
the pipeline rejected (`rejected_source_urls`, `{ url, reason, at }` objects) beside its current
source (`canonical_source_url`). Every writer that rejects an address already clears the current
source when it is that address. The writers that set the current source never looked at the
list: Magellan's fetch (ok and failed), Rosetta's read profile sync (any status), discovery's
profile write and the state-lane profile sync. So a page sent back as not a fee schedule, a 403,
or another bank's host came back as current on the next fetch or read. The fetch asks for the
remembered address first, so it kept asking for the rejected address on every pass.

Deming's daily playbook check (#1105) was built to flag this and never did: it tested the list
with `rejected ? source`, which matches only bare strings, and its database test seeded bare
strings. It reported 0 every day.

**Measured (prod, SELECT only, 2026-10-26):** 26 profiles hold a current source on their own
rejected list, none locked by a correction. 9 have a completed current text read from that address
after the reject (the reject is stale); 7 have a completed text from it read before the reject;
10 have no completed text from it. Separately, 1,014 profiles carry a second-document search entry
on their current link in `do_not_retry` (written before #1494, Oct 5-16); by design those are not
verdicts on the link and the check reports them apart. The rough "about 1,047" text match counted
both kinds together.

Layout: `layout_fingerprint` was filled on 0 of 8,775 profiles; 5,732 have a completed current text
and no layout. Knox computed `layoutSignature` for every read but only put it in the attempt detail.

**Fix:** this PR (`src/lib/agents/learning/rejected-sources.ts` states the rule).
- A completed Rosetta read is newer evidence than the reject: it drops the address from the list as
  it makes it current.
- Any other automated write of a rejected address (fetch, failed or thin read, discovery, the
  profile sync filling an empty source) leaves the current source empty until a read judges it.
- A person's fee link drops the address from the list. A locked correction keeps its address.
- Deming's check (v2) matches the `url` field; its database test seeds production's shape.
- Knox's free rules attempt carries `layoutFingerprint` (`table/short@1`), which the playbook
  stores in `layout_fingerprint`.

No migration and no data script: existing rows heal through the same writers. An unchanged fetch
does not touch the profile, so a row heals on its next new-content fetch, completed read, failed
fetch or discovery write.

**Lesson:** a current source and a reject list are two views of one judgement; every writer of
one checks the other, and only a read that judged the page overturns a reject. A check written
against a stored shape is seeded from a production row, or it can report 0 forever.

**Agent lessons:** magellan/issue-1105-rejected-is-never-current,
rosetta/issue-1105-a-read-supersedes-a-reject, deming/issue-1105-check-the-stored-shape
