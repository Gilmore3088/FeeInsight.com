import Link from "next/link";

/**
 * A trail back to a screen's parents. The admin top bar and room menu already
 * show where you are, so a leading link to the dashboard ("/admin") is dropped,
 * and a trail with nothing left but the current page is not drawn at all.
 */
export function trailFor(items: { label: string; href?: string }[]) {
  let start = 0;
  while (start < items.length && items[start].href === "/admin") start += 1;
  const trail = items.slice(start);
  return trail.length > 1 ? trail : [];
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  const trail = trailFor(items);
  if (trail.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 text-sm text-gray-500 mb-1"
    >
      <ol className="flex flex-wrap items-center gap-2">
        {trail.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-gray-300">/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-gray-900">
                {item.label}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="text-gray-700 font-medium"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
