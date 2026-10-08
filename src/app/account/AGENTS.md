# Account Surface Guide

Account routes bridge authentication, subscription state, selected Hamilton institution context, workspace authority, and API-access posture. They should reinforce Hamilton as the primary Pro workspace instead of becoming a second product surface.

Before editing account actions that touch Hamilton context or institution authority, also read:

- `src/lib/hamilton/account-actions.ts`
- `src/lib/hamilton/workspace-context.ts`
- `src/lib/hamilton/institution-membership.ts`
- `src/lib/access.ts`
- `src/lib/stripe-actions.ts`

## Shared Rules

- Preserve sanitized internal `from` paths through login, registration, Subscribe, checkout, Account, and Welcome so institution-specific Hamilton journeys resume after activation.
- /account is a short settings page in plain language: plan and billing (with team seats), banks followed, Pro email switches, organization, sign-in. Hamilton tools, claims and workspace context live in Hamilton (`/pro/settings`), not here. "Open Hamilton" carries the selected `instId`.
- `AccountView` is pure; `page.tsx` loads everything, so the view renders in tests without a database or Stripe.
- Keep active institution authority separate from pending invitations, profile institution text, and public claim requests. Authority comes from active membership records scoped to numeric `users.id`.
- Pending workspace invitations may help users activate or register, but they must not be treated as active authority until matched to an active Pro user.
- Keep managed account API keys explicitly manual/disabled until key lifecycle, ownership, and rate limiting are implemented. Do not add self-serve key controls that imply an active key-management workflow.
- Label verified-only exports and benchmark access separately from provisional-first Hamilton analysis.
- Do not publish fees, accept claims, or infer verification from account-profile changes.

## Account Journey Ownership

- Login and registration preserve context and workspace-invite state.
- Subscribe and checkout preserve internal Hamilton return paths.
- Welcome completes Pro activation fallbacks and returns the user to the selected Hamilton workflow when possible.
- Account summarizes subscription, selected institution, institution authority, API posture, and direct Hamilton action paths.
