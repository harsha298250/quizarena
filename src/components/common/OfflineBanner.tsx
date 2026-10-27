/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineBanner: React.FC<{ isDemoMode?: boolean }> = ({ isDemoMode = false }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && !isDemoMode) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border-2 border-[#16120E] bg-[#FFC83D] px-3.5 py-2 text-xs font-bold text-[#16120E] shadow-[3px_3px_0px_#16120E] animate-bounce">
      <span className="h-2.5 w-2.5 rounded-full bg-[#FF5A36] animate-ping" />
      {!isOnline
        ? 'Offline Mode — Cached data active. Will auto-sync when online.'
        : 'Demo / BroadcastChannel Mode: Local multi-tab real-time sync active.'}
    </div>
  );
};
