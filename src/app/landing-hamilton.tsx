import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { StoryExhibitView } from "@/components/hamilton/storyline/story-exhibits";
import type { StoryExhibit } from "@/lib/hamilton/workspace/storyline-types";
import { DISPLAY_H2, SAMPLE_REPORT_HREF, SANS, SECTION_INNER, TEXT_LINK } from "./landing-shared";

/**
 * The walkthrough video (James, Oct 17 05:27: he records it). Until it is set the section shows
 * a plain placeholder in its place. A poster keeps phones from showing a black box, and captions
 * are required (WebVTT).
 */
export const HAMILTON_VIDEO: { src: string; type: string; poster: string; captions: string } | null = null;

function HamiltonVideo() {
  if (HAMILTON_VIDEO) {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        poster={HAMILTON_VIDEO.poster}
        className="aspect-video w-full rounded-2xl border border-border bg-ink"
        aria-label="Hamilton walkthrough"
      >
        <source src={HAMILTON_VIDEO.src} type={HAMILTON_VIDEO.type} />
        <track kind="captions" src={HAMILTON_VIDEO.captions} srcLang="en" label="English" default />
        <a href={SAMPLE_REPORT_HREF}>Open the sample report</a>
      </video>
    );
  }
  // No play mark: nothing here plays yet, so nothing should look like a button.
  return (
    <div
      className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-border bg-surface-0 px-6 text-center"
      data-hamilton-video-placeholder=""
    >
      <p className="text-[15px] font-semibold text-ink-soft">Video walkthrough coming soon</p>
    </div>
  );
}

/**
 * The saved Hamilton answer the feature cards draw from: Capital City Bank's overdraft answer
 * (Oct 16, 2026). Swap the id (or set HAMILTON_SHOWCASE_ANSWER_ID) to use another saved answer.
 */
export const HAMILTON_SHOWCASE_ANSWER_ID = "5dbb59cf-64f7-45df-a679-9dc17182460a";

export function showcaseAnswerId(raw = process.env.HAMILTON_SHOWCASE_ANSWER_ID): string {
  return raw && /^[0-9a-f-]{36}$/i.test(raw.trim()) ? raw.trim() : HAMILTON_SHOWCASE_ANSWER_ID;
}

/** The four cards (James, Oct 17 08:25): each a title, one line and one of Hamilton's own exhibits. */
const FEATURES = [
  { kind: "fee_position", title: "Where each fee sits", line: "Your fee against peers your size, beside the state, Fed district and national medians." },
  { kind: "competitor_range", title: "Know competitors by name", line: "The banks and credit unions in your market, each price linked to its own fee schedule." },
  { kind: "structure_matrix", title: "Compare how fees are built", line: "Overdraft, NSF, transfer and continuous overdraft charges, side by side for each institution." },
  { kind: "money_at_stake", title: "Size the fee income", line: "The fee income your latest call report shows, beside total service charges." },
] as const;

export interface HamiltonShowcase {
  institutionName: string;
  /** The day the answer was saved, e.g. "Oct 16, 2026", so the figures never read as live. */
  savedOn: string | null;
  exhibits: StoryExhibit[];
}

function savedOnLabel(day: unknown): string | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The saved answer's exhibits the cards need, in card order; null unless all four are there. */
export function parseShowcase(row: { response_json: unknown; saved_on?: string | null } | null): HamiltonShowcase | null {
  const r = row?.response_json as { storyline?: { exhibits?: unknown }; identityContext?: { researchInstitutionName?: unknown } } | null;
  const all = Array.isArray(r?.storyline?.exhibits) ? (r.storyline.exhibits as StoryExhibit[]) : [];
  const name = r?.identityContext?.researchInstitutionName;
  const exhibits = FEATURES.map((f) => all.find((e) => e?.exhibit?.kind === f.kind && typeof e.actionTitle === "string"));
  if (typeof name !== "string" || exhibits.some((e) => !e)) return null;
  // The card text describes each exhibit, so the exhibit's own takeaway line is left out.
  return { institutionName: name, savedOn: savedOnLabel(row?.saved_on), exhibits: (exhibits as StoryExhibit[]).map((e) => ({ ...e, takeaway: undefined })) };
}

function FeatureCards({ showcase }: { showcase: HamiltonShowcase }) {
  return (
    <div className="mt-12 sm:mt-16" data-hamilton-features="">
      <ul className="grid gap-5 md:grid-cols-2">
        {FEATURES.map((f, i) => (
          <li key={f.kind} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-0">
            {/* Words first (centred on a phone, James 09:16), then Hamilton's own exhibit cropped like a product image:
                no frame headline, legend or source line, since the card's words describe it. */}
            <div className="px-5 pt-5 pb-4 text-center sm:px-6 sm:text-left">
              <h3 className="text-[18px] font-semibold text-ink">{f.title}</h3>
              <p className="mx-auto mt-1.5 max-w-md text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:max-w-none">{f.line}</p>
            </div>
            <div aria-hidden="true" inert className="relative h-52 overflow-hidden bg-paper px-5 pt-4 sm:h-60 sm:px-6 lg:h-72">
              <div className="fi-exhibit-crop pointer-events-none origin-top-left scale-[.92] [width:108.7%]">
                <StoryExhibitView item={showcase.exhibits[i]} number={i + 1} researchInstitutionName={showcase.institutionName} />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper to-transparent" />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-[13px] text-ink-muted">
        From Hamilton&rsquo;s answer on {showcase.institutionName}&rsquo;s overdraft fee{showcase.savedOn ? `, ${showcase.savedOn}` : ""}. Sources: each
        institution&rsquo;s published fee schedule and call report.
      </p>
    </div>
  );
}

/** Hamilton's own section (James, Oct 17): the name, two lines, the walkthrough video, four feature cards and two actions. */
export function LandingHamilton({ showcase = null }: { showcase?: HamiltonShowcase | null }) {
  return (
    <section id="hamilton" aria-labelledby="hamilton-heading" className="scroll-mt-20 border-t border-border bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="hamilton-heading" className={DISPLAY_H2} style={SANS}>
            Meet Hamilton
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-ink sm:text-[19px]">
            See your fee schedule beside named local competitors and peers, with the source behind every figure.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            <a href="/for-institutions#hamilton" className={TEXT_LINK}>
              Hamilton
            </a>{" "}
            is the workspace where bank and credit union teams track that position each month, try a price and build the committee report.
          </p>
        </div>
        {/* The placeholder stays smaller than the video will be, so the actions stay in view. */}
        <div className={`mx-auto mt-10 sm:mt-12 ${HAMILTON_VIDEO ? "max-w-5xl" : "max-w-3xl"}`}>
          <HamiltonVideo />
        </div>
        {showcase ? <FeatureCards showcase={showcase} /> : null}
        <div className="mx-auto mt-10 flex w-full max-w-sm flex-col items-center gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4" data-hamilton-actions="">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_hamilton" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary min-h-11 w-full justify-center sm:w-auto"
          >
            {PRO_PLANS_NAV.label}
          </TrackLink>
          <TrackLink
            event="sample_report_click"
            eventProps={{ placement: "home_hamilton" }}
            href={SAMPLE_REPORT_HREF}
            className="fi-btn fi-btn-secondary min-h-11 w-full justify-center sm:w-auto"
          >
            Open the sample report
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
