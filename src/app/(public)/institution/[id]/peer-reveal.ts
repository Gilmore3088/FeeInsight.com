/**
 * Ending at the institution page's peer explorer (#peers) after a link changes its set. The page
 * is cached and the explorer reads ?peers= in the browser (peer-explorer-island.tsx), so the
 * landing is done here rather than left to the browser or the router.
 */

/** Scrolls the explorer into view, leaving the address alone. */
function scrollToPeers(): void {
  document.getElementById("peers")?.scrollIntoView({ block: "start" });
}

/**
 * Brings the explorer into view after a link swapped its set, and puts #peers back in the address.
 * A soft navigation to the same cached page can drop the hash and leave the reader at the top
 * (James's Oct 20 review of the market card's compare link), so the scroll is explicit rather
 * than left to the browser or the router.
 */
export function revealPeers(): void {
  const url = new URL(window.location.href);
  if (url.hash !== "#peers") window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}#peers`);
  scrollToPeers();
}

type LinkClick = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented" | "preventDefault">;

/**
 * A click on a link to a peer set on this same page (`?peers=...#peers`) always ends at #peers
 * with the hash in the address. Left to Next's Link, the soft navigation sometimes scrolled to the
 * top and dropped #peers (James's phone review of #1887, 1 in 4 tries after a market chip change).
 * - The set is already the one asked for: no navigation, the explorer is revealed at once.
 * - Another set: the router changes ?peers= without scrolling (`scroll: false`), the explorer is
 *   scrolled into view now, and PeerExplorerFromAddress reveals it again once the new set shows.
 * A modified click (new tab, new window) or a link to another page is left to the browser.
 */
export function followPeerSetLink(event: LinkClick, href: string, push: (href: string, options: { scroll: boolean }) => void): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const here = new URL(window.location.href);
  const target = new URL(href, here);
  if (target.origin !== here.origin || target.pathname !== here.pathname) return;
  event.preventDefault();
  if (target.search === here.search) {
    revealPeers();
    return;
  }
  push(`${target.pathname}${target.search}#peers`, { scroll: false });
  scrollToPeers();
}
