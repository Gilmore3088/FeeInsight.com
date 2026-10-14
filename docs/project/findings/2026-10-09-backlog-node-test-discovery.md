# Backlog Node checks were accidentally discovered by application Vitest

Canonical work item: #984; implementation PR: #987. No application behavior changed.

## Observed failure

On head `572a70acafd33b5129a756a85e40b2735c8a08f5`, application run
37994322118 / job 114036333032 failed to bundle the built-in `node:test` imported by
`.github/scripts/backlog.test.mjs`. Vitest reported one failed test file, 584 passed,
two skipped; 5,084 individual tests passed and four were skipped. This is a test
runner integration error introduced by the backlog setup, not a proven product regression.

## Narrow correction

Rename the two Node-runner suites to `backlog.node-check.mjs` and
`backlog-review.node-check.mjs`. Their blob contents and assertions are unchanged.
Update the owned backlog workflows and operator guide to run them explicitly with
`node --test`. Application Vitest configuration and application test files are untouched.

Local validation of the renamed files: 46 passed, zero failed, zero skipped.
The original test blobs were verified as `4120adeb26189bb7bfd8497b3bdc59781187ab82`
and `7c824ee6515236808798e0c60d49540d1c6db552`. Passing these does not establish
full application CI success; inspect the final head's GitHub Actions run before approval.

Source evidence: https://github.com/Gilmore3088/FeeInsight.com/actions/runs/37997537194
Artifact `backlog-resolution-evidence`, file `ci-failure-excerpt.txt`.
