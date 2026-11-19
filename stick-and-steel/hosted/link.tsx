import type { AnchorHTMLAttributes } from 'react';
export default function Link({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href === '/lab' ? '?view=lab' : href === '/' ? './' : href} />;
}
