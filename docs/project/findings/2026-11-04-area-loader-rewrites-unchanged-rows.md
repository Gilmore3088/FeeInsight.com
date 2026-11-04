# 2026-11-04: The area statistics loader rewrote every row on each refresh, so the table grew with no new data

**Lesson:** A loader that refetches data on a schedule writes a row only when a value it stores has
changed (`ON CONFLICT ... DO UPDATE ... WHERE ROW(old) IS DISTINCT FROM ROW(new)`), and counts only
those rows as written. In Postgres an UPDATE writes a whole new copy of the row, so rewriting identical
values grows the table and frees nothing on disk.

**What happened:** On Nov 3 the database stood at 16.1 GB on an 18 GB disk. The Atlas storage step's
per-table history showed the bulk public-data tables flat since Oct 20, while `area_statistics` grew
83.5 MB from Oct 26 to Nov 2 with no new periods. `pg_stat_user_tables` showed 2,089,154 inserts and
573,910 updates on it. `upsertAreaStats` in `src/lib/agents/magellan/registry/economy.ts`, the one
writer every area loader calls, had no change guard, unlike the FDIC and NCUA financial loaders. The
same week, Hoovie's in-place storage compaction (`STORAGE_COMPACTION_LIVE`) was slimming 5,000 rows a
day by UPDATE, which also writes new row copies and returns no disk.

**Fix:** the upsert now rewrites a row only when one of its stored values changed (geo name, state,
value, unit, note, raw record or source URL), and returns new or changed rows only, as the FDIC loader
does. The in-place compaction is off; the narrow table rebuilds in the storage design
(https://claude.ai/artifact/KcJWBJzFspHJ57iqvPzPSp) replace it. A row's `fetched_at` now records
when its values last changed, matching the financial loaders.

**What stops a repeat:** Agent lesson `hoovie/area-upsert-only-when-changed`.
