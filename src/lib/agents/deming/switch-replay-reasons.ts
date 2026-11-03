/**
 * Why each switch with no golden-set replay cannot replay (`NOT_REPLAYABLE_REASONS`), in its own
 * file so parallel switch PRs do not meet in `switch-replay.ts`. One entry per line, sorted by name:
 * a new switch's line lands at its own place in the alphabet, so two PRs rarely touch the same
 * spot, and `.gitattributes` merges this file with git's union driver when they do. A line kept in
 * two versions is a duplicate key (TS1117) and `switch-inventory.test.ts` fails it, an unsorted
 * entry or an entry spread over lines (finding 2026-11-02-switch-inventory-doc-conflicts.md).
 * Defines no switch: it is switch tooling (`isSwitchTooling`).
 */

const SYSTEM = "does not read, write or publish a fee";
const ONE_DOCUMENT = "each golden member is one document read once, with no other copies, editions or publication history";
const DATABASE = (what: string) => `its decision reads ${what} from the database, which no golden member carries`;

/**
 * Plan step 4 (#2533 follow-up, Nov 2): why each switch with no entry in `SWITCH_REPLAYS` cannot
 * replay on the golden set. The inventory prints it in the replay column and fails a switch with
 * neither a replay nor a reason here, so a new switch cannot land unexplained. The switch gate
 * fails a PR that turns a switch on (or adds one switched on) with no replay unless this map's
 * line for it is on an added line of the same PR: the PR states the reason it ships without a
 * golden-set receipt, and review reads it in the diff.
 */
