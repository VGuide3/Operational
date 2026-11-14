'use client';

import * as React from 'react';
import { useConnect } from 'wagmi';
import {
  WalletConnectModal as CanonicalModal,
  type ModalContext,
  type ModalEvent,
} from '@ops/ui';

/**
 * Dashboard host for the canonical wallet-connect / consent modal.
 *
 * This is intentionally a thin adapter: the modal itself is the single @ops/ui
 * component shared with the embed runtime, so the consent flow cannot diverge
 * between the two surfaces.
 */
export function WalletConnectModal({
  context,
  onEvent,
  requestingOrigin,
  appOrigin,
}: {
  context: ModalContext;
  onEvent: (event: ModalEvent) => void;
  requestingOrigin: string;
  appOrigin: string;
}) {
  const { connectors } = useConnect();
  const wallets = connectors.map((c) => ({ id: c.id, name: c.name ?? c.id, installed: true }));

  return React.createElement(CanonicalModal, {
    context,
    onEvent,
    wallets,
    requestingOrigin,
    appOrigin,
    termsUrl: '/terms',
    privacyUrl: '/privacy',
  });
}
