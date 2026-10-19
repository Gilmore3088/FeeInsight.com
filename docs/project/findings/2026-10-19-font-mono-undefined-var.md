# `font-mono` and `font-sans` resolve to nothing on the public site

Found 2026-10-19 while redesigning the institution Overview cards (PR #1864).

`src/app/globals.css` maps Tailwind's font utilities to `--font-sans: var(--font-geist-sans), ...` and
`--font-mono: var(--font-geist-mono), ...`. Nothing defines `--font-geist-sans` or `--font-geist-mono`
(the app loads only local serif faces through `next/font/local`). A `var()` with no value and no
fallback makes the whole `font-family` declaration invalid at computed-value time, so every element
with `font-mono` (83 components) or `font-sans` silently inherits its parent's face instead of the
monospace stack.

The brand tokens already carry working stacks with fallbacks: `--fi-font-sans` and `--fi-font-mono`
in `src/brand/tokens/tokens.css`. The Overview drawer uses `[font-family:var(--fi-font-mono)]`.

Fix (not done here, it touches every page): point `--font-sans` and `--font-mono` in `globals.css`
at `var(--fi-font-sans)` and `var(--fi-font-mono)`, or give the `var()` calls fallbacks, and check
the admin tables and Pro plan cards that use `font-mono` for a visible change.

**Guard:** none yet. #2166 carries the fix and adds a check that fails when `globals.css` names a
custom property nothing defines.
