/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type FaceShape = 'round' | 'square' | 'oval' | 'heart' | 'cat' | 'bear';
export type EyeStyle = 'happy' | 'wide' | 'wink' | 'cool' | 'sparkle' | 'dots';
export type EyebrowStyle = 'natural' | 'bold' | 'raised' | 'determined' | 'playful';
export type MouthStyle = 'smile' | 'grin' | 'laugh' | 'smirk' | 'whistle' | 'cat';
export type HairHatStyle = 'none' | 'messy' | 'bob' | 'curly' | 'cap' | 'beanie' | 'crown' | 'headband';
export type GlassesStyle = 'none' | 'round' | 'retro' | 'shades' | 'star';
export type AccessoryStyle = 'none' | 'blush' | 'bandage' | 'star-sticker' | 'lightning' | 'headphones' | 'bowtie';

export interface AvatarConfig {
  faceShape: FaceShape;
  skinColor: string;
  backgroundColor: string;
  eyes: EyeStyle;
  eyebrows: EyebrowStyle;
  mouth: MouthStyle;
  hairHat: HairHatStyle;
  glasses: GlassesStyle;
  accessory: AccessoryStyle;
}

export const FACE_SHAPES: { id: FaceShape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Squircle' },
  { id: 'oval', label: 'Oval' },
  { id: 'heart', label: 'Heart' },
  { id: 'cat', label: 'Cat Ears' },
  { id: 'bear', label: 'Bear Ears' },
];

export const SKIN_COLORS: { id: string; label: string; color: string }[] = [
  { id: '#FED7AA', label: 'Light Warm', color: '#FED7AA' },
  { id: '#FDBA74', label: 'Peach', color: '#FDBA74' },
  { id: '#F59E0B', label: 'Golden Honey', color: '#F59E0B' },
  { id: '#D97706', label: 'Bronze', color: '#D97706' },
  { id: '#854D0E', label: 'Chestnut', color: '#854D0E' },
  { id: '#451A03', label: 'Espresso', color: '#451A03' },
  { id: '#38BDF8', label: 'Sky Teal', color: '#38BDF8' },
  { id: '#C084FC', label: 'Lavender', color: '#C084FC' },
  { id: '#4ADE80', label: 'Lime Monster', color: '#4ADE80' },
  { id: '#F472B6', label: 'Bubblegum', color: '#F472B6' },
];

export const BG_COLORS: { id: string; label: string; color: string }[] = [
  { id: '#FFC83D', label: 'Sunshine', color: '#FFC83D' },
  { id: '#CF330D', label: 'Tomato', color: '#CF330D' },
  { id: '#0D7A70', label: 'Teal', color: '#0D7A70' },
  { id: '#0369A1', label: 'Sky', color: '#0369A1' },
  { id: '#8B5CF6', label: 'Purple', color: '#8B5CF6' },
  { id: '#EC4899', label: 'Pink', color: '#EC4899' },
  { id: '#10B981', label: 'Emerald', color: '#10B981' },
  { id: '#FFF6E5', label: 'Cream', color: '#FFF6E5' },
];

export const EYE_STYLES: { id: EyeStyle; label: string }[] = [
  { id: 'happy', label: 'Happy Arcs' },
  { id: 'wide', label: 'Wide Shine' },
  { id: 'wink', label: 'Cheeky Wink' },
  { id: 'cool', label: 'Cool Focus' },
  { id: 'sparkle', label: 'Star Sparkle' },
  { id: 'dots', label: 'Kawaii Dots' },
];

export const EYEBROW_STYLES: { id: EyebrowStyle; label: string }[] = [
  { id: 'natural', label: 'Natural' },
  { id: 'bold', label: 'Bold' },
  { id: 'raised', label: 'Raised Curious' },
  { id: 'determined', label: 'Determined' },
  { id: 'playful', label: 'Playful Quirk' },
];

export const MOUTH_STYLES: { id: MouthStyle; label: string }[] = [
  { id: 'smile', label: 'Warm Smile' },
  { id: 'grin', label: 'Toothy Grin' },
  { id: 'laugh', label: 'Laughing' },
  { id: 'smirk', label: 'Confident Smirk' },
  { id: 'whistle', label: 'Surprised / O' },
  { id: 'cat', label: 'Kitty :3' },
];

