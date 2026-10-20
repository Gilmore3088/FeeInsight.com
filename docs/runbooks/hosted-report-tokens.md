# Hosted report links: issuing tokens

A prepared Competitive Fee Position Report is reached at `https://feeinsight.com/r/<token>`.
The token list is a secret. It lives only in the Vercel environment variable
`HOSTED_REPORT_TOKENS`, never in the repository (James, 2026-10-20; issue #2001).

If the variable is missing, blank or not valid JSON, no link resolves: every `/r/<token>` page
and its `/print` PDF return 404. The 16-character tokens committed before 2026-10-20 can never
resolve again, because a token must now be 32 to 64 lowercase hex characters.

## What the variable holds

One JSON object. Each key is a token; each value describes the report it opens:

```json
{
  "<token>": {
    "institution_id": 1391,
    "institution_name": "First Bank",
    "prepared_on": "2026-10-20",
    "expires_on": "2027-01-18"
  }
}
```

- `institution_id` must match a finished report at `Reports/studio/out/<institution_id>.html`;
  without that file the link 404s.
- `prepared_on` and `expires_on` are `YYYY-MM-DD`. The link works through `expires_on`, then
  offers an updated report instead.
- An entry with a malformed token or record is skipped; the rest still work.

## Issuing new tokens (James)

1. Make one token per institution on your own machine: `openssl rand -hex 16` (prints 32 hex
   characters). Do not reuse a token, and never paste one into the repo, a PR, an issue or chat.
2. Build the JSON object above with one entry per institution. Write it in a local file outside
   the repository, for example `~/hosted-report-tokens.json`.
3. In the Vercel dashboard, open the project's Settings, then Environment Variables. Add (or
   edit) `HOSTED_REPORT_TOKENS` for Production, mark it Sensitive, and paste the whole JSON
   object as its value. Add it to Preview too only if you want links to work on preview builds.
4. Redeploy production (Deployments, then Redeploy on the latest production deployment).
   Environment variables take effect only on a new deployment.
5. Check one new link opens and one made-up token, such as `/r/` followed by 32 zeros, returns
   404.
6. Put the new links into the outreach drafts locally. The drafts in `Reports/studio/drafts/`
   carry `/r/NEW-TOKEN` placeholders; keep the filled-in copies out of the repository.

To revoke a link, remove its entry from the variable and redeploy. To add one, add its entry
and redeploy.
