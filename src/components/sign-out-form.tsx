/**
 * Sign out as a plain form post to /api/auth/logout. No client JavaScript or Server Action,
 * so it still works on a page left open across a deploy, and the page reload that follows
 * clears every cached view of the session.
 */
export function SignOutForm({
  next,
  className,
  buttonClassName,
  label = "Sign out",
}: {
  next?: string;
  className?: string;
  buttonClassName?: string;
  label?: string;
}) {
  return (
    <form action="/api/auth/logout" method="POST" className={className}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button type="submit" className={buttonClassName}>
        {label}
      </button>
    </form>
  );
}
