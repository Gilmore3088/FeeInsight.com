import type { Metadata } from "next";
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { hamiltonFullName } from "@/lib/subscribe-reason";
import { DEMO_SAMPLE_INSTITUTION_ID, loadSampleReport } from "@/lib/custom-report/sample-report";
import { ContactForm, type ContactHeadings } from "./contact-form";
import { ContactScreen } from "./contact-screen";
import { hamiltonScreen } from "./contact-view";

export const metadata: Metadata = {
  title: "Contact",
  description: `Get in touch with ${SITE_NAME} about a Hamilton demo, Pro seats, the ${REPORT_OFFER.name}, Advisory work, data licensing, or anything else.`,
};

/**
 * /contact?source=demo is the Pro demo request (growth OS review M2): it reads as one, and we
 * reply to set a time. No booking link. Every other option keeps the general page. The heading
 * follows the option chosen in the form, so heading, button and reply always agree (code review 1).
 */
const HEADINGS: ContactHeadings = {
  demo: {
    title: "Ask for a Hamilton demo",
    intro: `We walk you through ${hamiltonFullName(SITE_NAME)}, using your own market.`,
    steps: [
      "We reply within one business day to set a time.",
      "We walk you through Hamilton using your institution and its local market, where we have their published schedules.",
      "If it fits, you pick a Pro plan, monthly or annual.",
    ],
  },
  general: {
    title: "Get in touch",
    intro: "Reports, Pro seats, data licensing or anything else. We typically respond within one business day.",
    steps: ["We reply within one business day."],
  },
};

const SCREEN_DEADLINE_MS = 2_500;

/** The live sample as a Hamilton screen; the page renders without it when the sample is slow or down. */
async function loadScreen() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SCREEN_DEADLINE_MS);
  });
  const screen = loadSampleReport()
    .then((report) => hamiltonScreen(report, DEMO_SAMPLE_INSTITUTION_ID))
    .catch(() => null);
  return Promise.race([screen, late]).finally(() => clearTimeout(timer));
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadScreen();

  return (
    <div className="bg-paper">
      <div className="mx-auto max-w-page px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <ContactForm
          searchParamsPromise={searchParams}
          headings={HEADINGS}
          aside={
            <>
              {screen && <ContactScreen screen={screen} />}
              <p className="text-[14px] text-ink-muted">
                Prefer email?{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                  {CONTACT_EMAIL}
                </a>
              </p>
            </>
          }
        />
      </div>
    </div>
  );
}
