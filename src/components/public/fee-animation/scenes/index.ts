import type { GuideAnimationScene } from "@/lib/guides/types";
import type { FeeScene } from "../types";
import { ACCOUNT_CLOSURE_FEES_SCENE } from "./account-closure-fees";
import { ATM_FEES_SCENE } from "./atm-fees";
import { CHECK_FEES_SCENE } from "./check-fees";
import { DIGITAL_BANKING_FEES_SCENE } from "./digital-banking-fees";
import { FOREIGN_TRANSACTION_FEES_SCENE } from "./foreign-transaction-fees";
import { MONTHLY_MAINTENANCE_FEES_SCENE } from "./monthly-maintenance-fees";
import { NSF_FEES_SCENE } from "./nsf-fees";
import { OVERDRAFT_FEES_SCENE } from "./overdraft-fees";
import { SAFE_DEPOSIT_FEES_SCENE } from "./safe-deposit-fees";
import { WIRE_TRANSFER_FEES_SCENE } from "./wire-transfer-fees";

/** Every scene a guide can place, by the id its `animation` block names. */
export const FEE_SCENES: Record<GuideAnimationScene, FeeScene> = {
  atm_two_fee: ATM_FEES_SCENE,
  overdraft: OVERDRAFT_FEES_SCENE,
  nsf: NSF_FEES_SCENE,
  wire_transfer: WIRE_TRANSFER_FEES_SCENE,
  monthly_maintenance: MONTHLY_MAINTENANCE_FEES_SCENE,
  foreign_transaction: FOREIGN_TRANSACTION_FEES_SCENE,
  check_stop_payment: CHECK_FEES_SCENE,
  digital_speed: DIGITAL_BANKING_FEES_SCENE,
  dormant_account: ACCOUNT_CLOSURE_FEES_SCENE,
  safe_deposit: SAFE_DEPOSIT_FEES_SCENE,
};
