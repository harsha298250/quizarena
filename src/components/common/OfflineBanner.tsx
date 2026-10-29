/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export interface OfflineBannerProps {
  isDemoMode?: boolean;
  isFirebaseOnline?: boolean;
  isSignedIn?: boolean;
  isReconnecting?: boolean;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  isDemoMode = false,
  isFirebaseOnline = true,
  isSignedIn = false,
  isReconnecting = false,
}) => {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [showConnectedBriefly, setShowConnectedBriefly] = useState(false);

  // Monitor reconnect transitions to show brief "Connected" confirmation
  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      setDismissed(false);
    } else if (wasOffline && isOnline) {
      setShowConnectedBriefly(true);
      const timer = setTimeout(() => {
        setShowConnectedBriefly(false);
        setWasOffline(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  // If user is authenticated and browser is online, they are NOT in demo mode
  const trulyDemo = isDemoMode && !isSignedIn && isOnline && !isFirebaseOnline;

  // Determine current connection state
  let statusText = '';
  let dotColor = '';
  let shouldDisplay = false;

  if (!isOnline) {
    statusText = 'Offline (Local Cache Active)';
    dotColor = 'bg-red-500 animate-pulse';
    shouldDisplay = true;
  } else if (isReconnecting) {
    statusText = 'Reconnecting to Arena...';
    dotColor = 'bg-amber-500 animate-pulse';
    shouldDisplay = true;
  } else if (showConnectedBriefly) {
    statusText = 'Connected to Arena';
    dotColor = 'bg-green-500';
    shouldDisplay = true;
  } else if (trulyDemo) {
    statusText = 'Demo Sync (BroadcastChannel)';
    dotColor = 'bg-[var(--accent-2)]';
    shouldDisplay = true;
  }

  if (!shouldDisplay || dismissed) {
    return null;
  }

  return (
    <aside
      aria-label="Network status notification"
      className="fixed bottom-3 left-4 z-40 flex items-center gap-2 rounded-full border-2 border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_var(--shadow)] transition-all select-none animate-fadeIn"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} aria-hidden="true" />
      <span className="text-[11px] font-bold">{statusText}</span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-1 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] leading-none"
        title="Dismiss status indicator"
        aria-label="Dismiss status indicator"
      >
        ✕
      </button>
    </aside>
  );
};
