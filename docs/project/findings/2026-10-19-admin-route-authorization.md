# 2026-10-19: admin authorization must precede operator reads

**What happened:** The code audit found that the admin layout trusted a request-derived login marker before validating the session. The proxy only checked cookie presence. A local reproduction reached child content with an unsigned cookie and no authentication call. Several page reads and direct endpoints also used the customer-level `view` permission or relied on the layout alone.

**Cause:** A public login compatibility route shared the protected layout and introduced an authentication exemption. Direct server entry points did not consistently require the existing `operate` permission.

**Fix:** Issue #2104. The dedicated security change redirects `/admin/login` directly to shared login, removes the layout exemption, strips the legacy marker, rejects invalid admin cookie signatures, and gates operator reads at page/action/API boundaries. Regression tests exercise forged requests, customer roles, operator roles and login return paths. Production deployment is not claimed by this finding.

**Lesson:** Login compatibility must not create a bypass in a protected layout. Authenticate and authorize every directly callable operator read before accessing its data, and keep negative role coverage in the route inventory.

**Guard:** `src/app/admin/authorization.test.ts:167` (an operator-only guard is the first awaited work of every admin data page); `src/app/admin/layout.test.tsx:46` validates the session despite forged login-route headers
