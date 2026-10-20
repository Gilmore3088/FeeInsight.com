# 2026-10-20: a shared scratch file overwrote another PR's description

Parallel agents write PR bodies to a unique `mktemp` file and re-read the body after every edit.

**What happened:** Two agents running at once wrote PR bodies through the same scratch path. At
2026-10-20T07:15:27Z the description of #2253 was replaced with the text meant for #1864. It was
restored from GitHub's `userContentEdits` history (the 07:05:06Z version).

**Cause:** A fixed, shared file name for `--body-file`. One agent's edit picked up the other
agent's text, and no one re-read the body after editing.

**Fix:** Body restored by hand from the edit history. No code change.

**Lesson:** Use `mktemp` for every PR or issue body file, never a shared name. After
`gh pr edit` or `gh issue edit`, re-read the body (`gh pr view <n> --json body`) and check it is
the intended text.

**Guard:** Foundation tracker #1048 checklist line "agents use mktemp for PR bodies and verify
the body after edit".
