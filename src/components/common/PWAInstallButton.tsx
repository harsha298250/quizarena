/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="paper-btn paper-btn-sm bg-[#FF5A36] text-white hover:bg-[#ff471e] text-xs font-bold gap-1.5"
        title="Install QuizArena as an app on your device"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Install App
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="paper-btn paper-btn-sm bg-[#FFC83D] text-[#16120E] text-xs font-bold gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Install on iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="paper-card w-full max-w-sm bg-[#FFF6E5] p-6 text-[#16120E]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg font-['Bricolage_Grotesque'] text-[#FF5A36]">Install on iPhone / iPad</h3>
                <span className="sticker-badge bg-[#FFC83D]">PWA</span>
              </div>
              <p className="text-sm font-medium leading-relaxed text-[#16120E]">
                1. Tap the <strong>Share</strong> button in Safari’s bottom bar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.<br />
                3. Open QuizArena directly from your home screen for fullscreen real-time play!
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="paper-btn w-full mt-5 bg-[#14B8A6] text-white py-2"
              >
                Got It!
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