export const NOT_REPLAYABLE_REASONS: Readonly<Record<string, string>> = {
  ACCOUNT_OWNER_REFILE_LIVE: `not wired yet: the account-owner re-file needs each raw row's own product name and Knox's raw name, which the replayed read does not keep (${DATABASE("the raw row's product")})`,
  ACCOUNT_TYPE_COLUMN_READ_LIVE: "not wired yet: Hamilton's account-type hold reads the fee's table column product (`tableColumnProduct`) and account type from the raw row; the golden set scores no account type",
  ATM_SURCHARGE_TAKEDOWN_LIVE: "a hand list of named production fee ids (#1772, #1773); no golden fee is one of them, so a replay could only pass vacuously",
  AUDIENCE_V5_LIVE: "changes only the audience Darwin reads (box rows) and the relabel chain; the golden set has no audience answer to score",
  CALL_PERIOD_PRUNE_LIVE: `Hoovie's call-report period storage prune; ${SYSTEM}`,
  CARD_PRODUCT_TAKEDOWN_LIVE: "governs only Hamilton's live sweep of card-product misfiles; the replayed publish guard already applies the same rule (`cardProductMisfile`) to every golden fee, so the sweep would find nothing left to take down",
  CITY_REPAIR_LIVE: `Atlas's institution city repair; ${SYSTEM}`,
  CLUB_WITHDRAWAL_LIVE: "read once into a category guard rule's exclude pattern at module load; no override reaches it without changing `fee-category-guard.ts`",
  COLD_EXPORT_LIVE: `Hoovie's cold storage export; ${SYSTEM}`,
  COMPARATOR_FRAGMENT_REREAD_LIVE: "its comparator shapes are only ever a `reread` (kept live with a re-read request to Knox, never renamed or taken down), and the golden set does not replay Knox's re-read requests; the fragment sweep's takedowns replay under FRAGMENT_NAME_TAKEDOWN_LIVE with this switch at its code value",
  CURRENT_COPY_CONFIRM_LIVE: `Hamilton's current-copy confirm compares a live fee's document with the bank's current sources; ${ONE_DOCUMENT}`,
  DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE: "not wired yet: added by #2894 after this gate was built; its live $0 re-check reads each fee's stored line and the account it belongs to, and no sweep replay for it exists yet",
  DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE: `re-judges verified rows whose category a learning pass changed (\`options.learning\`); ${DATABASE("the learned category change")}`,
  DARWIN_HISTORY_CHECK_LIVE: "not wired yet: the history check compares a fee waiting for Darwin with the same bank's live published value for that fee (same bank, category, audience, product and name, on the same page or schedule), a database read; the golden set replays single documents with no published history, so a replay could only pass vacuously",
  DARWIN_RECHECK_OLDER_LIVE: `Darwin's verified re-check of older live rows decides by publication age and earlier verdicts; ${DATABASE("each row's verify history")}`,
  DARWIN_RECHECK_SECOND_LOOK_LIVE: `second looks are due by a first look's timestamp 12 hours earlier; ${DATABASE("the earlier first look")}`,
  DARWIN_RECHECK_TIER_RULE_LIVE: `the tier rule reads the bank's general schedule beside a tier document; ${ONE_DOCUMENT}`,
  DARWIN_RELEASE_REPAIR_LIVE: `re-checks fees released from Knox's held queue; ${DATABASE("the held-queue release")}`,
  DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE: `proves a takeover's category against the fee it replaces; ${DATABASE("the replaced live fee")}`,
  DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE: "not wired yet: Darwin's worked example re-check reads each live fee's stored source text before its excerpt (a database read of agent_source_texts) and takes matches down after a second look; Knox's own read of the same rule (rules v160) is not behind the switch and is already replayed by the golden set, so a switch replay could only pass vacuously",
  DATED_EDITION_TAKEOVER_LIVE: `retires a fee when a newer dated edition of its schedule is live; ${ONE_DOCUMENT}`,
  EDITION_CHECK_LIVE: `compares a bank's schedule editions by effective date; ${ONE_DOCUMENT}`,
  EDITION_LATE_HEADING_LIVE: `reads a late edition heading only to order a bank's editions (\`judgeEditions\`); ${ONE_DOCUMENT}`,
  ESCHEAT_HOLD_REREAD_LIVE: "an SQL predicate over Knox's held rows (`escheatProcessingNameSql`); the replay has no held queue to re-read",
  FEDERAL_BILLS_TRACKER_LIVE: `Magellan's federal bills tracker; ${SYSTEM}`,
  FEDERAL_REGISTER_TRACKER_LIVE: `Magellan's Federal Register tracker; ${SYSTEM}`,
  HAND_LINK_REPAIR_LIVE: `Atlas's hand-listed fee-link repairs; ${SYSTEM} (it changes which document a bank links)`,
  HAND_TAKEDOWN_RETURNS_LIVE: "re-reads of hand-listed production lines (`hand-takedowns.ts`); no golden fee is a listed line",
  HELD_VOCABULARY_RELABEL_LIVE: "acts only on fees already live, through Knox's re-read of Darwin's requests, Darwin's re-read category and re-file checks, the live name re-tidy and Hamilton's live name refresh; the golden set replays new reads, which take the vocabulary either way (shadow-lab experiment `held-name-vocabulary-off` measures it)",
  HMDA_RELINK_LIVE: `Hoovie's HMDA lender relink by GLEIF-registered LEI; ${SYSTEM}`,
  HOLD_SOURCE_REREAD_LIVE: "not wired yet: Darwin's hold source re-read reads range and peer holds and the bank's current copy of their page, and routes stale copies to Magellan; the golden set holds no held fees, so a replay could only pass vacuously",
  HTML_ROW_PAIRING_LIVE: "a Rosetta reader switch: it changes how a page's HTML becomes text, and every golden member is text already read, so no golden number can move; it is measured on the answer-key documents' own bytes instead (shadow-lab experiment `html-row-pairing`, `source-replay.test.ts`), and the switch waits for the Knox PR that holds a $0 maintenance row under an online banking, mobile banking or bill pay heading",
  INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE: "not wired yet: its rows join each live wire fee to the stored text identity of its raw row (`storedTextIsOriginal`) and the bank's own wire scope, which the replay does not build",
  KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE: `corrects the account subject of live monthly fees across a bank's documents; ${ONE_DOCUMENT}`,
  KNOX_ANCILLARY_OWNER_CORRECT_LIVE: `re-owns ancillary products' fees to their primary account across live raw rows; ${DATABASE("the raw rows' product ownership")}`,
  KNOX_AUDIENCE_LESSONS_LIVE: `Knox's audience lessons come from confirmed takedowns (pipeline feedback), and the golden set scores no audience; ${DATABASE("the lessons")}`,
  KNOX_FREE_PATH_LESSONS_LIVE: "not wired yet: on, it writes a read a lesson fires on held at the extract step's save (a database flag on the raw row); the golden-set replay scores what Knox reads, not what the save holds, and the lessons' tests already run in each read's dry-run report, so a replay could only pass vacuously",
  KNOX_READ_LESSONS_LIVE: `Knox's read lessons are other checks' fixes to a document's earlier read; ${DATABASE("those fixes")}`,
  KNOX_REREAD_BACKLOG_LIVE: "not wired yet: the re-read backlog only chooses which stored texts Knox reads again (current texts read under an older rules version, behind live fees first); it changes no read, and the golden set replays every document under today's rules already, so a replay could only pass vacuously",
  KNOX_REREAD_FEEDBACK_LIVE: `acts on re-read requests other checks filed in pipeline feedback; ${DATABASE("the requests")}`,
  KNOX_REREAD_PUBLISHED_NAME_LIVE: `renames a live fee from a re-read request; ${DATABASE("the request")}, and the golden set does not score names`,
  KNOX_SINGLE_ACCOUNT_OWNER_LIVE: `re-owns single-account disclosures' fees across live raw rows; ${DATABASE("the raw rows' product ownership")}`,
  KNOX_TWO_READ_AGREEMENT_LIVE: "not wired yet: the two-read check pairs the free and paid Knox rows already stored for one text and holds raw rows still waiting for Darwin; the golden set replays one read per document and has no paid read to pair, so a replay could only pass vacuously",
  LIVE_NAME_REFRESH_LIVE: "renames live fees to a better name; the golden set scores category, price and frequency, not names",
  LIVE_SOURCE_REFETCH_LIVE: "Magellan's refetch of live fees' source pages; the golden set's documents are frozen text",
  MOVED_PAGE_REFRESH_LIVE: `moves a live fee to the page its document moved to; ${ONE_DOCUMENT}`,
  NEAR_NAME_COLLAPSE_LIVE: `collapses near-name repeats among a bank's live fees across publish steps; ${ONE_DOCUMENT}`,
  NEWER_COPY_RETIRE_LIVE: `retires fees an older copy published once a newer copy of the document is read; ${ONE_DOCUMENT}`,
  NON_DEPOSIT_LINK_RELEASE_LIVE: `sends a bank's left-behind fee link back to discovery; ${SYSTEM}`,
  OVERDRAFT_PLAN_HOLD_LIVE: "not wired yet: Hamilton's frequency fill holds a period-priced overdraft plan beside the bank's per-item overdraft fee; the replay does not run the fill",
  PAGE_COPY_COLLAPSE_LIVE: `collapses copies of one page published from different documents; ${ONE_DOCUMENT}`,
  PDF_CELL_REPLAY_LIVE: "chooses which stored pdf_layout texts Rosetta reads again from their PDF bytes (layout v6 cell ownership); the golden set replays frozen text, never PDF bytes, so the switch cannot change a golden read; the record-only layout recheck (layout-recheck.ts) measures its live fees instead",
  PRODUCT_PAGE_CONFLICT_LIVE: `rolls back a product page's fee that conflicts with the bank's schedule; ${ONE_DOCUMENT}`,
  PRODUCT_PAGE_REPEAT_TAKEDOWN_LIVE: `takes down a product page's repeat of a schedule line (\`scheduleTwin\`); ${ONE_DOCUMENT}`,
  PRODUCT_SPLIT_MERGE_LIVE: `merges a re-read of a live fee's printed line under another product (publish supersedes or refuses; Darwin takes the loser down); ${ONE_DOCUMENT}; measured instead by a read-only pass over every live pair on prod (Nov 3, off: 119 candidate pairs, 65 fees at 49 institutions would come down)`,
  PUBLISH_REFUSE_DUPLICATES_LIVE: `refuses rows the exact-duplicate collapse would close against live fees from earlier publish steps; ${ONE_DOCUMENT}`,
  PUBLISH_REFUSE_PAGE_COPIES_LIVE: `refuses rows the page-copy collapse would close; ${ONE_DOCUMENT}`,
  PUBLISH_REFUSE_SAME_LINE_READS_LIVE: "not wired yet: refuses a second read of a live fee's printed line at publish; the replayed publish gate does not call it (Darwin's same-line read sweep, which uses the same `readsSameLine`, is replayed)",
  PUBLISH_REFUSE_SWEEP_RULES_LIVE: "not wired yet: refuses at publish the rows a sweep would take down; the replayed publish gate does not call it, and each sweep it borrows is replayed after publish on its own switch",
  PUBLISH_REPOINT_CURRENT_COPY_LIVE: `moves a live fee from a superseded copy of its page onto the current copy's row publish skipped as identical, only when both trace to the same printed line, the copy is newer and the fee passes the shared source check (v2); it keeps the fee's name, amount and category, so no golden-set number can move, and it was sampled against the current copies instead (Nov 2: 40 of 40 kept pairs on the right line); ${ONE_DOCUMENT}`,
  PUBLISH_SWEEPS_SPLIT_LIVE: "schedules Hamilton's publish sweeps as their own run kind; it changes when sweeps run, not what they decide",
  RANGE_BAND_SET_ASIDE_LIVE: `sets aside rate and balance bands in Knox's held queue; ${DATABASE("the held queue")}`,
  REDIRECT_WEBSITE_PROOF_LIVE: "Magellan's proof before a redirect landing replaces an institution's website; upstream of extraction, and the golden set's documents are frozen text",
  REG_WIRE_SUMMARIES_LIVE: `Magellan's regulatory wire summaries (shadow mode, no model call); ${SYSTEM}`,
  REREAD_CATEGORY_RECHECK_LIVE: `acts only on fees another check asked Knox to re-read (\`fragment_name\`); ${DATABASE("the re-read request")}`,
  RESEARCH_SPLIT_LIVE: "read once into the fold's split table at module load (`SPLIT_CATEGORIES`); no override reaches it without changing `fee-fold.ts`",
  RETENTION_LIVE: `Atlas's ledger retention; ${SYSTEM}`,
  RULES_RECHECK_TAKEDOWN_LIVE: `a pause switch: a re-check failure comes down only when a second run 12 hours later fails it again; ${DATABASE("the first look")}`,
  SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE: `judges a live fee against the older publication it replaced; ${ONE_DOCUMENT}`,
  SAME_PAGE_SUPERSEDE_LIVE: `chooses which stored copy of a page is current; ${ONE_DOCUMENT}`,
  SAME_TEXT_COPY_REOPEN_LIVE: "reopens rejected stored copies in Rosetta; the golden set's documents are frozen text that is never rejected",
  SAMPLE_REPORT_LIVE: `shows the sample report page; ${SYSTEM}`,
  SAVED_LINK_FETCH_LIVE: "Magellan's fetch of a bank's saved fee link; the golden set's documents are frozen text",
  SECTION_PATH_LIVE: "the replay can hold it (`switches.sectionPath`), but it changes only the audience Darwin reads, and the golden set has no audience answer, so no golden number can move",
  SOURCE_LINK_DRIFT_LIVE: `repairs a live fee's source link when its document's address drifts; ${ONE_DOCUMENT}`,
  STALE_COPY_DROPPED_LINE_LIVE: `retires a live fee whose line a newer copy of the same page no longer prints; ${ONE_DOCUMENT}; measured instead by a read-only dry run over every superseded copy on prod (Nov 2, re-run on main before it turned on: none with it off, 15 fees at 11 institutions with it on, 15 of 15 absent from the current copy's stored text)`,
  STALE_COPY_RETIRE_LIVE: `retires a live fee read from a superseded copy of its page against the current copy's text and live fees; ${ONE_DOCUMENT}; turned on from the Nov 2 read-only pass over every superseded copy on prod instead (57 twins at 46 institutions, 20 of 20 sampled right against the stored texts)`,
  STATED_DATE_BACKFILL_LIVE: "writes a fee schedule document's stated date (document metadata, read by Darwin's dated-edition check v4); the golden set's members are single frozen documents with no other dated editions, so no golden number can move. Turned on in #2917 after a read-only dry run over all 17,368 stored texts (453 newly dated, 157 changed) and Darwin's re-check (135 lines at 10 banks), each sampled 20/20 against the bank's own documents",
  STATE_BILLS_TRACKER_LIVE: `Magellan's state bills tracker; ${SYSTEM}`,
  STATE_NEWS_TRACKER_LIVE: `Magellan's state regulatory news tracker; ${SYSTEM}`,
  STORAGE_COMPACTION_LIVE: `Hoovie's storage compaction; ${SYSTEM}`,
  SUBORDINATION_REFILE_LIVE: "read once into the fold's split table at module load (`SPLIT_CATEGORIES`); no override reaches it without changing `fee-fold.ts`",
  SUNDAY_EMAIL_LIVE: `Deming's Sunday maintenance email; ${SYSTEM}`,
  SUPERSEDED_RECHECK_LIVE: `re-checks Knox's held rows from a superseded document against its current text; ${ONE_DOCUMENT}`,
  SUPERSEDED_REFILE_LIVE: `re-files held rows from a superseded document on a state lane's extract; ${DATABASE("the held rows")}`,
  TEXAS_CAPITAL_TAKEDOWN_LIVE: "a hand list of named production fee ids (#1880); no golden fee is one of them, so a replay could only pass vacuously",
  TRANSLATED_COPY_RESTORE_LIVE: `restores a fee taken down as a translated copy once its English twin is gone; ${ONE_DOCUMENT}`,
  TRANSLATED_COPY_TAKEDOWN_LIVE: `takes down a Spanish copy's fee beside its live English twin; ${ONE_DOCUMENT}`,
  VAULT_RETENTION_LIVE: `Atlas's document vault retention; ${SYSTEM}`,
};
