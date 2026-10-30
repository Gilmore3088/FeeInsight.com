---
name: domain-modeling
description: Build and sharpen Fee Insight's domain model. Use when discussing what a project term means (fee tiers, peer set, comparison eligibility, accuracy), writing or editing docs/project/GLOSSARY.md, or recording a decision James made in docs/project/DECISIONS.md.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `docs/project/GLOSSARY.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

Adapted for Fee Insight from Matt Pocock's skills (github.com/mattpocock/skills, MIT; see `LICENSE`).
CLAUDE.md wins wherever this file and it differ.

## Where things live

```
docs/project/
├── GLOSSARY.md     ← the project's terms (one context)
├── DECISIONS.md    ← James's decisions, dated, newest first (this repo's ADRs)
└── LESSONS.md      ← one line per decision and finding (lessons-index-kill)
```

Brand and product names (Fee Insight, Bank Fee Index, Hamilton) are fixed in CLAUDE.md and
`src/lib/constants.ts`; the glossary repeats them, it never redefines them.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `GLOSSARY.md`, call it out immediately. "The glossary defines 'live fee' as a fee in `published_fee_catalog`, but you seem to mean any verified fee. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'peers': do you mean the saved peer group or the local competitors? Those have different minimums."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts. Use the demo cast or real institutions, never invented numbers presented as real.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code counts a rate fee in the dollar median, but the rule says rate fees are never pooled with dollar amounts. Which is right?"

### Update GLOSSARY.md inline

When a term is resolved, update `docs/project/GLOSSARY.md` in the same PR as the work. Don't batch these up: capture them as they happen. Use the format in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).

`GLOSSARY.md` should be devoid of implementation details beyond naming the table or constant a term lives in. Do not treat it as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else. Only James settles what a term means; a session proposes and says so.

### Record decisions in DECISIONS.md, sparingly

Only James's decisions go in `docs/project/DECISIONS.md`, and only ones that change how work is
done (CLAUDE.md). A settled word belongs in the glossary instead. A decision is most worth
recording when it is hard to reverse, surprising without context, or the result of a real
trade-off.

When it qualifies, follow the existing format: a dated
`## YYYY-MM-DD` heading, a bold one-line summary, then who decided, his words, why and what it
changes. Add its one-line entry to `docs/project/LESSONS.md` in the same PR.
