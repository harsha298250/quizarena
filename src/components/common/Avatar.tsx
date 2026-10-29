/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AvatarConfig, resolveAvatarConfig } from '../../types/avatar';

interface AvatarProps {
  config?: AvatarConfig | string | null;
  seed?: string;
  size?: number;
  className?: string;
  alt?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  config,
  seed = 'player',
  size = 48,
  className = '',
  alt,
}) => {
  const c = resolveAvatarConfig(config, seed);
  const strokeColor = '#16120E';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`shrink-0 select-none overflow-hidden rounded-full ${className}`}
      role="img"
      aria-label={alt || `Avatar sticker for ${seed}`}
    >
      {/* 1. Badge Background */}
      <circle
        cx="50"
        cy="50"
        r="48"
        fill={c.backgroundColor}
        stroke={strokeColor}
        strokeWidth="3.5"
      />

      {/* 2. Headphones Headband (Behind head) */}
      {c.accessory === 'headphones' && (
        <path
          d="M 22 48 A 29 29 0 0 1 78 48"
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeLinecap="round"
        />
      )}

      {/* 3. Face Shape & Integrated Ears */}
      <g id="face-base">
        {c.faceShape === 'cat' && (
          <>
            {/* Cat Ears */}
            <polygon
              points="22,38 32,14 42,30"
              fill={c.skinColor}
              stroke={strokeColor}
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <polygon points="26,34 32,19 38,28" fill="#F472B6" />
            <polygon
              points="78,38 68,14 58,30"
              fill={c.skinColor}
              stroke={strokeColor}
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <polygon points="74,34 68,19 62,28" fill="#F472B6" />
            <circle
              cx="50"
              cy="56"
              r="30"
              fill={c.skinColor}
              stroke={strokeColor}
              strokeWidth="3.5"
            />
          </>
        )}

        {c.faceShape === 'bear' && (
          <>
            {/* Bear Ears */}
            <circle cx="26" cy="30" r="11" fill={c.skinColor} stroke={strokeColor} strokeWidth="3" />
            <circle cx="26" cy="30" r="5.5" fill="#F472B6" />
            <circle cx="74" cy="30" r="11" fill={c.skinColor} stroke={strokeColor} strokeWidth="3" />
            <circle cx="74" cy="30" r="5.5" fill="#F472B6" />
            <circle
              cx="50"
              cy="56"
              r="30"
              fill={c.skinColor}
              stroke={strokeColor}
              strokeWidth="3.5"
            />
          </>
        )}

        {c.faceShape === 'square' && (
          <rect
            x="22"
            y="26"
            width="56"
            height="56"
            rx="18"
            fill={c.skinColor}
            stroke={strokeColor}
            strokeWidth="3.5"
          />
        )}

        {c.faceShape === 'oval' && (
          <ellipse
            cx="50"
            cy="55"
            rx="29"
            ry="33"
            fill={c.skinColor}
            stroke={strokeColor}
            strokeWidth="3.5"
          />
        )}

        {c.faceShape === 'heart' && (
          <path
            d="M 50 86 C 24 72 20 48 20 38 C 20 27 30 22 42 26 C 46 28 50 32 50 32 C 50 32 54 28 58 26 C 70 22 80 27 80 38 C 80 48 76 72 50 86 Z"
            fill={c.skinColor}
            stroke={strokeColor}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
        )}

        {c.faceShape === 'round' && (
          <circle
            cx="50"
            cy="55"
            r="31"
            fill={c.skinColor}
            stroke={strokeColor}
            strokeWidth="3.5"
          />
        )}
      </g>

      {/* 4. Cheeks & Facial Accessories */}
      <g id="face-accessories">
        {c.accessory === 'blush' && (
          <>
            <ellipse cx="32" cy="62" rx="5" ry="3.5" fill="#F43F5E" opacity="0.6" />
            <ellipse cx="68" cy="62" rx="5" ry="3.5" fill="#F43F5E" opacity="0.6" />
          </>
        )}

        {c.accessory === 'bandage' && (
          <g transform="rotate(-6 50 58)">
            <rect
              x="41"
              y="55"
              width="18"
              height="7"
              rx="2.5"
              fill="#FEF3C7"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            <line x1="50" y1="56" x2="50" y2="61" stroke="#D97706" strokeWidth="1" />
          </g>
        )}

        {c.accessory === 'star-sticker' && (
          <polygon
            points="69,57 71,61 75,61 72,64 73,68 69,65 65,68 66,64 63,61 67,61"
            fill="#FACC15"
            stroke={strokeColor}
            strokeWidth="1.2"
          />
        )}

        {c.accessory === 'lightning' && (
          <polygon
            points="68,54 74,54 70,60 75,60 67,68 69,62 66,62"
            fill="#EF4444"
            stroke={strokeColor}
            strokeWidth="1.2"
          />
        )}

        {c.accessory === 'headphones' && (
          <>
            <rect
              x="15"
              y="44"
              width="10"
              height="20"
              rx="5"
              fill="#16120E"
              stroke="#FFF"
              strokeWidth="1"
            />
            <rect
              x="75"
              y="44"
              width="10"
              height="20"
              rx="5"
              fill="#16120E"
              stroke="#FFF"
              strokeWidth="1"
            />
          </>
        )}

        {c.accessory === 'bowtie' && (
          <g>
            <polygon
              points="38,83 50,88 38,93"
              fill="#EF4444"
              stroke={strokeColor}
              strokeWidth="2"
            />
            <polygon
              points="62,83 50,88 62,93"
              fill="#EF4444"
              stroke={strokeColor}
              strokeWidth="2"
            />
            <circle cx="50" cy="88" r="3.5" fill="#B91C1C" stroke={strokeColor} strokeWidth="1.5" />
          </g>
        )}
      </g>

      {/* 5. Eyebrows */}
      <g id="eyebrows" stroke={strokeColor} strokeLinecap="round" fill="none">
        {c.eyebrows === 'natural' && (
          <>
            <path d="M 32 42 Q 38 39 44 42" strokeWidth="2.5" />
            <path d="M 56 42 Q 62 39 68 42" strokeWidth="2.5" />
          </>
        )}

        {c.eyebrows === 'bold' && (
          <>
            <path d="M 31 42 Q 38 39 45 42" strokeWidth="4" />
            <path d="M 55 42 Q 62 39 69 42" strokeWidth="4" />
          </>
        )}

        {c.eyebrows === 'raised' && (
          <>
            <path d="M 32 38 Q 38 33 44 38" strokeWidth="2.5" />
            <path d="M 56 38 Q 62 33 68 38" strokeWidth="2.5" />
          </>
        )}

        {c.eyebrows === 'determined' && (
          <>
            <line x1="32" y1="43" x2="44" y2="40" strokeWidth="3.5" />
            <line x1="56" y1="40" x2="68" y2="43" strokeWidth="3.5" />
          </>
        )}

        {c.eyebrows === 'playful' && (
          <>
            <path d="M 32 37 Q 38 32 44 37" strokeWidth="2.8" />
            <path d="M 56 43 Q 62 41 68 43" strokeWidth="2.8" />
          </>
        )}
      </g>

      {/* 6. Eyes */}
      <g id="eyes">
        {c.eyes === 'happy' && (
          <g stroke={strokeColor} strokeWidth="3.5" strokeLinecap="round" fill="none">
            <path d="M 32 50 Q 38 44 44 50" />
            <path d="M 56 50 Q 62 44 68 50" />
          </g>
        )}

        {c.eyes === 'wide' && (
          <>
            <circle cx="38" cy="50" r="6" fill={strokeColor} />
            <circle cx="36" cy="48" r="2.2" fill="#FFFFFF" />
            <circle cx="62" cy="50" r="6" fill={strokeColor} />
            <circle cx="60" cy="48" r="2.2" fill="#FFFFFF" />
          </>
        )}

        {c.eyes === 'wink' && (
          <>
            <circle cx="38" cy="50" r="6" fill={strokeColor} />
            <circle cx="36" cy="48" r="2.2" fill="#FFFFFF" />
            <path
              d="M 56 51 L 62 46 L 68 51"
              fill="none"
              stroke={strokeColor}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {c.eyes === 'cool' && (
          <g stroke={strokeColor} strokeWidth="3.5" strokeLinecap="round">
            <line x1="32" y1="50" x2="44" y2="50" />
            <line x1="56" y1="50" x2="68" y2="50" />
            <circle cx="38" cy="53" r="1.5" fill={strokeColor} stroke="none" />
            <circle cx="62" cy="53" r="1.5" fill={strokeColor} stroke="none" />
          </g>
        )}

        {c.eyes === 'sparkle' && (
          <g fill="#F59E0B" stroke={strokeColor} strokeWidth="1.2">
            <polygon points="38,44 40,49 45,51 40,53 38,58 36,53 31,51 36,49" />
            <polygon points="62,44 64,49 69,51 64,53 62,58 60,53 55,51 60,49" />
          </g>
        )}

        {c.eyes === 'dots' && (
          <>
            <circle cx="38" cy="50" r="3.5" fill={strokeColor} />
            <circle cx="62" cy="50" r="3.5" fill={strokeColor} />
          </>
        )}
      </g>

      {/* 7. Mouth */}
      <g id="mouth">
        {c.mouth === 'smile' && (
          <path
            d="M 42 66 Q 50 73 58 66"
            fill="none"
            stroke={strokeColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}

        {c.mouth === 'grin' && (
          <path
            d="M 41 65 Q 50 76 59 65 Z"
            fill="#FFFFFF"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        )}

        {c.mouth === 'laugh' && (
          <g>
            <path
              d="M 40 64 Q 50 78 60 64 Z"
              fill="#BE185D"
              stroke={strokeColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path d="M 46 72 Q 50 68 54 72 Q 50 76 46 72 Z" fill="#F472B6" />
          </g>
        )}

        {c.mouth === 'smirk' && (
          <path
            d="M 44 68 Q 53 70 60 63"
            fill="none"
            stroke={strokeColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}

        {c.mouth === 'whistle' && (
          <circle
            cx="50"
            cy="67"
            r="3.5"
            fill="#BE185D"
            stroke={strokeColor}
            strokeWidth="2"
          />
        )}

        {c.mouth === 'cat' && (
          <path
            d="M 43 65 Q 46.5 69 50 66 Q 53.5 69 57 65"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}
      </g>

      {/* 8. Glasses */}
      {c.glasses !== 'none' && (
        <g id="glasses">
          {c.glasses === 'round' && (
            <g stroke={strokeColor} strokeWidth="3" fill="rgba(255,255,255,0.25)">
              <circle cx="38" cy="50" r="10" />
              <circle cx="62" cy="50" r="10" />
              <line x1="48" y1="50" x2="52" y2="50" strokeWidth="3.5" />
            </g>
          )}

          {c.glasses === 'retro' && (
            <g stroke={strokeColor} strokeWidth="3.5" fill="rgba(255,255,255,0.2)">
              <rect x="27" y="41" width="20" height="17" rx="4" />
              <rect x="53" y="41" width="20" height="17" rx="4" />
              <line x1="47" y1="48" x2="53" y2="48" strokeWidth="4" />
            </g>
          )}

          {c.glasses === 'shades' && (
            <g>
              <path
                d="M 26 44 L 48 44 Q 48 58 37 58 Q 26 58 26 44 Z"
                fill="#16120E"
                stroke={strokeColor}
                strokeWidth="2"
              />
              <path
                d="M 52 44 L 74 44 Q 74 58 63 58 Q 52 58 52 44 Z"
                fill="#16120E"
                stroke={strokeColor}
                strokeWidth="2"
              />
              <line x1="48" y1="46" x2="52" y2="46" stroke={strokeColor} strokeWidth="3" />
              {/* Cool Catchlight Glare */}
              <line x1="30" y1="47" x2="35" y2="55" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
              <line x1="56" y1="47" x2="61" y2="55" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            </g>
          )}

          {c.glasses === 'star' && (
            <g fill="#FACC15" stroke={strokeColor} strokeWidth="2">
              <polygon points="38,40 41,47 48,47 42,52 45,59 38,55 31,59 34,52 28,47 35,47" />
              <polygon points="62,40 65,47 72,47 66,52 69,59 62,55 55,59 58,52 52,47 59,47" />
              <line x1="48" y1="49" x2="52" y2="49" stroke={strokeColor} strokeWidth="3" />
            </g>
          )}
        </g>
      )}

      {/* 9. Hair & Hat */}
      {c.hairHat !== 'none' && (
        <g id="hair-hat">
          {c.hairHat === 'messy' && (
            <path
              d="M 25 32 Q 32 15 42 22 Q 50 12 58 20 Q 68 14 74 30 Q 64 24 50 25 Q 36 24 25 32 Z"
              fill={strokeColor}
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          )}

          {c.hairHat === 'bob' && (
            <path
              d="M 22 45 C 22 24 35 18 50 18 C 65 18 78 24 78 45 C 78 52 76 56 74 58 C 72 45 68 32 50 32 C 32 32 28 45 26 58 C 24 56 22 52 22 45 Z"
              fill={strokeColor}
              stroke={strokeColor}
              strokeWidth="2"
            />
          )}

          {c.hairHat === 'curly' && (
            <g fill={strokeColor} stroke={strokeColor} strokeWidth="2">
              <circle cx="28" cy="28" r="9" />
              <circle cx="40" cy="21" r="10" />
              <circle cx="53" cy="20" r="10" />
              <circle cx="66" cy="23" r="9" />
              <circle cx="75" cy="32" r="8" />
            </g>
          )}

          {c.hairHat === 'cap' && (
            <g>
              {/* Cap Dome */}
              <path
                d="M 25 35 Q 50 14 75 35 Z"
                fill="#EF4444"
                stroke={strokeColor}
                strokeWidth="3"
                strokeLinejoin="round"
              />
              {/* Cap Visor */}
              <path
                d="M 22 36 Q 50 30 82 34 Q 50 42 22 36 Z"
                fill="#B91C1C"
                stroke={strokeColor}
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="50" cy="23" r="2.5" fill="#FACC15" />
            </g>
          )}

          {c.hairHat === 'beanie' && (
            <g>
              <path
                d="M 24 38 Q 50 12 76 38 Z"
                fill="#3B82F6"
                stroke={strokeColor}
                strokeWidth="3"
              />
              {/* Folded Brim */}
              <rect
                x="22"
                y="34"
                width="56"
                height="8"
                rx="3"
                fill="#1D4ED8"
                stroke={strokeColor}
                strokeWidth="2.5"
              />
              {/* Pompom */}
              <circle cx="50" cy="18" r="6" fill="#FACC15" stroke={strokeColor} strokeWidth="2" />
            </g>
          )}

          {c.hairHat === 'crown' && (
            <g>
              <polygon
                points="26,38 28,20 40,28 50,14 60,28 72,20 74,38"
                fill="#FACC15"
                stroke={strokeColor}
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="28" cy="20" r="2" fill="#EF4444" />
              <circle cx="50" cy="14" r="2.5" fill="#3B82F6" />
              <circle cx="72" cy="20" r="2" fill="#10B981" />
            </g>
          )}

          {c.hairHat === 'headband' && (
            <path
              d="M 21 34 Q 50 28 79 34 L 79 40 Q 50 34 21 40 Z"
              fill="#FFFFFF"
              stroke={strokeColor}
              strokeWidth="2.5"
            />
          )}
        </g>
      )}
    </svg>
  );
};

