/** The engine's storyline contract, re-exported for the Pro page's storyline components. */
import type { Exhibit } from "@/lib/hamilton/workspace/types";
import type { StorylineExhibit } from "@/lib/hamilton/workspace/storyline-types";

export type {
  ArchetypeKey,
  KeyFigure,
  StoryExhibit,
  StoryOption,
  Storyline,
  StorylineKind as StoryKind,
  StorylineView,
} from "@/lib/hamilton/workspace/storyline-types";

/** Every exhibit a storyline can carry. */
export type StoryExhibitData = Exhibit | StorylineExhibit;
