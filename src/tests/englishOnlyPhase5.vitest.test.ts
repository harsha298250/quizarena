import { describe, it, expect } from 'vitest';
import { translations, SupportedLanguage } from '../lib/i18n';
import fs from 'fs';
import path from 'path';

describe('Phase 5: English-Only Verification & Asset Optimization', () => {
  it('enforces English as the only supported UI language', () => {
    const supportedLangs: SupportedLanguage[] = ['en'];
    expect(supportedLangs.length).toBe(1);
    expect(supportedLangs[0]).toBe('en');

    // translations record must strictly only contain 'en'
    const translationKeys = Object.keys(translations);
    expect(translationKeys).toEqual(['en']);
    expect(translations.en).toBeDefined();
    expect(translations.en.appName).toBe('QuizArena');
    expect((translations as any).ta).toBeUndefined();
    expect((translations as any).hi).toBeUndefined();
  });

  it('verifies main.tsx has removed Tamil and Hindi font imports', () => {
    const mainTsxPath = path.resolve(__dirname, '../main.tsx');
    const content = fs.readFileSync(mainTsxPath, 'utf-8');

    expect(content).not.toContain('@fontsource/noto-sans-tamil');
    expect(content).not.toContain('@fontsource/noto-sans-devanagari');
  });

  it('verifies index.css has removed Tamil and Hindi font family fallbacks', () => {
    const cssPath = path.resolve(__dirname, '../index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    expect(content).not.toContain('Noto Sans Tamil');
    expect(content).not.toContain('Noto Sans Devanagari');
  });

  it('verifies package.json has removed Tamil and Devanagari font packages', () => {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.dependencies['@fontsource/noto-sans-tamil']).toBeUndefined();
    expect(pkg.dependencies['@fontsource/noto-sans-devanagari']).toBeUndefined();
  });
});
