/**
 * Opens the site search from anywhere (header button, mobile drawer) without faking a
 * Cmd+K keypress. SearchModal listens for this event; Cmd/Ctrl+K still works.
 */
export const OPEN_SEARCH_EVENT = "fi:open-search";

export function openSearch(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}
