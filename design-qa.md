# Hamilton branch visual QA

final result: blocked

Source visual truth: docs/design/hamilton-rebuild/references/ask-entry.png (selected simple Ask entry); accompanying ask-brief, national-overview, florida-overview, financial-evidence and board-builder references remain in the design package.

Implementation: actual Next.js Hamilton components on fix/1010-hamilton-unified-workspace; isolated synthetic fixture in design-preview/ for visual review without production access.

Browser-rendered implementation screenshot: unavailable. Viewport, pixel dimensions and density normalization: not measured because browser capture is blocked. No full-view or focused-region comparison can be claimed. No primary browser interactions or console checks passed.

The supported sites-preview service launched its command in a filesystem where repository dependencies were unavailable. A local Vite fixture server then started, but cloud-browser access was rejected by browser security policy. No alternate browser surface, protection bypass or production deployment was attempted after that rejection.

## Findings

- P1: Visual verification remains blocked. The supplied references have been inspected; fonts, spacing, colors, image fidelity and copy cannot be accepted from code inspection alone. Capture actual desktop and phone states and compare each against the source in a combined image before passing this gate.
- P1: Authenticated end-to-end save/reopen/PDF acceptance remains outstanding. Synthetic fixtures and isolated tests do not establish live account or data coverage.

## Implementation checklist

1. Open the separate branch in an authorized preview environment.
2. Compare the Ask entry and brief with the selected references at matching viewports.
3. Test question submission, failure/retry, saved answers, different home/research institutions, board edits, save/reopen and PDF.
4. Check phone navigation, overflow, focus and browser errors; fix P0/P1/P2 findings and recapture.
5. Keep this PR draft until those checks pass. Do not merge or promote to production without James explicitly approving this redesign.

Comparison history: no rendered comparison exists. No visual pass is claimed.

## Brand correction — October 11

James found the initial preview off-brand. The refinement reuses Fee Insight's global warm/terracotta tokens and the pricing page's locally supplied Plus Jakarta Sans for display type. Charcoal replaces navy, terracotta replaces teal across controls and research charts, and report headings use the same display face. No functional or data behavior changed. Hosted authenticated visual QA remains outstanding: the verified preview redirects to normal Fee Insight sign-in; no login bypass is introduced. The older references guide structure; their navy/teal palette is superseded by this user-directed brand correction.
