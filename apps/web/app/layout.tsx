import type { Metadata } from 'next';
import * as React from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Web3 Operations Dashboard',
  description:
    'Multi-chain operations dashboard: wallet consent, contract import, portfolio and allowance scans, strategies, Permit2, CREATE2, delegations, and Telegram approvals.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
