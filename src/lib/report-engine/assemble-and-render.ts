/**
 * Report Assembly Orchestrator
 *
 * assembleAndRender() picks the right assembler + Hamilton sections + template by report_type,
 * runs them in sequence, and returns a complete HTML string ready for PDF conversion.
 *
 * Status flow: pending → assembling (set at entry) → caller sets rendering before PDF work.
 * On any unhandled error: job status is set to 'failed' before re-throwing.
 *
 * Decision refs: D-01 through D-09 (see 18-CONTEXT.md)
 */

import { getSql } from '@/lib/data-store/connection';
import { generateSection, generateGlobalThesis } from '@/lib/hamilton/generate';
import { validateNumerics } from '@/lib/hamilton/validate';
import { assembleNationalQuarterly, buildThesisSummary } from '@/lib/report-assemblers/national-quarterly';
import { assembleMonthlyPulse } from '@/lib/report-assemblers/monthly-pulse';
import { assemblePeerCompetitivePayload } from '@/lib/report-assemblers/peer-competitive';
import type { PeerCompetitiveFilters } from '@/lib/report-assemblers/peer-competitive';
import { renderNationalQuarterlyReport } from '@/lib/report-templates/templates/national-quarterly';
import { renderStateFeeIndexReport } from '@/lib/report-templates/templates/state-fee-index';
import { loadStateReportData } from '@/lib/research-report/load-state-report';
import { STATE_NAMES } from '@/lib/us-states';
import { renderMonthlyPulseReport } from '@/lib/report-templates/templates/monthly-pulse';
import { renderPeerCompetitiveReport } from '@/lib/report-templates/templates/peer-competitive';
import { runEditorReview } from '@/lib/report-engine/editor';
import type { SectionOutput, ThesisOutput, ValidatedSection } from '@/lib/hamilton/types';
import type { ReportType } from '@/lib/report-engine/types';

// ─── Fallback Narrative ────────────────────────────────────────────────────────

