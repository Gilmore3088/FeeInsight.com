# 2026-10-20: `vc env run` created preview deployments and a token reached disk

Agents never run deploy-capable `vc`/`vercel` commands and never write a Vercel token to disk.

**What happened:** An agent ran `vc env run -- node <script>` to give a script its environment.
The CLI treated the path as a deploy target and created two preview deployments,
`feeschedule-gkw6q1w04-fee-insight.vercel.app` and `feeschedule-evde1i6hb-fee-insight.vercel.app`
(left in place, per James). Separately, an agent pulled the Vercel token with `vc env pull` into
a scratch file, then deleted the file.

**Cause:** The Vercel CLI can turn a run into a deploy, and nothing stops an agent from calling
it. Pulling env files copies secrets onto disk.

**Fix:** None in code. The deployments were left; the scratch file was deleted. Token rotation
has not been done and is James's call.

**Lesson:** To reach a protected preview, use the `x-vercel-trusted-oidc-idp-token` header
without writing a token to disk. Do not run `vc`/`vercel` commands that can deploy or pull env
files from an agent session. Consider rotating the token that touched disk.

**Guard:** Foundation tracker #1048 checklist line "ban deploy-capable vercel commands for
agents" (a settings deny rule or hook).
