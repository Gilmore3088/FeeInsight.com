# Development proxy-addr trust-subnet patch

Issue: [#2157](https://github.com/Gilmore3088/FeeInsight.com/issues/2157), under Foundation #1048.

## Applicability and bounded change

The lockfile installed `proxy-addr@2.0.7` through this development dependency path:
`shadcn@3.8.4 → @modelcontextprotocol/sdk@1.26.0 → express@5.2.1 → proxy-addr`.
Express requests `^2.0.7`, which accepts the patched `2.0.8`. The npm registry snapshot
on 2026-10-19 confirms that version and its published integrity. The lock refresh
changes only `node_modules/proxy-addr`, including its registry funding metadata;
`package.json`, all other lock entries and both existing dependencies (`forwarded@0.2.0`
and `ipaddr.js@1.9.1`) remain unchanged.

The [maintainer advisory GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
describes an affected proxy trust configuration: short mapped IPv6 prefixes such as
`::ffff:10.0.0.0/8`, or an IPv6 subnet with zero leading bits such as `::/1`, could
trust an unrelated IPv4 peer. A supplied forwarded address could then become the
resolved client address. Version 2.0.8 changes this matching behavior; correctly
specified IPv4 and mapped subnets retain their behavior. The
[published npm package metadata](https://registry.npmjs.org/proxy-addr/2.0.8)
identifies the selected patch.

This is development dependency maintenance. A literal source/import search found no
application JavaScript import of `proxy-addr`, Express, or the MCP SDK. The application
does import `shadcn/tailwind.css` in `src/app/globals.css`; this CSS import does not
import the CLI's Express dependency. Application audit/login/action rate-limit code
continues to read its existing trusted forwarded-header contract directly. No proxy
trust configuration is added or changed. The advisory's critical package severity does
not establish a vulnerability in the deployed Next application or prove how an
externally launched developer tool is configured.

## Verification and remaining findings

A before/after probe invokes the actual installed package with synthetic request
objects only. Under 2.0.7, both short IPv6 trust configurations incorrectly accept
`203.0.113.7` and resolve the supplied `198.51.100.66`. Under 2.0.8, both keep the
untrusted direct peer. There is no network listener or exploit request.

Fifteen focused regressions cover those failures for single and multiple trust-subnet
configurations, plain and mapped peers, plus ordinary IPv4 subnet
boundaries, mapped IPv4 peers, correctly specified `/104` mapped trust, actual IPv6
subnets, exact mapped addresses, forwarded chains and requests without forwarded
headers. They call the real package without a mocked resolver or copied implementation.

Separate clean installs before and after the patch verify lockfile reproducibility.
The full npm audit changes from 44 package entries (1 critical, 26 high, 10 moderate,
7 low) to 43 (0 critical, 26 high, 10 moderate, 7 low). Only the `proxy-addr` finding is
removed; every other finding is identical between these snapshots. The production
audit remains identical at 12 entries (0 critical, 2 high, 5 moderate, 5 low).
These are npm package-entry counts, not unique advisories or demonstrated application
exploits. Other dependency families remain separate work.

The review receipts record focused and repository gate results against the exact
candidate. No application runtime source, production data, permission/proxy setting,
provider, database schema or browser session is changed or exercised by this patch.

**Guard:** `src/lib/proxy-addr-security.test.ts:20` (the installed proxy-addr rejects cross-family trust for short mapped IPv6 and zero-prefix subnets, which 2.0.7 accepted)
