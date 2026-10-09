# 2026-10-09: provider usage limit left Hamilton answers blank or as errors
**What happened:** the Anthropic API key reached its monthly usage limit at 08:11 UTC Oct 9. From
then every paid call failed with HTTP 400 `invalid_request_error`, "You have reached your
specified API usage limits..." (rows in `ai_api_usage_events`, e.g. `generate_report_section` on
`api.reports.generate` at 08:25 and `storyline_memo` on `api.hamilton.chat` at 09:16). Pro readers
saw a generic "couldn't finish", a blank memo line ("writer could not be reached"), or "Report
generation failed: ..." with the provider's text.
**Cause:** no code recognized a usage or billing refusal. The usage-limit text is not one of the
credit markers in `automation-control.ts`, it arrives as a 400 (not 402/429), and on the Analyze
screen the failure happens inside `streamText`'s stream, after the route's catch has returned, so
the AI SDK's default "An error occurred." was all the browser got.
**Fix:** `isProviderLimitError` in `src/lib/ai-provider.ts` (402, or usage-limit, credit or quota
text, including wrapped causes) and one reader line, `HAMILTON_PAUSED_MESSAGE` in
`src/lib/hamilton/provider-paused.ts`. Analyze streams it through `toUIMessageStream({ onError })`
and returns it as a 503 from the sync catch; the Ask memo returns it as `unavailable` while the
storyline stays; Pro report generation and the report job status show it. Budgets, controls and
the provider circuit are unchanged. PR: claude/hamilton-provider-paused (not merged at writing).
**Lesson:** a provider refusal inside a streamed response never reaches the route's catch; map it
in the stream's `onError`. Classify provider errors with `isProviderLimitError` rather than
matching provider text in each route.
