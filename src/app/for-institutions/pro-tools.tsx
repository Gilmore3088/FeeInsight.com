import Link from "next/link";
import {
  Activity,
  BarChart3,
  FileText,
  MessageSquare,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SITE_NAME } from "@/lib/constants";
import { HamiltonBenchmarkPreview } from "./hamilton-benchmark-preview";
import { BODY, CTA_PRIMARY, CTA_SECONDARY, EYEBROW, GLASS, GLASS_SOFT, H2, LEAD } from "@/components/public/site-look";
import {
  HAMILTON_CANONICAL,
  PRO_SECTION_TITLE,
  PRO_SUBHEAD,
  type HamiltonMode,
} from "./hamilton-copy";

export { HAMILTON_CANONICAL, HAMILTON_MODES } from "./hamilton-copy";

interface ModeCard {
  mode: HamiltonMode;
  icon: LucideIcon;
  body: string;
}

/** What you do inside Hamilton, one card per mode. Not sibling tools. */
const MODE_CARDS: ModeCard[] = [
  {
    mode: "This month",
    icon: MessageSquare,
    body:
      "Hamilton opens with the few fees worth your attention, overdraft first, and what changed in " +
      "your market since you last looked. Observations, not instructions.",
  },
  {
    mode: "My fees",
    icon: Users,
    body:
      "See any of your fees against your own counties, your state, your Fed district, your peer group " +
      "and the nation, with the banks your customers can walk into named and the rules that apply.",
  },
  {
    mode: "Try a price",
    icon: Activity,
    body:
      "Put any prices side by side, including no fee at all: where each would sit, what it does to " +
      "fee income from your own figures, and the notice it needs. Hamilton doesn't pick one.",
  },
  {
    mode: "Reports",
    icon: FileText,
    body:
      "Turn a decision into a CEO one-pager or a pricing committee packet, or build a board-ready " +
      "brief with every figure cited to its source document.",
  },
];

const PRIMARY_BUTTON = CTA_PRIMARY;
const SECONDARY_BUTTON = CTA_SECONDARY;

export function ProToolsSection() {
  return (
    <section id="pro" aria-labelledby="pro-tools-title" className="scroll-mt-16">
      <div className="mx-auto max-w-page px-6 py-14 sm:py-16">
        <p className={EYEBROW}>{SITE_NAME} Pro</p>
        <h2 id="pro-tools-title" className={`mt-3 ${H2}`}>
          {PRO_SECTION_TITLE}
        </h2>
        <p className={`mt-3 ${LEAD}`}>{HAMILTON_CANONICAL}</p>
        <p className={`mt-3 ${BODY}`}>{PRO_SUBHEAD}</p>

        <HamiltonBenchmarkPreview className="mt-8" />

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5">
          {MODE_CARDS.map((card) => (
            <ModeCardView key={card.mode} card={card} />
          ))}
          <div className={`flex h-full flex-col justify-between p-6 ${GLASS}`}>
            <div>
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C44B2E]/10">
                <BarChart3 className="h-5 w-5 text-terra" />
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-warm-900">One plan, up to 5 people</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-warm-800">
                Monthly or annual, same workspace. Monthly plans cancel at the end of the period.
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link href="/subscribe" className={PRIMARY_BUTTON}>
                See pricing
              </Link>
              <Link href="/subscribe?plan=monthly" className={SECONDARY_BUTTON}>
                See monthly price
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeCardView({ card }: { card: ModeCard }) {
  const Icon = card.icon;
  return (
    <div className={`h-full p-6 ${GLASS_SOFT}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C44B2E]/10">
          <Icon className="h-5 w-5 text-terra" />
        </span>
        <h3 className="text-lg font-semibold tracking-tight text-warm-900">{card.mode}</h3>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-warm-800">{card.body}</p>
    </div>
  );
}
