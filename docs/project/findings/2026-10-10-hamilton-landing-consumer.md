# Hamilton landing consumer integration (#982 / #993)

Owner: ChatGPT under James's 2026-10-10 20:24 HKT explicit completion assignment.
Base: 8d915034d0391a451209a1ca3b8e1be5146211af.

## Cause and implementation

The handoff parser, market route and results component existed, but no landing CTA or
Analyze/Reports page mounted them. The narrow integration adds a picker to the existing
Explore panel and consumes the strict research query before generic workspace resolution.
It never sends an Ask request or persists a workspace preference on arrival. Invalid or
mixed saved-artifact/research links fail closed. Existing login/subscription return paths
carry the encoded selection. The layout suppresses research-driven setBank writes.

Local research now applies the charter filter before ranking, retains the explicit subject,
and links named peers to their institution evidence and recorded schedule URL/date. The
map explicitly describes the full geographic footprint separately from the filtered table.
Geographic research continues using the existing governed same-charter index reader.

The board flow requires a checkbox and explicit Create action. Its server action rechecks
access, confirmation and strict selection, reads current governed evidence, validates the
artifact, and saves a data-only board draft using saveHamiltonReport. It records a report
run receipt and reopens through the existing report_id page and report-pdf endpoint. No
model call, inferred pricing advice, fabricated evidence, new table or parallel PDF system.
National/state reports remain unscoped to an institution rather than borrowing the account.

## Ownership

#985 owns H01 identity: its branch is untouched; Analyze hook precedes its saved-answer path.
#988 owns H02 peer lists: no StructuredAsk or peer-list file is changed.
#939 owns the public design: narrow Explore insertion only, no layout/style replacement.
Coordination comments were posted to all three. Owner acknowledgment/combined acceptance
is still a release gate; the comments are not an ownership lock or approval.

## GitHub write diagnosis

Repository API confirms admin/push. #982 ownership and #985/#988/#939 coordination comments
succeeded in this session. Prior conversation retrieval found reports of blocked commit,
comment, label and tracker writes, but no raw denied tool arguments, rule code or verbatim
reviewer rationale. It also found later successful writes and a retracted blanket-block claim.
The historical cause cannot be established from those summaries. A repository permission
403 and a ChatGPT safety denial are distinct. No denied operation has been retried or moved
to another tool in this session. If a denial recurs, capture its exact action/reason and stop
that operation; escalate the original conversation, timestamp, tool and error to OpenAI Support.

## Verification boundary

Automated tests cover strict scope, current selection, login return, no auto-execution,
confirmation/access, exact report save shape and the actual PDF renderer with synthetic data.
These do not establish live authenticated browser or production-data acceptance.
The branch preview currently redirects this browser to Vercel sign-in. Protected preview
access and a Hamilton-authorized application session are required to complete live acceptance.
No merge or production release is claimed by this implementation.
