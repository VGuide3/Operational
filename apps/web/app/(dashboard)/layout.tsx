import * as React from 'react';
import { Nav } from '../../components/nav';
import { WalletBar } from '../../components/wallet-bar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return React.createElement(
    'div',
    { className: 'ops-shell' },
    React.createElement(Nav),
    React.createElement('main', { className: 'ops-main' }, React.createElement(WalletBar), children),
  );
}
