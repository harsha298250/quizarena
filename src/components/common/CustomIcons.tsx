/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// Custom Chunky Sticker-style SVG Icons (No generic emojis)

export const ShapeTriangle: React.FC<{ className?: string; fill?: string }> = ({
  className = 'w-6 h-6',
  fill = '#FF5A36',
}) => (
  <svg viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M20 6 L35 33 A2 2 0 0 1 33 35 L7 35 A2 2 0 0 1 5 33 Z"
      fill={fill}
      stroke="#16120E"
      strokeWidth="3.5"
      strokeLinejoin="round"
    />
  </svg>
);

export const ShapeDiamond: React.FC<{ className?: string; fill?: string }> = ({
  className = 'w-6 h-6',
  fill = '#FFC83D',
}) => (
  <svg viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect
      x="20"
      y="3"
      width="24"
      height="24"
      rx="3"
      transform="rotate(45 20 3)"
      fill={fill}
      stroke="#16120E"
      strokeWidth="3.5"
    />
  </svg>
);

export const ShapeCircle: React.FC<{ className?: string; fill?: string }> = ({
  className = 'w-6 h-6',
  fill = '#14B8A6',
}) => (
  <svg viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="16" fill={fill} stroke="#16120E" strokeWidth="3.5" />
  </svg>
);

export const ShapeSquare: React.FC<{ className?: string; fill?: string }> = ({
  className = 'w-6 h-6',
  fill = '#4DA3FF',
}) => (
  <svg viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="30" height="30" rx="6" fill={fill} stroke="#16120E" strokeWidth="3.5" />
  </svg>
);

export const FlameIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M12 2C10 6 6 8.5 6 14C6 17.5 8.7 20.5 12 20.5C15.3 20.5 18 17.5 18 14C18 9 14.5 5.5 12 2Z"
      fill="#FF5A36"
      stroke="#16120E"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M12 9C10.5 11 9 13 9 15.5C9 17.2 10.3 18.5 12 18.5C13.7 18.5 15 17.2 15 15.5C15 12.5 13.5 10.5 12 9Z"
      fill="#FFC83D"
      stroke="#16120E"
      strokeWidth="1.8"
    />
  </svg>
);

export const TrophyIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 5H24V14C24 18.4 20.4 22 16 22C11.6 22 8 18.4 8 14V5Z"
      fill="#FFC83D"
      stroke="#16120E"
      strokeWidth="2.5"
    />
    <path d="M8 8H4C3 8 2 9 2 10C2 13 4 15 7 15H8" stroke="#16120E" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M24 8H28C29 8 30 9 30 10C30 13 28 15 25 15H24" stroke="#16120E" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M16 22V27M11 27H21" stroke="#16120E" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const ShieldIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M12 2L4 6V11C4 16.5 7.5 21 12 22C16.5 21 20 16.5 20 11V6L12 2Z"
      fill="#14B8A6"
      stroke="#16120E"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path d="M9 12L11 14L15 10" stroke="#FFF6E5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LightningIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon
      points="13 2 4 14 11 14 9 22 20 10 13 10 15 2"
      fill="#FFC83D"
      stroke="#16120E"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
  </svg>
);

import { Avatar } from './Avatar';
import { AvatarConfig } from '../../types/avatar';

// Illustrated Avatar Badges
export const AvatarBadge: React.FC<{
  avatarId?: string;
  config?: AvatarConfig | string;
  size?: number;
  className?: string;
}> = ({
  avatarId,
  config,
  size = 48,
  className = '',
}) => {
  return (
    <Avatar
      config={config || avatarId}
      seed={typeof avatarId === 'string' ? avatarId : 'player'}
      size={size}
      className={className}
    />
  );
};
