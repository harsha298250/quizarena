/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { sound } from '../lib/sound';

/**
 * Subscribe a component to the global SoundManager mute state so UI controls
 * across Settings, PlayerShell, Navbar, and Lobby stay synchronized.
 */
export function useSoundMuted(): [boolean, () => boolean] {
  const [isMuted, setIsMuted] = useState<boolean>(() => sound.getMuted());

  useEffect(() => {
    setIsMuted(sound.getMuted());
    return sound.subscribe(setIsMuted);
  }, []);

  const toggleMute = useCallback(() => {
    const next = sound.toggleMute();
    if (!next) {
      sound.playClick();
    }
    return next;
  }, []);

  return [isMuted, toggleMute];
}

