"use client";

import type { GuideAnimationScene } from "@/lib/guides/types";
import { FeeAnimation } from "./fee-animation";
import { FEE_SCENES } from "./scenes";
import type { FeeSceneAction } from "./types";

/** A guide's `animation` block: the scene is looked up here so only its id crosses to the client. */
export function GuideAnimation({ scene, actions }: { scene: GuideAnimationScene; actions: FeeSceneAction[] }) {
  return <FeeAnimation scene={FEE_SCENES[scene]} actions={actions} />;
}
