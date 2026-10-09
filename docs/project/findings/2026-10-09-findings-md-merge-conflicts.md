# 2026-10-09: Every finding was added to the same lines of FINDINGS.md
**What happened:** PRs 755, 771, 762 and 770 (2026-10-09, 00:50 to 01:22 UTC) and 739 (2026-10-08)
stopped with a merge conflict in `docs/project/FINDINGS.md` (`git merge-tree` against
`origin/main`; 770's squash merge was refused with a 405). Each owner had to merge `main` by hand
before CI or the merge could go on.
**Cause:** the file asked for newest entries at the top, so every PR inserted its entry directly
under the template. Any two PRs open at once edited the same lines.
**Fix:** new findings are one file each in `docs/project/findings/`, named
`YYYY-MM-DD-short-slug.md`; `FINDINGS.md` keeps entries through 2026-10-09.
`scripts/ci-guards.sh findings-file-kill` (in `guard:legacy`) fails on a later-dated
FINDINGS.md heading or a misnamed file. This PR.
**Lesson:** a shared log that every PR appends to at the same spot needs one file per entry.
