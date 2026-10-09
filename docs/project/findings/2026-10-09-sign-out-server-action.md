# Sign out on the account page and admin used Server Actions that a redeploy breaks

**Found:** 2026-10-09, Sign-out thread (James: "i cannot log out of an account on the site").

James's new test account (user 24, made 08:19 UTC) still had its session row after he tried to
sign out, and `api_route_audit_events` held a single `api.auth.logout` post ever (Oct 8), so the
sign-out he used never ended the session. Free and lapsed accounts only have the "Sign out"
button on /account, and admin has its own. Both called a Server Action:

- A Server Action is addressed by an id from the build that drew the page. Every merge to main
  redeploys prod, so a page open across a deploy posts an id the new build doesn't have. The
  account button awaited it with no error handling, so it would sit on "Signing out..."
  (inferred from the code; not reproduced on prod).
- When it did work, the account button moved to /login with a client navigation, so the header's
  cached session (`use-session-chrome.ts`) still showed the signed-in Account corner.
- The header's own form (`/api/auth/logout`, Pro menu and phone drawer) answered with a 307,
  which makes the browser re-post the form to the landing page.

**Fix:** every sign-out is a plain form post to `/api/auth/logout` (`SignOutForm` in
`src/components/sign-out-form.tsx`). The route deletes the session row and cookie and answers
303 to a same-site path from the form's `next` field, so the page reloads signed out.

**Rule:** don't put auth state changes behind Server Actions called from long-lived pages; post
a form to a route.
