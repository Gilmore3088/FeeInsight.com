/** Sign-in and registration render without the site header; this gives them a main landmark. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content">{children}</main>;
}
