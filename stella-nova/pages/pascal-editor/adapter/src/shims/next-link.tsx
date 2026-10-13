// Stand-in for next/link. It renders a plain <a>. The static page has one
// route, so a root link ("/") points to this page.
import { type AnchorHTMLAttributes, forwardRef } from 'react'

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string }
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, ...rest },
  ref,
) {
  const raw = typeof href === 'string' ? href : (href.pathname ?? '/')
  const to = raw === '/' ? './' : raw.startsWith('/') && !raw.startsWith('//') ? `.${raw}` : raw
  return <a {...rest} href={to} ref={ref} />
})

export default Link
