/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineBanner: React.FC<{ isDemoMode?: boolean }> = ({ isDemoMode = false }) => {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  // Only show when truly offline or in demo mode
  if ((isOnline && !isDemoMode) || dismissed) {
    return null;
  }

  return (
    <aside
      aria-label="Network status notification"
      className="fixed bottom-3 left-4 z-40 flex items-center gap-2 rounded-full border-2 border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_var(--shadow)] transition-all select-none"
    >
      <span
        className={`h-2 w-2 rounded-full ${
          !isOnline ? 'bg-[var(--accent)] animate-ping' : 'bg-[var(--accent-2)]'
        }`}
        aria-hidden="true"
      />
      <span className="text-[11px]">
        {!isOnline ? 'Offline Mode (Local Cache)' : 'Demo Sync (BroadcastChannel)'}
      </span>
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
