/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  AvatarConfig,
  FACE_SHAPES,
  SKIN_COLORS,
  BG_COLORS,
  EYE_STYLES,
  EYEBROW_STYLES,
  MOUTH_STYLES,
  HAIR_HAT_STYLES,
  GLASSES_STYLES,
  ACCESSORY_STYLES,
  getDeterministicAvatar,
  FaceShape,
  EyeStyle,
  EyebrowStyle,
  MouthStyle,
  HairHatStyle,
  GlassesStyle,
  AccessoryStyle,
} from '../../types/avatar';
import { Avatar } from './Avatar';
import { sound } from '../../lib/sound';

interface AvatarBuilderProps {
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  nickname?: string;
}

export const AvatarBuilder: React.FC<AvatarBuilderProps> = ({
  config,
  onChange,
  nickname = 'player',
}) => {
  const [activeTab, setActiveTab] = useState<'base' | 'face' | 'style'>('base');

  const updateTrait = <K extends keyof AvatarConfig>(trait: K, value: AvatarConfig[K]) => {
    sound.playClick();
    onChange({
      ...config,
      [trait]: value,
    });
  };

  const handleRandomize = () => {
    sound.playPowerUp();
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    const randomConfig: AvatarConfig = {
      faceShape: pick(FACE_SHAPES).id,
      skinColor: pick(SKIN_COLORS).id,
      backgroundColor: pick(BG_COLORS).id,
      eyes: pick(EYE_STYLES).id,
      eyebrows: pick(EYEBROW_STYLES).id,
      mouth: pick(MOUTH_STYLES).id,
      hairHat: pick(HAIR_HAT_STYLES).id,
      glasses: pick(GLASSES_STYLES).id,
      accessory: pick(ACCESSORY_STYLES).id,
    };
    onChange(randomConfig);
  };

  const handleResetToNickname = () => {
    sound.playClick();
    onChange(getDeterministicAvatar(nickname));
  };

  return (
    <div className="paper-card p-4 sm:p-5 space-y-4 border-2 shadow-[3px_3px_0px_var(--shadow)]">
      {/* Live Preview & Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-3 border-b-2 border-[var(--border)]/15">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3.5 text-center sm:text-left">
          <div className="p-1 rounded-full border-3 border-[var(--border)] shadow-[3px_3px_0px_var(--shadow)] bg-[var(--surface)] hover:scale-105 transition-transform shrink-0">
            <Avatar config={config} size={80} alt="Live avatar preview" />
          </div>
          <div>
            <span className="font-['Bricolage_Grotesque'] font-black text-base text-[var(--text)] block">
              Sticker Avatar
            </span>
            <span className="text-[11px] font-bold text-[var(--text-muted)]">
              Layered vector sticker • Fully customizable
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleRandomize}
            className="paper-btn paper-btn-secondary px-3 py-1.5 text-xs font-bold flex items-center gap-1 shadow-[2px_2px_0px_var(--shadow)]"
            title="Randomize avatar traits"
          >
            <span aria-hidden="true">🎲</span>
            <span>Randomize</span>
          </button>
          <button
            type="button"
            onClick={handleResetToNickname}
            className="paper-btn px-2.5 py-1.5 text-xs font-bold bg-[var(--surface-2)] text-[var(--text)]"
            title="Generate avatar matching your nickname"
          >
            Match Handle
          </button>
        </div>
      </div>

      {/* Trait Category Navigation Tabs */}
      <div className="flex border-b-2 border-[var(--border)]/20" role="tablist" aria-label="Avatar customization categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'base'}
          onClick={() => {
            sound.playClick();
            setActiveTab('base');
          }}
          className={`flex-1 py-1.5 text-xs font-bold font-['Bricolage_Grotesque'] border-b-2 transition-all ${
            activeTab === 'base'
              ? 'border-[var(--accent)] text-[var(--accent)] font-black'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          🎨 Base &amp; Colors
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'face'}
          onClick={() => {
            sound.playClick();
            setActiveTab('face');
          }}
          className={`flex-1 py-1.5 text-xs font-bold font-['Bricolage_Grotesque'] border-b-2 transition-all ${
            activeTab === 'face'
              ? 'border-[var(--accent)] text-[var(--accent)] font-black'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          👀 Eyes &amp; Expression
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'style'}
          onClick={() => {
            sound.playClick();
            setActiveTab('style');
          }}
          className={`flex-1 py-1.5 text-xs font-bold font-['Bricolage_Grotesque'] border-b-2 transition-all ${
            activeTab === 'style'
              ? 'border-[var(--accent)] text-[var(--accent)] font-black'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          🧢 Hair &amp; Gear
        </button>
      </div>

      {/* Trait Selectors */}
      <div className="space-y-3 pt-1">
        {/* Tab 1: Base (Face Shape, Skin Color, Background) */}
        {activeTab === 'base' && (
          <div className="space-y-3 animate-fadeIn">
            {/* Background Color */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Badge Background:
              </label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Badge Background Color">
                {BG_COLORS.map(c => {
                  const isChecked = config.backgroundColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      aria-label={`Background ${c.label}`}
                      onClick={() => updateTrait('backgroundColor', c.id)}
                      className={`h-7 w-7 rounded-full border-2 border-[var(--border)] transition-transform ${
                        isChecked ? 'ring-2 ring-[var(--accent)] scale-110 shadow-sm' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.color }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Face Shape */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)] break-words">
                Face Shape / Species:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label="Face Shape">
                {FACE_SHAPES.map(f => {
                  const isChecked = config.faceShape === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={f.label}
                      onClick={() => updateTrait('faceShape', f.id as FaceShape)}
                      className={`py-1.5 px-1.5 sm:px-2 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full text-center">{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Skin / Fur Color */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Skin / Fur Color:
              </label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Skin or Fur Color">
                {SKIN_COLORS.map(c => {
                  const isChecked = config.skinColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      aria-label={`Skin color ${c.label}`}
                      onClick={() => updateTrait('skinColor', c.id)}
                      className={`h-7 w-7 rounded-full border-2 border-[var(--border)] transition-transform ${
                        isChecked ? 'ring-2 ring-[var(--accent)] scale-110 shadow-sm' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.color }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Face (Eyes, Eyebrows, Mouth) */}
        {activeTab === 'face' && (
          <div className="space-y-3 animate-fadeIn">
            {/* Eyes */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Eyes:
              </label>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Eye Style">
                {EYE_STYLES.map(e => {
                  const isChecked = config.eyes === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={e.label}
                      onClick={() => updateTrait('eyes', e.id as EyeStyle)}
                      className={`py-1.5 px-1 sm:px-1.5 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full">{e.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Eyebrows */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Eyebrows:
              </label>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Eyebrow Style">
                {EYEBROW_STYLES.map(b => {
                  const isChecked = config.eyebrows === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={b.label}
                      onClick={() => updateTrait('eyebrows', b.id as EyebrowStyle)}
                      className={`py-1.5 px-1 sm:px-1.5 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full">{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mouth */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Mouth:
              </label>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Mouth Style">
                {MOUTH_STYLES.map(m => {
                  const isChecked = config.mouth === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={m.label}
                      onClick={() => updateTrait('mouth', m.id as MouthStyle)}
                      className={`py-1.5 px-1 sm:px-1.5 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Style (Hair/Hat, Glasses, Accessory) */}
        {activeTab === 'style' && (
          <div className="space-y-3 animate-fadeIn">
            {/* Hair / Hat */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Hair / Headwear:
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" role="radiogroup" aria-label="Hair or Hat Style">
                {HAIR_HAT_STYLES.map(h => {
                  const isChecked = config.hairHat === h.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={h.label}
                      onClick={() => updateTrait('hairHat', h.id as HairHatStyle)}
                      className={`py-1.5 px-1 sm:px-1.5 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full">{h.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Glasses */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Glasses:
              </label>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Glasses Style">
                {GLASSES_STYLES.map(g => {
                  const isChecked = config.glasses === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={g.label}
                      onClick={() => updateTrait('glasses', g.id as GlassesStyle)}
                      className={`py-1.5 px-1 sm:px-1.5 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full">{g.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Accessories */}
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-[var(--text-muted)]">
                Accessories &amp; Stickers:
              </label>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Accessory Style">
                {ACCESSORY_STYLES.map(a => {
                  const isChecked = config.accessory === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      title={a.label}
                      onClick={() => updateTrait('accessory', a.id as AccessoryStyle)}
                      className={`py-1.5 px-1 sm:px-1.5 rounded-lg border-2 text-[10.5px] sm:text-xs font-bold transition-all text-center flex items-center justify-center min-w-0 overflow-hidden ${
                        isChecked
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[1.5px_1.5px_0px_var(--shadow)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <span className="truncate min-w-0 max-w-full">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

