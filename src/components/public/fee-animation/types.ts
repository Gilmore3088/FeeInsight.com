/**
 * A fee animation is a scene: a short list of timed steps that shows how one fee works, from
 * the transaction to the charge, the reader's decision and the outcome. Each step carries the
 * caption a reader sees and the diagram state it ends on, so the same scene plays as motion,
 * stands still as a poster, or steps through one frame at a time under reduced motion.
 *
 * Scenes are data. One diagram (`scene-diagram.tsx`) draws every scene, so a new fee needs only
 * a new scene file. Every amount in a scene is illustrative and is labeled so on screen.
 */

/** What a step does in the story. */
export type FeeSceneStepKind = "transaction" | "charge" | "decision" | "outcome";

/** Simple drawings for the two parties in a scene. No people, no products, no logos. */
export type FeeSceneIcon =
  | "atm"
  | "bank"
  | "card"
  | "check"
  | "wire"
  | "phone"
  | "globe"
  | "store"
  | "box"
  | "calendar";

export type FeeSceneActor = {
  icon: FeeSceneIcon;
  /** Short: it sits under the drawing. */
  label: string;
};

/** One charge that can appear in the scene, under the party that charges it. */
export type FeeSceneCharge = {
  id: string;
  /** Short: it sits on the charge's tag. */
  label: string;
  /** A round, illustrative dollar amount. */
  amount: number;
  under: "left" | "right";
};

/** Which part of a frame moves in during its step. Everything else is already in place. */
export type FeeSceneIntro = "item" | "fork" | "total" | "lookFor" | (string & {});

/** What the diagram shows at the end of a step. */
export type FeeSceneFrame = {
  /** The transaction, drawn between the two parties. */
  item?: {
    label: string;
    amount?: number;
    /** A word under the item once the bank has acted on it. */
    status?: string;
    /** Draw the status as a problem (a returned item). */
    statusTone?: "neutral" | "alert";
    /** A card goes into the left party before the item comes out (an ATM withdrawal). */
    via?: "card";
  };
  /** Ids of the charges on screen, from the scene's `charges`. */
  charges: string[];
  /** The visible charges add into this total. */
  total?: { label: string; note?: string };
  /** Two ways a transaction can go; the chosen one is marked. */
  fork?: { a: string; b: string; chosen?: "a" | "b" };
  /** Things to look for, at most three short lines. */
  lookFor?: string[];
  /** The part that moves in during this step. */
  intro?: FeeSceneIntro;
};

export type FeeSceneStep = {
  id: string;
  kind: FeeSceneStepKind;
  durationMs: number;
  caption: string;
  frame: FeeSceneFrame;
};

export type FeeScene = {
  id: string;
  title: string;
  left: FeeSceneActor;
  right: FeeSceneActor;
  charges: FeeSceneCharge[];
  steps: FeeSceneStep[];
  /** The one thing to remember, shown on the poster and the end frame. */
  takeaway: string;
  /** What the end-state diagram shows, for screen readers. */
  describe: string;
};

/** A link on the end frame. */
export type FeeSceneAction = { label: string; href: string };
