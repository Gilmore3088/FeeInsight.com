# PDF column reader: the reviewer's adversarial layouts

These are the seven repro files (`zz-adv` to `zz-adv7`) the reviewer wrote against #2965, copied
as they were. Each builds a synthetic fee-table page from positioned text runs and compares
`layoutPageResult(items, { columnReading: true })` with `{ columnReading: false }`. A column
reader is right only if every fee-table layout reads the same as the switch-off reading.

They are stored as `.txt` on purpose. They import `layoutPageResult` with a `columnReading`
option, which exists only on the closed branch `feat/rosetta-pdf-columns`, not on main, so a
`.ts` file here would fail tsc and vitest. To use them, copy one next to the new reader, drop the
`.txt`, and fix the import.

The finding is `../../2026-11-03-pdf-columns-need-structure.md`. The layouts they cover: notes
columns, wrapped descriptions, dot-leader and one-space rows, partial "$" price columns, trailing
text after amounts, Member | Non-member tiers, four-column tables, facing-page furniture.
