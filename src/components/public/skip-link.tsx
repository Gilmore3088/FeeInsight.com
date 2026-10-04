/** First focusable element on every public page; jumps past the header to `#main-content`. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[110] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[#1A1815] focus:shadow-lg focus:ring-2 focus:ring-[#C44B2E]"
    >
      Skip to main content
    </a>
  );
}
