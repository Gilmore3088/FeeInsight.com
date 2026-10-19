# Legacy password upgrades and atomic login sessions

Issue: [#2148](https://github.com/Gilmore3088/FeeInsight.com/issues/2148), under Foundation #1048.

## Finding and change

Login verified the historical `salt:sha256(salt:password)` representation but ignored
`needsRehash`. A successful login therefore left that fast verifier in storage. Login
also selected and verified a credential before inserting a session in a separate
operation. A password reset or account deactivation could commit in that interval,
after which the stale login could create a new session.

New password writes use native Node scrypt with an explicit version and fixed policy:
`$scrypt$v1$N=131072,r=8,p=1$<32 hex salt>$<128 hex key>`. This uses a random 16-byte
salt, a 64-byte derived key, `N=2^17`, `r=8`, `p=1`, and a 160 MiB native memory
ceiling per invocation. These are the OWASP scrypt parameters for installations
without Argon2. Native Node crypto avoids adding another password dependency.
The [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
and [Node crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
describe the policy and native interface.

The verifier validates the exact supported version, encoded parameters and salt/key
lengths before scheduling native work. It accepts every complete, nonempty noncolon
legacy salt followed by a 64-digit hexadecimal digest. Malformed digests fail normally
before `timingSafeEqual`; a valid legacy password requests an upgrade. Passwords are
never truncated or Unicode-normalized. Native and SQL tests distinguish suffixes after
72 UTF-8 bytes, including multibyte input.

All supported login formats now recheck the selected password hash and active account
under `FOR UPDATE`. An optional legacy hash replacement and `issueSession(userId, tx)`
then commit in that same transaction. The cookie is emitted after the commit. A reset,
deactivation, deletion, or competing upgrade that wins before this guard denies the
stale login. A failed session insert rolls the upgrade back. A later successful reset
continues to delete every session, including the newly committed login session.

## Resource and compatibility boundaries

- One loaded password module admits at most two active expensive operations, with at
  most eight waiting and a five-second admission deadline. Hashing, scrypt verification
  and bcrypt comparison share this gate. Excess or expired work fails before starting;
  timed-out entries are removed. Native/compare errors release admission. The two
  scrypt memory ceilings total 320 MiB, in addition to application overhead. This is a
  process-local bound; the durable pre-verifier client/identifier login reservations
  from #2122 remain the separate cross-instance control.
- Existing `$2a$`/`$2b$` bcrypt hashes retain the library's original 72-byte input
  semantics and are not automatically rewritten. Accepted bcrypt costs are explicitly
  bounded to 4 through 16; malformed and higher costs fail before comparison. Repository
  writers previously used cost 10. No production credential scan was performed, and
  this change does not claim every existing cost cohort is known. A valid credential
  outside that bound needs the existing password-reset path. The
  [bcryptjs maintainer documentation](https://github.com/dcodeIO/bcrypt.js/)
  explains its 72-byte behavior.
- Registration, password reset and successful legacy upgrades use the new full-input
  writer. Registration maps hashing/admission failures into its existing typed generic
  failure, with no account or session insertion. Reset and sign-in already catch these
  failures at their action boundaries. Visitor-facing failure copy is unchanged.
- A successful legacy upgrade changes the hash used to sign reset links, invalidating
  previously issued links. Requesting a new reset link is the existing recovery path.
  Concurrent legacy logins selecting the same old verifier have one successful upgrade;
  the loser gets the existing generic credential failure and can retry.
- The schema fixture defines `users.password_hash` as `text`, which accommodates the
  189-character encoding. No schema migration or production password/hash/user read,
  mass rewrite, production mutation, permission setting or provider change is included.
- A local synthetic native-crypto probe measured about 345 ms for two parallel derives
  on the development machine. This is not a production latency or throughput promise.

## Verification

The focused tests cover real native crypto round trips and long-input compatibility;
strict malformed/cost rejection; active/waiting capacity, FIFO handoff, timeout removal,
and failure recovery; existing login/signup/reset behavior; and real PostgreSQL
credential/reset/deactivation/concurrent-login races. The SQL suite clones current
fixture columns/checks/indexes into a random schema, gives it an independent identity
sequence, and drops that schema afterward. It requires an explicit loopback TLS
`E2E_DATABASE_URL` and never advances public fixture sequences or uses public data.
The shared CI E2E inventory includes the new lifecycle suite alongside all existing
limiter, history, refresh and retirement suites.

The SQL tests use barriers around verification and actual reset actions, plus a forced
session constraint failure, to prove the final guard and transaction rollback. Separate
native end-to-end fixture cases exercise registration, reset, long legacy upgrade and
subsequent login without mocking the cryptography. Validation receipts record the exact
review head and full local/CI results; no production authentication or browser session
was exercised.
