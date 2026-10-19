import { permanentRedirect } from "next/navigation";

/** Keep one consumer home for existing /consumer links. */
export default function ConsumerPage() {
  permanentRedirect("/for-consumers");
}
