# Outreach email template

Identity: send as **James Gilmore · Fee Insight** from hello@bankfeeindex.com (display name
must say Fee Insight; the From, the body and the signature all say the same company).
Never send from a "Bank Fee Index" display name.

Attach: `Fee-Insight_Competitive-Fee-Position_{{INSTITUTION_SLUG}}.pdf`
Hosted copy: {{HOSTED_LINK}} (per-institution link, expires 90 days after prepared date;
UTM every link: `?utm_source=outreach&utm_medium=email&utm_campaign=cfp-2026q3`)

Subject: Prepared for {{INSTITUTION}}: your published fees vs. {{N}} peer {{banks|credit unions}} (report attached)

Hi {{FIRST_NAME}},

I run Fee Insight — we publish the Bank Fee Index, a source-verified record of the fee
schedules of {{INSTITUTION_COUNT}} U.S. banks and credit unions.

We prepared a Competitive Fee Position report for {{INSTITUTION}}; it is attached, at no cost.
One finding from it:

> {{ONE_FINDING — the `quote` field of narratives/<id>.json, e.g. "Your deposited-item
> return fee ($18) is 3.6× the $5 peer median, the highest of the 15 peers that publish it."}}

Prefer a link? Your report is here, no login: {{HOSTED_LINK}}

The report compares each of your published fees with {{COHORT — e.g. "60 banks with
$300M–$1B in assets nationwide"}}, and shows how named peers price the same lines. Every
figure is traced to a public document.

If any figure doesn't match your current schedule, tell me and I'll correct it. Otherwise
I'd welcome 15 minutes for your reaction.

James Gilmore
Founder, Fee Insight — publisher of the Bank Fee Index
feeinsight.com · hello@bankfeeindex.com

---
## Variant: general inbox (info@, memserv@, IR inbox)
First line of the body, before "Hi {{FIRST_NAME}}": **Attn: {{FULL_NAME}}, {{TITLE}}**
(no verified name: open with "Hi," and let the Attn: line carry the title, e.g. **Attn: Manager / CEO, {{INSTITUTION}}**)

## Variant: web contact form only (3 lines, no attachment survives a form)
Hi {{FIRST_NAME}} — I'm James Gilmore, founder of Fee Insight (publisher of the Bank Fee
Index). We prepared a Competitive Fee Position report for {{INSTITUTION}}. One finding: {{ONE_FINDING — one
complete sentence ending in a period; never cut at a decimal or "vs."}} The report is yours at no cost; what's the best email address to send the PDF to? Or read it here:
{{HOSTED_LINK}}. — James, hello@bankfeeindex.com

---
Rules: send from the Business browser profile / hello@bankfeeindex.com (Fee Insight) identity only.
ONE_FINDING is the narrative's `quote`, generated from the verified numbers; never hand-edit a figure. Log every send + reply in
outreach-log.md the same day. Before the first send: confirm the target profile page on
feeinsight.com reads correctly (numbers, fee table) — the recipient will open it.
