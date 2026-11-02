/**
 * The switch inventory's hand-kept facts: what the code cannot say about a `*_LIVE` switch.
 * Everything else in the inventory (kind, file, code default, replay scope, retire flag and the
 * counts) is computed from the code each time (`npm run switch-inventory` prints it), so it is
 * never committed and never goes stale (finding 2026-11-02-switch-inventory-doc-conflicts.md).
 *
 * One line per switch, sorted by name, so two PRs that each add or change a switch's facts touch
 * different lines and git merges them. A new switch needs no line here: its first commit is read
 * from git when the table is printed (`npm run switch-inventory -- --missing` on main prints lines
 * to add). `switch-inventory.test.ts` fails a line for a name that is no longer a switch, a
 * duplicate, an unsorted entry, an entry spread over two lines, and documented prod state on
 * anything but an environment switch. Union-merge caveats: `docs/project/switch-inventory.md`.
 *
 * - `firstSeen`: the first commit on main whose diff adds the name under `src/` outside tests and
 *   this file and the reasons file (`git log -S`, 9-character hashes),
 *   recorded once because full history is slow to search and CI checks out shallow. A recorded
 *   value wins over git; `npm run switch-inventory -- --verify` lists any that differ.
 * - `prod`: an environment switch's prod value as a committed document records it. Vercel is never
 *   read. `reviewed` is the day the evidence was read; the 14-day retire rule counts to it.
 * - `note`: anything a reader needs that is in neither the code nor the columns above.
 */

export interface DocumentedProdState {
  on: boolean;
  since: string;
  reviewed: string;
  source: string;
}

export interface SwitchFacts {
  firstSeen?: string;
  prod?: DocumentedProdState;
  note?: string;
}

export const SWITCH_FACTS_PATH = "src/lib/agents/deming/switch-inventory-facts.ts";

