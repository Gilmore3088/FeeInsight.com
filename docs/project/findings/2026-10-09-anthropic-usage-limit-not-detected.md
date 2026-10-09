# 2026-10-09: The provider guard missed an Anthropic usage-limit failure

From 08:11 UTC every Anthropic call failed with "You have reached your specified API usage
limits. You will regain access on 2026-11-01 at 00:00 UTC." The last successful call was at
08:08 (Magellan). By 09:32, 46 calls had failed across Knox, Darwin and Hamilton, and two Pro
requests failed: a peer benchmarking report (run 3374) and an Ask memo (run 3407).

The provider guard only knew the credit-balance wording ("credit balance is too low"), so it
never engaged the emergency stop. Agents kept making calls that could not succeed, and Pro users
saw "Hamilton's writer could not be reached" instead of a budget message.

Fix: `PROVIDER_CREDIT_ERROR_MARKERS` in `src/lib/automation-control.ts` now includes the
usage-limit wording. The circuit, the stop and the resume guard all share that list. The Hamilton
memo reports a usage limit as a used-up budget.

The limit itself is a setting on the Anthropic workspace. Only the account owner can raise it.
After it is raised, record "billing resolved" in admin and resume automation, as after a
credit failure.
