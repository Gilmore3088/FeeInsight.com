# 2026-10-09: a one-column grid let a wide child push the report form off a 320px screen
**What happened:** the UI/UX audit of Oct 9 measured the institution report page at 377 CSS px
wide in a 320px viewport; the report choices, helper text, email field and submit button were
clipped. Re-created locally on /for-institutions with the sample-excerpt table in the offer
column: the page measured 374px (442px once the table has a readable minimum width) at 320px.
**Cause:** below `lg` the offer section and the /reports hero and request section were plain
`grid` with no column template, so the single implicit column is `auto` and its items keep
`min-width: auto`. A table (or any long unbreakable row) in one item sets the column's minimum,
and every item in that column, the request form included, grows to match it. `overflow-x-auto`
on the table's own wrapper does not help while its grid ancestors are allowed to grow.
**Fix:** this PR. The grids use `grid-cols-1` (a `minmax(0, 1fr)` track) and each column gets
`min-w-0`, so the table scrolls inside its own box and the form stays within 320px.
**Lesson:** a grid that holds a table, a long label or a form needs `grid-cols-1` (not an
implicit column) below its breakpoint and `min-w-0` on its children; check new layouts at 320px.
