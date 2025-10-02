import {
  buildAnalysisPrompt,
  buildABPrompts,
  buildHeroPrompts,
  buildMiniList,
  normalizeRenderGallery,
} from './prompts.js';
import { SUPPORTED_STYLES } from '../constants/analysis-schema.js';

describe('prompt builders', () => {
  test('buildAnalysisPrompt returns multiline prompt with defaults', () => {
    const prompt = buildAnalysisPrompt({ intendedUse: 'Living Room', scope: 3, notes: '' });
    expect(prompt).toContain('ROLE: Interior design analyst for empty rooms.');
    expect(prompt).toContain('INTENDED USE: Living Room.');
    expect(prompt).toContain('INTERVENTION SCOPE: 3.');
    expect(prompt).toContain('NOTES: None provided.');
  });

  test('buildABPrompts returns prompts for both axes', () => {
    const prompts = buildABPrompts('Base prompt', {
      axisA: { label: 'Cozy', description: 'Layer warm textures' },
      axisB: { label: 'Minimal', description: 'Streamline surfaces' },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('Cozy');
    expect(prompts[1]).toContain('Minimal');
  });

  test('buildABPrompts throws when required data missing', () => {
    expect(() => buildABPrompts('', null)).toThrow('basePrompt and axes are required');
  });

  test('buildHeroPrompts returns three hero mixes', () => {
    const prompts = buildHeroPrompts('Base prompt', {
      axisA: { label: 'Cozy', description: 'Layer warm textures' },
      axisB: { label: 'Minimal', description: 'Streamline surfaces' },
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain('sweet spot');
  });

  test('buildHeroPrompts throws when base prompt missing', () => {
    expect(() => buildHeroPrompts('', null)).toThrow('basePrompt and axes are required');
  });
});

describe('buildMiniList', () => {
  test('combines quick wins and staples up to five items', () => {
    const analysis = {
      quick_wins: Array.from({ length: 6 }, (_, index) => ({
        title: `Win ${index + 1}`,
        description: `Do thing ${index + 1}`,
      })),
      usage_candidates: [
        { function: 'Living Room', why: 'Best match' },
        { function: 'Home-Office', why: 'Secondary' },
        { function: 'Guest Room', why: 'Tertiary' },
      ],
    };
    const list = buildMiniList(analysis);
    expect(list).toHaveLength(5);
    expect(list[0].name).toBe('Win 1');
    expect(list[3].name).toContain('Living Room');
  });

  test('returns empty list when analysis missing', () => {
    expect(buildMiniList(null)).toEqual([]);
  });

  test('handles missing quick wins gracefully', () => {
    const analysis = {
      usage_candidates: [{ function: 'Living Room', why: 'Best match' }],
    };
    const list = buildMiniList(analysis);
    expect(list).toHaveLength(1);
    expect(list[0].name).toContain('Living Room');
  });

  test('handles missing usage candidates gracefully', () => {
    const analysis = {
      quick_wins: [],
    };
    const list = buildMiniList(analysis);
    expect(list).toEqual([]);
  });
});

describe('normalizeRenderGallery', () => {
  const palette = {
    primary: { name: 'Deep Plum', hex: '#392338' },
    secondary: { name: 'Muted Peach', hex: '#FFCFA4' },
    accent: { name: 'Raspberry', hex: '#C1264E' },
  };

  test('preserves existing prompts and fills missing styles to ten entries', () => {
    const analysis = {
      render_gallery: [
        { style: 'Scandi', prompt: 'Existing Scandi prompt', focus: 'Scandi focus', guidance: 'Scandi guidance' },
        { style: 'Japandi', prompt: 'Existing Japandi prompt' },
        { style: 'Modern Minimal', prompt: 'Existing Modern prompt' },
        { style: 'Contemporary Cozy', prompt: 'Existing Cozy prompt' },
      ],
      styles_top10: [
        { style: 'Scandi', why: 'Light woods and serene palette' },
        { style: 'Japandi', why: 'Calm, crafted minimalism' },
        { style: 'Modern Minimal', why: 'Clean planes and negative space' },
        { style: 'Contemporary Cozy', why: 'Soft textures with modern silhouettes' },
        { style: 'Mid-Century', why: 'Warm woods and iconic shapes' },
        { style: 'Industrial Soft', why: 'Tactile contrast without harsh edges' },
      ],
      palette_60_30_10: palette,
      constraints: { limitations: ['Do not remove existing flooring'] },
      negative_prompts: ['No text overlays'],
      photo_findings: {
        architectural_features: 'Large corner windows and crown moulding',
        lighting: 'North-facing soft daylight',
      },
    };

    const normalized = normalizeRenderGallery(analysis);
    expect(normalized).toHaveLength(10);
    const scandi = normalized.find((item) => item.style === 'Scandi');
    expect(scandi.prompt).toBe('Existing Scandi prompt');
    const artDeco = normalized.find((item) => item.style === 'Art-Deco');
    expect(artDeco).toBeDefined();
    expect(artDeco.prompt).toContain('Art-Deco');
    expect(artDeco.guidance).toContain('Preserve existing architecture');
  });

  test('trims existing text values and falls back when empty', () => {
    const analysis = {
      render_gallery: [
        { style: 'Rustic', prompt: '  Custom rustic prompt  ', focus: '   ', guidance: '' },
      ],
      styles_top10: [
        { style: 'Rustic', why: '   ' },
      ],
      palette_60_30_10: palette,
      negative_prompts: [],
      photo_findings: {},
    };

    const normalized = normalizeRenderGallery(analysis);
    expect(normalized).toHaveLength(10);
    const rustic = normalized.find((item) => item.style === 'Rustic');
    expect(rustic.prompt).toBe('Custom rustic prompt');
    expect(rustic.focus).toBe('Rustic concept direction');
    expect(rustic.guidance).toContain('Preserve existing architecture');
  });

  test('handles missing palette and limitations gracefully', () => {
    const analysis = {
      render_gallery: [],
      styles_top10: [
        { style: 'Industrial Soft', why: 'Contrast of raw and refined' },
      ],
      negative_prompts: ['No text'],
      constraints: { limitations: [] },
      photo_findings: {
        architectural_features: 'Exposed brick wall',
      },
    };

    const normalized = normalizeRenderGallery(analysis);
    const industrial = normalized.find((item) => item.style === 'Industrial Soft');
    expect(industrial.prompt).toContain('Exposed brick wall');
    expect(industrial.prompt).toContain('Avoid: No text');
  });

  test('falls back to generated prompt when existing entry lacks prompt text', () => {
    const analysis = {
      render_gallery: [
        { style: 'Boho', prompt: 42, focus: 'Existing focus', guidance: 42 },
      ],
      styles_top10: [
        { style: 'Boho', why: 'Layered textiles and artisanal pieces' },
      ],
      negative_prompts: ['No clutter'],
      photo_findings: {
        lighting: 'Golden hour glow',
      },
    };

    const normalized = normalizeRenderGallery(analysis);
    const boho = normalized.find((item) => item.style === 'Boho');
    expect(boho.prompt).toContain('Photorealistic interior render');
    expect(boho.prompt).toContain('Golden hour glow');
    expect(boho.focus).toBe('Existing focus');
    expect(boho.guidance).toContain('Preserve existing architecture');
  });

  test('describes palette even when swatches are partial', () => {
    const analysis = {
      render_gallery: [],
      styles_top10: [
        { style: 'Mediterranean', why: 'Sun-baked textures' },
      ],
      palette_60_30_10: {
        primary: { hex: '#101010' },
        secondary: { name: 'Sea Glass' },
        accent: null,
      },
      negative_prompts: [],
      photo_findings: {
        architectural_features: 'Arched doorway',
      },
    };

    const normalized = normalizeRenderGallery(analysis);
    const mediterranean = normalized.find((item) => item.style === 'Mediterranean');
    expect(mediterranean.prompt).toContain('Primary #101010');
    expect(mediterranean.prompt).toContain('Secondary Sea Glass');
    expect(mediterranean.prompt).not.toContain('Accent');
  });

  test('caps results at ten even when analysis provides extra entries', () => {
    const extraStyle = 'Experimental';
    const baseGallery = SUPPORTED_STYLES.map((style, index) => ({
      style,
      prompt: index === 0 ? '   ' : `${style} prompt`,
    }));
    const analysis = {
      render_gallery: [...baseGallery, { style: extraStyle, prompt: `${extraStyle} prompt` }],
      styles_top10: [
        { style: extraStyle, why: 'Just for exploration' },
        ...SUPPORTED_STYLES.map((style) => ({ style, why: `${style} fit reason` })),
        { style: 'Japandi', why: 'duplicate should be skipped' },
        { style: '', why: 'invalid should be ignored' },
      ],
      negative_prompts: [],
      photo_findings: {},
    };

    const normalized = normalizeRenderGallery(analysis);
    expect(normalized).toHaveLength(10);
    expect(normalized.some((item) => item.style === extraStyle)).toBe(true);
  });

  test('uses palette override when provided', () => {
    const analysis = {
      render_gallery: [],
      styles_top10: [
        { style: 'Scandi', why: 'Calm minimalism' },
      ],
      palette_60_30_10: {
        primary: { name: 'Base Primary', hex: '#101010' },
        secondary: { name: 'Base Secondary', hex: '#222222' },
        accent: { name: 'Base Accent', hex: '#333333' },
      },
      negative_prompts: [],
      photo_findings: {},
    };
    const override = {
      primary: { name: 'Override Primary', hex: '#445566' },
      secondary: { name: 'Override Secondary', hex: '#778899' },
      accent: { name: 'Override Accent', hex: '#AABBCC' },
    };

    const normalized = normalizeRenderGallery(analysis, override);
    const scandi = normalized.find((item) => item.style === 'Scandi');
    expect(scandi.prompt).toContain('#445566');
    expect(scandi.prompt).toContain('#778899');
  });

  test('returns empty array when analysis missing', () => {
    expect(normalizeRenderGallery(null)).toEqual([]);
  });
});
