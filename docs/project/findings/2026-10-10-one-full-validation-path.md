# One full validation path, with build and database checks visible

R09 / issue #983. `npm run validate` runs the existing legacy guards, TypeScript,
lint, and the complete Vitest suite once. `test:agentic` remains available for
focused local work but is not redundantly executed before the full suite in CI.
`npm run validate:build` also runs the existing build and postbuild route checker.

CI now names the build explicitly and runs the real pipeline test against local
throwaway PostgreSQL. No production database credential is read. CI actions are
pinned, checkout credentials are not persisted, and the test job has read access.
The global test environment is unchanged; this is not an untested Node/jsdom move.

Skipped tests in a generic full-suite run are not live integration evidence. The
separate disposable database step must pass before declaring integration verified.
