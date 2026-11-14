'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/allowances', label: 'Allowances' },
  { href: '/contracts', label: 'Contracts' },
  { href: '/strategies', label: 'Strategies' },
  { href: '/runs', label: 'Runs' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/delegations', label: 'Delegations' },
  { href: '/deployments', label: 'Deployments' },
  { href: '/audit', label: 'Audit' },
];

export function Nav() {
  const pathname = usePathname();
  return React.createElement(
    'nav',
    { className: 'ops-nav', 'aria-label': 'Primary' },
    React.createElement('h1', { style: { fontSize: 16 } }, 'Web3 Ops'),
    LINKS.map((link) =>
      React.createElement(
        Link,
        { key: link.href, href: link.href, 'aria-current': pathname === link.href ? 'page' : undefined },
        link.label,
      ),
    ),
  );
}
