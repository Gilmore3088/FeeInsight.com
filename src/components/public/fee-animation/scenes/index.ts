import type { GuideAnimationScene } from "@/lib/guides/types";
import type { FeeScene } from "../types";
import { ATM_FEES_SCENE } from "./atm-fees";

/** Every scene a guide can place, by the id its `animation` block names. */
export const FEE_SCENES: Record<GuideAnimationScene, FeeScene> = {
  atm_two_fee: ATM_FEES_SCENE,
};