function fallbackNarrative(message: string): SectionOutput {
  return {
    narrative: message,
    wordCount: message.split(/\s+/).filter(Boolean).length,
    model: 'fallback',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// ─── Validation Helper ─────────────────────────────────────────────────────────

function validateAndWarn(
  section: string,
  output: SectionOutput,
  sourceData: Record<string, unknown>,
): void {
  const result = validateNumerics(output.narrative, sourceData);
  if (!result.passed) {
    console.warn(
      '[assembleAndRender] numeric validation failed:',
      section,
      result.inventedNumbers,
    );
  }
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Assemble data, generate Hamilton narratives, and render a complete HTML report.
 *
 * @param reportType - One of national_index | state_index | monthly_pulse | peer_brief
 * @param params - Report-specific parameters (state_code, charter_type, etc.)
 * @param jobId - report_jobs.id — used for status updates
 * @returns Complete HTML string ready for Playwright PDF conversion
 */
export async function assembleAndRender(
  reportType: ReportType,
  params: Record<string, unknown>,
  jobId: string,
): Promise<string> {
  const sql = getSql();

  // D-09: Mark job as assembling at entry
  await sql`UPDATE report_jobs SET status = 'assembling' WHERE id = ${jobId}`;

  try {
    switch (reportType) {
      case 'national_index': {
        const payload = await assembleNationalQuarterly();

        // Phase 33: Generate global thesis before sections (per D-01, D-04)
        // Thesis uses condensed payload (~5KB) not full payload.
        // Graceful degradation: if thesis fails, sections generate without it.
        let thesis: ThesisOutput | null = null;
        try {
          const summary = buildThesisSummary(payload);
          thesis = await generateGlobalThesis({ scope: 'quarterly', data: summary });
        } catch (thesisErr) {
          console.warn(
            '[assembleAndRender] thesis generation failed, continuing without thesis context:',
            thesisErr instanceof Error ? thesisErr.message : String(thesisErr),
          );
        }

        const thesisContext = thesis?.narrative_summary
          ? `GLOBAL THESIS (reference this in your analysis — your section is one argument in a unified report):\n${thesis.narrative_summary}\n\n`
          : '';

        // V3: Run 6 Hamilton calls in parallel — strategic framing
        const [
          execResult,
          diffResult,
          charterResult,
          revenueResult,
          blindSpotResult,
          futureResult,
        ] = await Promise.allSettled([
          generateSection({
            type: 'executive_summary',
            title: 'The Quarter in Figures — Executive Summary',
            data: {
              ...payload.derived,
              total_institutions: payload.total_institutions,
              fred_snapshot: payload.fred
                ? {
                    fed_funds_rate: payload.fred.fed_funds_rate,
                    unemployment_rate: payload.fred.unemployment_rate,
                    cpi_yoy_pct: payload.fred.cpi_yoy_pct,
                    as_of: payload.fred.as_of,
                  }
                : null,
              beige_book_themes: payload.district_headlines
                .slice(0, 5)
                .map((d) => `District ${d.district}: ${d.headline}`),
            },
            // Executive summary is exempt from the 150-200 word budget (SECTION-03).
            // It uses a 75-word cap because it's a condensed overview, not a body section.
            context: `${thesisContext}Write 2-3 sentences on what this quarter's national fee data shows. No preamble. Max 75 words. Where fred_snapshot or beige_book_themes are present, you may use one as context for the fee data. Say only what the DATA block shows. Do not tell any institution what to do.`,
          }),
          generateSection({
            type: 'trend_analysis',
            title: 'Where Prices Cluster and Where They Spread',
            data: {
              median_iqr_spread_pct: payload.derived.median_iqr_spread_pct,
              commoditized_count: payload.derived.commoditized_count,
              total_priced_categories: payload.derived.total_priced_categories,
              tightest_spreads: payload.derived.tightest_spreads,
              widest_spreads: payload.derived.widest_spreads,
            },
            context: `${thesisContext}Describe which fees cluster tightly around their median and which vary widely, using the spreads given. 2-3 sentences. Name the decision a pricing committee faces where spreads are wide or narrow, without choosing for it. Say only what the DATA block shows. Do not tell any institution what to do.`,
          }),
          generateSection({
            type: 'peer_comparison',
            title: 'Banks and Credit Unions',
            data: {
              bank_higher_count: payload.derived.bank_higher_count,
              cu_higher_count: payload.derived.cu_higher_count,
              comparable_count: payload.derived.comparable_count,
              biggest_bank_premiums: payload.derived.biggest_bank_premiums,
              biggest_cu_premiums: payload.derived.biggest_cu_premiums,
            },
            context: `${thesisContext}Compare bank and credit union medians using the premiums given. 2-3 sentences. Characterize a pattern only if the listed categories show it. Say only what the DATA block shows. Do not tell any institution what to do.`,
          }),
          generateSection({
            type: 'trend_analysis',
            title: 'Fee Income in Call Reports',
            data: {
              revenue: payload.revenue ?? null,
              revenue_per_institution: payload.derived.revenue_per_institution,
              bank_revenue_share_pct: payload.derived.bank_revenue_share_pct,
              cu_revenue_share_pct: payload.derived.cu_revenue_share_pct,
              fred_snapshot: payload.fred
                ? {
                    fed_funds_rate: payload.fred.fed_funds_rate,
                    cpi_yoy_pct: payload.fred.cpi_yoy_pct,
                    as_of: payload.fred.as_of,
                  }
                : null,
            },
            context: `${thesisContext}Describe the national service-charge income figures given (dollar amounts are in thousands of dollars), the year-over-year change and the bank and credit union shares. 2-3 sentences. Call reports do not split fee income by fee category, so do not attribute income to any category. Where fred_snapshot is present, you may compare the change with CPI. Say only what the DATA block shows. Do not tell any institution what to do.`,
          }),
          generateSection({
            type: 'findings',
            title: 'Data Coverage',
            data: {
              categories_with_data_count: payload.derived.categories_with_data_count,
              total_categories: payload.categories.length,
              strong_maturity_count: payload.derived.strong_maturity_count,
              provisional_maturity_count: payload.derived.provisional_maturity_count,
            },
            context: `${thesisContext}Describe how complete the fee data is, using the category and maturity counts given. 2-3 sentences. State plainly where the data is thin. Say only what the DATA block shows. Do not tell any institution what to do.`,
          }),
          generateSection({
            type: 'findings',
            title: 'What to Watch',
            data: {
              median_iqr_spread_pct: payload.derived.median_iqr_spread_pct,
              bank_higher_count: payload.derived.bank_higher_count,
              total_institutions: payload.total_institutions,
            },
            context: `${thesisContext}Name which open questions the next quarters of this data can settle, based only on the figures given. 2-3 sentences. No predictions stated as certain. Say only what the DATA block shows. Do not tell any institution what to do.`,
          }),
        ]);

        const executive_summary =
          execResult.status === 'fulfilled'
            ? execResult.value
            : fallbackNarrative('National fee medians, spreads and charter comparisons for this quarter are shown below.');
        const fee_differentiation =
          diffResult.status === 'fulfilled'
            ? diffResult.value
            : fallbackNarrative('The chart shows the fees whose prices cluster most tightly around the national median.');
        const banks_vs_credit_unions =
          charterResult.status === 'fulfilled'
            ? charterResult.value
            : fallbackNarrative('The chart compares bank and credit union medians where both publish the fee.');
        const revenue_reality =
          revenueResult.status === 'fulfilled'
            ? revenueResult.value
            : fallbackNarrative('Revenue data sourced from FDIC Call Reports and NCUA 5300 filings.');
        const industry_blind_spot =
          blindSpotResult.status === 'fulfilled'
            ? blindSpotResult.value
            : fallbackNarrative('Coverage counts by category are shown below.');
        const future_strategy =
          futureResult.status === 'fulfilled'
            ? futureResult.value
            : fallbackNarrative('Spread and coverage figures for this quarter are shown below.');

        // D-07: Validate numerics on key sections
        const derivedData = payload.derived as unknown as Record<string, unknown>;
        validateAndWarn('executive_summary', executive_summary, derivedData);
        validateAndWarn('fee_differentiation', fee_differentiation, derivedData);
        validateAndWarn('banks_vs_credit_unions', banks_vs_credit_unions, derivedData);

        // Phase 37: Editor v2 — validate sections against thesis before rendering
        // Build minimal ValidatedSection wrappers for fulfilled section outputs only.
        // Editor review is informational — does not block rendering on flag results.
        const passedValidation = { passed: true, inventedNumbers: [] as string[], checkedCount: 0, sourceValues: [] as number[] };
        const editorSections: ValidatedSection[] = [];
        if (execResult.status === 'fulfilled') {
          editorSections.push({ ...executive_summary, validation: passedValidation, input: { type: 'executive_summary' as const, title: 'The Quarter in Figures — Executive Summary', data: { ...(payload.derived as unknown as Record<string, unknown>), total_institutions: payload.total_institutions } } });
        }
        if (diffResult.status === 'fulfilled') {
          editorSections.push({ ...fee_differentiation, validation: passedValidation, input: { type: 'trend_analysis' as const, title: 'Where Prices Cluster and Where They Spread', data: { median_iqr_spread_pct: payload.derived.median_iqr_spread_pct, commoditized_count: payload.derived.commoditized_count } } });
        }
        if (charterResult.status === 'fulfilled') {
          editorSections.push({ ...banks_vs_credit_unions, validation: passedValidation, input: { type: 'peer_comparison' as const, title: 'Banks and Credit Unions', data: { bank_higher_count: payload.derived.bank_higher_count, cu_higher_count: payload.derived.cu_higher_count } } });
        }
        if (revenueResult.status === 'fulfilled') {
          editorSections.push({ ...revenue_reality, validation: passedValidation, input: { type: 'trend_analysis' as const, title: 'Fee Income in Call Reports', data: { revenue: payload.revenue ?? null, revenue_per_institution: payload.derived.revenue_per_institution } } });
        }
        if (blindSpotResult.status === 'fulfilled') {
          editorSections.push({ ...industry_blind_spot, validation: passedValidation, input: { type: 'findings' as const, title: 'Data Coverage', data: { categories_with_data_count: payload.derived.categories_with_data_count, total_categories: payload.categories.length } } });
        }
        if (futureResult.status === 'fulfilled') {
          editorSections.push({ ...future_strategy, validation: passedValidation, input: { type: 'findings' as const, title: 'What to Watch', data: { median_iqr_spread_pct: payload.derived.median_iqr_spread_pct, bank_higher_count: payload.derived.bank_higher_count, total_institutions: payload.total_institutions } } });
        }

        if (editorSections.length > 0) {
          try {
            const editorResult = await runEditorReview(editorSections, thesis);
            console.info('[assembleAndRender] editor review:', {
              approved: editorResult.approved,
              majorFlags: editorResult.flaggedSections.filter(f => f.severity === 'major').length,
              minorFlags: editorResult.flaggedSections.filter(f => f.severity === 'minor').length,
              reviewNote: editorResult.reviewNote,
            });
            if (!editorResult.approved) {
              console.warn('[assembleAndRender] editor major flags:', editorResult.flaggedSections.filter(f => f.severity === 'major'));
            }
          } catch (editorErr) {
            // Editor review is informational in this phase — do not block rendering
            console.warn(
              '[assembleAndRender] editor review failed, continuing with rendering:',
              editorErr instanceof Error ? editorErr.message : String(editorErr),
            );
          }
        }

        return renderNationalQuarterlyReport({
          data: payload,
          narratives: {
            executive_summary,
            fee_differentiation,
            banks_vs_credit_unions,
            revenue_reality,
            industry_blind_spot,
            future_strategy,
          },
        });
      }

      case 'state_index': {
        // T-18-01: state_code guarded; an unknown or missing code fails the job.
        const stateCode = typeof params.state_code === 'string' ? params.state_code.toUpperCase() : '';
        if (!STATE_NAMES[stateCode]) {
          throw new Error(`state_index needs a valid state_code (got ${JSON.stringify(params.state_code ?? null)})`);
        }

        // Deterministic: the public state report's readers and computations, no model calls.
        const data = await loadStateReportData(stateCode, {
          includeAllCategories: params.include_all_categories === true,
        });
        return renderStateFeeIndexReport({ data, generatedAt: new Date().toISOString().slice(0, 10) });
      }

      case 'monthly_pulse': {
        const payload = await assembleMonthlyPulse();

        const pulseData = {
          period_label: payload.period_label,
          window: `${payload.window_start} to ${payload.report_date}`,
          confirmed_fee_changes: payload.changes.length,
          increases: payload.changes.filter((c) => c.direction === 'up').length,
          decreases: payload.changes.filter((c) => c.direction === 'down').length,
          changes: payload.changes.slice(0, 10).map((c) => ({
            institution: c.institution_name,
            state: c.state_code,
            fee: c.display_name,
            was: c.old_amount,
            now: c.new_amount,
          })),
          institutions_with_live_fees: payload.coverage.institutions_live,
          institutions_added_this_month: payload.coverage.institutions_added_in_window,
        };

        let pulse_overview: SectionOutput;
        try {
          pulse_overview = await generateSection({
            type: 'overview',
            title: `Fee changes at the same institutions, ${payload.period_label}`,
            data: pulseData,
            context:
              'Write one short paragraph, 120 words maximum. Describe the confirmed fee changes at the same institutions and what they show. ' +
              'Coverage grew this month, so do not describe national medians or any market-wide price move. ' +
              'If there are no confirmed changes, say so plainly. Do not advise any institution to change a fee.',
          });
          validateAndWarn('pulse_overview', pulse_overview, pulseData);
        } catch {
          pulse_overview = fallbackNarrative(
            'Confirmed fee changes at the same institutions are listed below.',
          );
        }

        return renderMonthlyPulseReport({ data: payload, narratives: { pulse_overview } });
      }

      case 'peer_brief': {
        const filters: PeerCompetitiveFilters = {
          charter_type:
            typeof params.charter_type === 'string'
              ? params.charter_type
              : undefined,
          asset_tiers: Array.isArray(params.asset_tiers)
            ? (params.asset_tiers as string[])
            : undefined,
          fed_districts: Array.isArray(params.fed_districts)
            ? (params.fed_districts as number[])
            : undefined,
        };

        const payload = await assemblePeerCompetitivePayload(filters);

        const execSection = payload.sections.find(
          (s) => s.include && s.section_type === 'executive_summary',
        );
        const featuredSection = payload.sections.find(
          (s) => s.include && s.section_type === 'peer_competitive',
        );

        const [execResult, featuredResult] = await Promise.allSettled([
          execSection
            ? generateSection({
                type: 'executive_summary',
                title: execSection.title,
                data: execSection.data,
              })
            : Promise.reject(new Error('No executive_summary section available')),
          featuredSection
            ? generateSection({
                type: 'peer_competitive',
                title: featuredSection.title,
                data: featuredSection.data,
              })
            : Promise.reject(new Error('No peer_competitive section available')),
        ]);

        const executive_summary =
          execResult.status === 'fulfilled'
            ? execResult.value
            : fallbackNarrative(
                'Competitive analysis data is presented in the tables below.',
              );
        const featured_fees =
          featuredResult.status === 'fulfilled'
            ? featuredResult.value
            : fallbackNarrative(
                'Competitive analysis data is presented in the tables below.',
              );

        if (execSection) {
          validateAndWarn('executive_summary', executive_summary, execSection.data);
        }
        if (featuredSection) {
          validateAndWarn('featured_fees', featured_fees, featuredSection.data);
        }

        return renderPeerCompetitiveReport({
          data: payload.data,
          narratives: { executive_summary, featured_fees },
        });
      }

      default: {
        // TypeScript exhaustiveness — should never reach here
        throw new Error(`Unknown report_type: ${String(reportType)}`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`UPDATE report_jobs SET status = 'failed', error = ${message} WHERE id = ${jobId}`;
    throw err;
  }
}