export const SWITCH_FACTS: Readonly<Record<string, SwitchFacts>> = {
  ACCOUNT_OWNER_REFILE_LIVE: { firstSeen: "2026-10-30 f60c851e5" },
  ACCOUNT_TYPE_COLUMN_READ_LIVE: { firstSeen: "2026-10-25 6b023bfeb" },
  ATM_SURCHARGE_TAKEDOWN_LIVE: { firstSeen: "2026-10-17 f6d9b5d6c" },
  AUDIENCE_V5_LIVE: { firstSeen: "2026-11-01 43a12f6c1" },
  BANDED_ZERO_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 1604fbf3d" },
  BORROWED_DIRECTION_LIVE: { firstSeen: "2026-10-18 60b7acf8d" },
  BROKERAGE_DOCUMENT_TAKEDOWN_LIVE: { firstSeen: "2026-10-16 ee6beb6bd" },
  CALL_PERIOD_PRUNE_LIVE: { firstSeen: "2026-10-25 fb42543af" },
  CANADIAN_DOCUMENT_TAKEDOWN_LIVE: { firstSeen: "2026-10-19 20507faf2" },
  CARD_PRODUCT_TAKEDOWN_LIVE: { firstSeen: "2026-10-17 cc0645041" },
  CARD_PROGRAM_SECTION_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 730581845" },
  CARD_PROGRAM_TAKEDOWN_LIVE: { firstSeen: "2026-10-18 77de616eb" },
  CITY_REPAIR_LIVE: { firstSeen: "2026-10-15 c10a296bd" },
  CLUB_WITHDRAWAL_LIVE: { firstSeen: "2026-10-19 2e097e2c7" },
  COLD_EXPORT_LIVE: { firstSeen: "2026-10-18 d9e4a7904" },
  COMPARATOR_FRAGMENT_REREAD_LIVE: { firstSeen: "2026-11-01 a60314cab" },
  CREDIT_TERMS_TAKEDOWN_LIVE: { firstSeen: "2026-10-26 d97e8fe39" },
  CURRENT_COPY_CONFIRM_LIVE: { firstSeen: "2026-10-06 cc99dda63" },
  DAILY_CAP_LINES_LIVE: { firstSeen: "2026-11-01 5d99782d7" },
  DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE: { firstSeen: "2026-11-01 ede1d0cf5" },
  DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE: { firstSeen: "2026-10-15 21b891796" },
  DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE: { firstSeen: "2026-10-25 18cebcf11" },
  DARWIN_HISTORY_CHECK_LIVE: { firstSeen: "2026-11-02 1d8a2f14b" },
  DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE: { firstSeen: "2026-11-01 57d88e2f7" },
  DARWIN_RECHECK_OLDER_LIVE: { firstSeen: "2026-10-16 c6c158bf7" },
  DARWIN_RECHECK_SECOND_LOOK_LIVE: { firstSeen: "2026-10-16 c6c158bf7" },
  DARWIN_RECHECK_TIER_RULE_LIVE: { firstSeen: "2026-10-26 2b21b9275" },
  DARWIN_RELEASE_REPAIR_LIVE: { firstSeen: "2026-10-16 a179d4c5d" },
  DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE: { firstSeen: "2026-10-16 2d036e627" },
  DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE: { firstSeen: "2026-11-02 e8bd0c4b6" },
  DASH_LIST_ROWS_LIVE: { firstSeen: "2026-11-01 a66fc763d" },
  DATED_EDITION_TAKEOVER_LIVE: { firstSeen: "2026-10-25 450c78291" },
  EDITION_CHECK_LIVE: { firstSeen: "2026-10-21 dda006afa" },
  EDITION_LATE_HEADING_LIVE: { firstSeen: "2026-10-25 e039e33a7" },
  ESCHEAT_HOLD_REREAD_LIVE: { firstSeen: "2026-10-30 92192fc92" },
  FEDERAL_BILLS_TRACKER_LIVE: { firstSeen: "2026-10-06 a66891c33", prod: { on: true, since: "2026-10-09", reviewed: "2026-11-01", source: "docs/project/findings/2026-10-09-congress-bills-flag-not-seen.md" } },
  FEDERAL_REGISTER_TRACKER_LIVE: { firstSeen: "2026-10-06 a1217765c" },
  FOOTNOTED_ATM_HEADING_LIVE: { firstSeen: "2026-11-02 f74a37eae" },
  FRAGMENT_NAME_TAKEDOWN_LIVE: { firstSeen: "2026-10-15 ab12dba39" },
  HAND_LINK_REPAIR_LIVE: { firstSeen: "2026-10-19 20507faf2" },
  HAND_TAKEDOWN_RETURNS_LIVE: { firstSeen: "2026-10-19 f9b61cf2b" },
  HELD_VOCABULARY_RELABEL_LIVE: { firstSeen: "2026-11-02 0dd240218" },
  HOLD_SOURCE_REREAD_LIVE: { firstSeen: "2026-11-01 ea9a3dc3d" },
  HOURLY_FREQUENCY_LIVE: { firstSeen: "2026-10-16 6739f264d" },
  HOURLY_LINE_LIVE: { firstSeen: "2026-10-18 1626342c7" },
  INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE: { firstSeen: "2026-10-26 97f32d7d4" },
  INTL_ABBREVIATION_REFILE_LIVE: { firstSeen: "2026-10-25 bd53e94e8" },
  KNOX_ACCOUNT_SUBJECT_CORRECT_LIVE: { firstSeen: "2026-10-26 fa0449fe2" },
  KNOX_ANCILLARY_OWNER_CORRECT_LIVE: { firstSeen: "2026-10-26 aa6aab9b0" },
  KNOX_AUDIENCE_LESSONS_LIVE: { firstSeen: "2026-10-26 f52bdccc1" },
  KNOX_DISCONTINUED_TABLES_LIVE: { firstSeen: "2026-10-27 080125169" },
  KNOX_FREE_PATH_LESSONS_LIVE: { firstSeen: "2026-11-01 482e44d2a" },
  KNOX_HELD_NAME_RULES_LIVE: { firstSeen: "2026-10-15 e61049e95" },
  KNOX_READ_LESSONS_LIVE: { firstSeen: "2026-10-27 085f9f9fe" },
  KNOX_REREAD_BACKLOG_LIVE: { firstSeen: "2026-11-01 bd1ac531d" },
  KNOX_REREAD_FEEDBACK_LIVE: { firstSeen: "2026-10-16 fa0a730db" },
  KNOX_REREAD_PUBLISHED_NAME_LIVE: { firstSeen: "2026-10-26 354e9153b" },
  KNOX_SINGLE_ACCOUNT_OWNER_LIVE: { firstSeen: "2026-11-01 801376893" },
  KNOX_TWO_READ_AGREEMENT_LIVE: { firstSeen: "2026-11-01 65b3e82c6" },
  LATE_CHARGE_BOUND_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 9dd049402" },
  LINE_CONFLICT_OWN_UNIT_LIVE: { firstSeen: "2026-11-01 99425000c" },
  LINE_CONFLICT_TAKEDOWN_LIVE: { firstSeen: "2026-10-16 1a808ba7d" },
  LIVE_NAME_REFRESH_LIVE: { firstSeen: "2026-10-26 235e2809d" },
  LIVE_SOURCE_REFETCH_LIVE: { firstSeen: "2026-10-20 52bb054fb" },
  LOAN_PAYMENT_NSF_REFILE_LIVE: { firstSeen: "2026-10-30 f595c6ca4" },
  LOAN_SECTION_TAKEDOWN_LIVE: { firstSeen: "2026-10-26 79c8f80ee" },
  MOVED_PAGE_REFRESH_LIVE: { firstSeen: "2026-10-20 b6c61ae41" },
  NEAR_NAME_COLLAPSE_LIVE: { firstSeen: "2026-10-15 60ceb50d6" },
  NEWER_COPY_RETIRE_LIVE: { firstSeen: "2026-10-06 20191fca9" },
  NON_CUSTOMER_CASHIERS_CHECK_LIVE: { firstSeen: "2026-10-21 a7a3eca6b" },
  NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE: { firstSeen: "2026-10-16 db9bb68db" },
  NON_DEPOSIT_LINK_RELEASE_LIVE: { firstSeen: "2026-11-01 e3fe6a0b3" },
  NO_CHARGE_SENTENCE_READ_LIVE: { firstSeen: "2026-10-26 89af77118" },
  NO_FEE_SENTENCE_TAKEDOWN_LIVE: { firstSeen: "2026-10-30 1cecebef3" },
  OD_TRANSFER_REFILE_LIVE: { firstSeen: "2026-10-30 1cecebef3" },
  OPENING_DOCUMENT_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 5ba4db38f" },
  OVERDRAFT_PLAN_HOLD_LIVE: { firstSeen: "2026-10-16 1a808ba7d" },
  OWN_UNIT_BLANK_PART_HOUR_LIVE: { firstSeen: "2026-11-01 ffa09bf5b" },
  OWN_UNIT_REFILE_LIVE: { firstSeen: "2026-10-30 960e4798b" },
  PAGE_COPY_COLLAPSE_LIVE: { firstSeen: "2026-10-15 ef0a33099" },
  PRODUCT_PAGE_CONFLICT_LIVE: { firstSeen: "2026-10-12 1f284a651" },
  PRODUCT_PAGE_REPEAT_TAKEDOWN_LIVE: { firstSeen: "2026-10-21 5f8364567" },
  PROTECTION_ITEM_REFILE_LIVE: { firstSeen: "2026-11-01 e0d8cdc44" },
  PUBLISH_REFUSE_DUPLICATES_LIVE: { firstSeen: "2026-10-15 384edf1ce" },
  PUBLISH_REFUSE_PAGE_COPIES_LIVE: { firstSeen: "2026-10-18 2d7076165" },
  PUBLISH_REFUSE_SAME_LINE_READS_LIVE: { firstSeen: "2026-10-25 8cfb66155" },
  PUBLISH_REFUSE_SWEEP_RULES_LIVE: { firstSeen: "2026-10-16 d0757fb5e" },
  PUBLISH_REPOINT_CURRENT_COPY_LIVE: { firstSeen: "2026-11-02 83cb85531" },
  PUBLISH_SWEEPS_SPLIT_LIVE: { firstSeen: "2026-10-19 7fdff6f62" },
  QUALIFIED_FRAGMENT_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 cbee82961" },
  RANGE_BAND_SET_ASIDE_LIVE: { firstSeen: "2026-10-16 fcca62684" },
  RATE_FLOOR_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 a285de618" },
  REDIRECT_WEBSITE_PROOF_LIVE: { firstSeen: "2026-11-01 2145bdc5c" },
  REG_WIRE_SUMMARIES_LIVE: { firstSeen: "2026-10-09 c891c7c10" },
  REREAD_CATEGORY_RECHECK_LIVE: { firstSeen: "2026-10-26 d753fc88a" },
  RESEARCH_SPLIT_LIVE: { firstSeen: "2026-10-16 d624616e3" },
  RETENTION_LIVE: { firstSeen: "2026-10-18 49cbd6004" },
  RULES_RECHECK_TAKEDOWN_LIVE: { firstSeen: "2026-10-09 8f45e5b25" },
  SAME_LINE_READ_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 8cfb66155" },
  SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE: { firstSeen: "2026-10-25 83f1ee66e" },
  SAME_PAGE_SUPERSEDE_LIVE: { firstSeen: "2026-10-06 0a6e90e5c" },
  SAME_TEXT_COPY_REOPEN_LIVE: { firstSeen: "2026-10-25 16ce8326e" },
  SAMPLE_REPORT_LIVE: { firstSeen: "2026-10-05 50fc51527" },
  SAVED_LINK_FETCH_LIVE: { firstSeen: "2026-10-19 0b8c153c9" },
  SECTION_PATH_LIVE: { firstSeen: "2026-11-01 eaf6bef99" },
  SOURCE_LINK_DRIFT_LIVE: { firstSeen: "2026-10-17 385e9f3fe" },
  STALE_COPY_RETIRE_LIVE: { firstSeen: "2026-11-01 2250e6305" },
  STATED_DATE_BACKFILL_LIVE: { firstSeen: "2026-11-01 a40ffe9e7" },
  STATE_BILLS_TRACKER_LIVE: { firstSeen: "2026-10-06 88824ec5e", prod: { on: true, since: "2026-10-08", reviewed: "2026-11-01", source: "docs/project/FINDINGS.md (Oct 8 entry)" } },
  STATE_NEWS_TRACKER_LIVE: { firstSeen: "2026-10-08 1cee20537" },
  STORAGE_COMPACTION_LIVE: { firstSeen: "2026-10-25 fb42543af" },
  SUBORDINATION_REFILE_LIVE: { firstSeen: "2026-10-15 93562862e" },
  SUNDAY_EMAIL_LIVE: { firstSeen: "2026-10-13 e5d91c0c0" },
  SUPERSEDED_RECHECK_LIVE: { firstSeen: "2026-10-09 7d759dafe" },
  SUPERSEDED_REFILE_LIVE: { firstSeen: "2026-10-14 8a5ba63d6" },
  TEXAS_CAPITAL_TAKEDOWN_LIVE: { firstSeen: "2026-10-18 4b0472777" },
  TRANSLATED_COPY_RESTORE_LIVE: { firstSeen: "2026-10-26 887ec16fd" },
  TRANSLATED_COPY_TAKEDOWN_LIVE: { firstSeen: "2026-10-18 a8227ac41" },
  VAULT_RETENTION_LIVE: { firstSeen: "2026-10-20 ea2d65079" },
};