export const HAIR_HAT_STYLES: { id: HairHatStyle; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'messy', label: 'Spiky Tufts' },
  { id: 'bob', label: 'Chic Bob' },
  { id: 'curly', label: 'Fluffy Curls' },
  { id: 'cap', label: 'Snapback Cap' },
  { id: 'beanie', label: 'Knit Beanie' },
  { id: 'crown', label: 'Paper Crown' },
  { id: 'headband', label: 'Headband' },
];

export const GLASSES_STYLES: { id: GlassesStyle; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Round Scholar' },
  { id: 'retro', label: 'Retro Square' },
  { id: 'shades', label: 'Dark Aviators' },
  { id: 'star', label: 'Star Novelty' },
];

export const ACCESSORY_STYLES: { id: AccessoryStyle; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'blush', label: 'Rosy Blush' },
  { id: 'bandage', label: 'Nose Bandage' },
  { id: 'star-sticker', label: 'Glitter Star' },
  { id: 'lightning', label: 'Hero Lightning' },
  { id: 'headphones', label: 'Gamer Headphones' },
  { id: 'bowtie', label: 'Smart Bowtie' },
];

/**
 * Deterministically generates an AvatarConfig from a nickname string.
 * Same nickname always produces the exact same avatar traits.
 */
export function getDeterministicAvatar(nickname: string): AvatarConfig {
  const seed = nickname.trim().toLowerCase() || 'player';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash);

  return {
    faceShape: FACE_SHAPES[h % FACE_SHAPES.length].id,
    skinColor: SKIN_COLORS[(h >> 2) % SKIN_COLORS.length].id,
    backgroundColor: BG_COLORS[(h >> 4) % BG_COLORS.length].id,
    eyes: EYE_STYLES[(h >> 6) % EYE_STYLES.length].id,
    eyebrows: EYEBROW_STYLES[(h >> 8) % EYEBROW_STYLES.length].id,
    mouth: MOUTH_STYLES[(h >> 10) % MOUTH_STYLES.length].id,
    hairHat: HAIR_HAT_STYLES[(h >> 12) % HAIR_HAT_STYLES.length].id,
    glasses: GLASSES_STYLES[(h >> 14) % GLASSES_STYLES.length].id,
    accessory: ACCESSORY_STYLES[(h >> 16) % ACCESSORY_STYLES.length].id,
  };
}

/**
 * Resolves an avatar config from an AvatarConfig object, a JSON string, a legacy preset string, or a nickname.
 */
export function resolveAvatarConfig(
  input?: AvatarConfig | string | null,
  fallbackNickname: string = 'player'
): AvatarConfig {
  if (input && typeof input === 'object' && 'faceShape' in input) {
    return input;
  }

  if (typeof input === 'string' && input.trim()) {
    // Try parsing as JSON
    if (input.startsWith('{')) {
      try {
        const parsed = JSON.parse(input);
        if (parsed.faceShape && parsed.skinColor) {
          return parsed as AvatarConfig;
        }
      } catch {}
    }

    // Map legacy presets
    switch (input) {
      case 'fox':
        return {
          faceShape: 'cat',
          skinColor: '#F59E0B',
          backgroundColor: '#CF330D',
          eyes: 'happy',
          eyebrows: 'determined',
          mouth: 'cat',
          hairHat: 'none',
          glasses: 'none',
          accessory: 'blush',
        };
      case 'owl':
        return {
          faceShape: 'round',
          skinColor: '#FED7AA',
          backgroundColor: '#0D7A70',
          eyes: 'wide',
          eyebrows: 'raised',
          mouth: 'whistle',
          hairHat: 'none',
          glasses: 'round',
          accessory: 'bowtie',
        };
      case 'tiger':
        return {
          faceShape: 'cat',
          skinColor: '#FDBA74',
          backgroundColor: '#FFC83D',
          eyes: 'cool',
          eyebrows: 'bold',
          mouth: 'grin',
          hairHat: 'headband',
          glasses: 'none',
          accessory: 'lightning',
        };
      case 'robot':
        return {
          faceShape: 'square',
          skinColor: '#38BDF8',
          backgroundColor: '#8B5CF6',
          eyes: 'dots',
          eyebrows: 'bold',
          mouth: 'smirk',
          hairHat: 'none',
          glasses: 'retro',
          accessory: 'headphones',
        };
      case 'bear':
      default:
        return getDeterministicAvatar(input || fallbackNickname);
    }
  }

  return getDeterministicAvatar(fallbackNickname);
}

