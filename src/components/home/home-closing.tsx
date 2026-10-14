import { CONTAINER } from "./look";
import { WalkthroughForm } from "./walkthrough-form";

/** The navy band: one headline, one sentence, the walkthrough form. */
export function HomeClosing() {
  return (
    <section id="walkthrough" aria-labelledby="walkthrough-title" className="index-dark scroll-mt-20 bg-index-navy">
      <div className={`${CONTAINER} grid gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16`}>
        <div className="min-w-0">
          <h2 id="walkthrough-title" className="text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.015em] text-white sm:text-[2.25rem]">
            Request a free walkthrough
          </h2>
          <p className="mt-4 max-w-md text-pretty text-[17px] leading-relaxed text-index-muted-dark sm:text-[18px]">
            On a call at a time you pick, we walk through your own institution&apos;s published fees against your competitors&apos;.
          </p>
        </div>
        <div className="min-w-0">
          <WalkthroughForm />
        </div>
      </div>
    </section>
  );
}
