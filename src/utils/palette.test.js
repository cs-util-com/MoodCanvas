import {
  ensurePaletteOptions,
  generatePaletteVariations,
  normalizeHexString,
  palettesEqual,
} from './palette.js';

function buildBasePalette() {
  return {
    primary: {
      name: 'Soft Plum',
      hex: '#4A2E4F',
      finish: 'matte',
      usage: 'walls',
    },
    secondary: {
      name: 'Mist Grey',
      hex: '#8C8F9A',
      finish: 'eggshell',
      usage: 'trim',
    },
    accent: {
      name: 'Amber Glow',
      hex: '#E89A5D',
      finish: 'satin',
      usage: 'accent decor',
    },
  };
}

function signature(palette) {
  return ['primary', 'secondary', 'accent']
    .map((key) => palette[key]?.hex ?? 'none')
    .join('|');
}

describe('generatePaletteVariations', () => {
  it('produces distinct variants that differ from the base palette', () => {
    const base = buildBasePalette();
    const variants = generatePaletteVariations(base);

    expect(variants.length).toBeGreaterThanOrEqual(4);
    const signatures = new Set(variants.map(signature));
    expect(signatures.size).toBe(variants.length);
    variants.forEach((variant) => {
      expect(palettesEqual(variant, base)).toBe(false);
    });
  });
});

describe('ensurePaletteOptions', () => {
  it('returns five unique palettes including the base palette first', () => {
    const base = buildBasePalette();
    const analysis = {
      palette_60_30_10: base,
      palette_options: [
        {
          primary: { hex: '#4A2E4F' },
          secondary: { hex: '#8C8F9A' },
          accent: { hex: '#E89A5D' },
        },
        {
          primary: { hex: '#4A2E4F' },
          secondary: { hex: '#8C8F9A' },
          accent: { hex: '#E89A5D' },
        },
      ],
    };

    const options = ensurePaletteOptions(analysis);
    expect(options).toHaveLength(5);
    expect(palettesEqual(options[0], base)).toBe(true);

    const signatures = new Set(options.map(signature));
    expect(signatures.size).toBe(options.length);
  });

  it('gracefully falls back when no palette is provided', () => {
    const analysis = {};
    const options = ensurePaletteOptions(analysis);
    expect(options).toEqual([]);
  });

  it('returns empty array when analysis is not an object', () => {
    expect(ensurePaletteOptions(null)).toEqual([]);
    expect(ensurePaletteOptions(undefined)).toEqual([]);
  });

  it('reuses provided palette options when the base palette is missing', () => {
    const provided = [
      {
        primary: { hex: '#112233', name: 'Deep Slate' },
        secondary: { hex: '#445566' },
        accent: { hex: '#EEAA55' },
      },
      {
        primary: { hex: 'invalid' },
        secondary: { hex: '#445566' },
        accent: { hex: '#EEAA55' },
      },
    ];

    const options = ensurePaletteOptions({ palette_options: provided });
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(options[0].primary.hex).toBe('#112233');
    expect(options[0].secondary.hex).toBe('#445566');
    expect(options.some((option) => option.primary === null)).toBe(true);
  });

  it('applies supplemental seeds when color data is missing', () => {
    const analysis = {
      palette_60_30_10: {
        primary: { name: 'Untinted base', usage: 'walls' },
        secondary: { name: 'Bare secondary', usage: 'trim' },
        accent: { name: 'Bare accent', usage: 'accent decor' },
      },
    };

    const options = ensurePaletteOptions(analysis);
    expect(options).toHaveLength(1);
    expect(options[0].primary?.name).toBe('Untinted base');
  });
});

describe('normalizeHexString & palettesEqual', () => {
  it('normalizes hex strings with or without leading hash', () => {
    expect(normalizeHexString('#ff00aa')).toBe('#FF00AA');
    expect(normalizeHexString('00ff00')).toBe('#00FF00');
    expect(normalizeHexString('  #112233  ')).toBe('#112233'.toUpperCase());
    expect(normalizeHexString('not-a-hex')).toBe('NOT-A-HEX');
  });

  it('handles missing swatch hexes when comparing palettes', () => {
    const a = { primary: { hex: '#123456' }, secondary: null, accent: {} };
    const b = { primary: { hex: '#123456' }, secondary: null, accent: {} };
    const c = { primary: { hex: '#654321' }, secondary: null, accent: {} };

    expect(palettesEqual(a, b)).toBe(true);
    expect(palettesEqual(a, c)).toBe(false);
    expect(palettesEqual(null, c)).toBe(false);
  });
});

describe('generatePaletteVariations with grayscale input', () => {
  it('still emits distinct variants when the base palette lacks saturation', () => {
    const base = {
      primary: { hex: '#777777', name: 'Warm Grey' },
      secondary: { hex: '#8A8A8A', name: 'Soft Grey' },
      accent: { hex: '#B0B0B0', name: 'Pale Grey' },
    };

    const variants = generatePaletteVariations(base);
    expect(variants.length).toBeGreaterThanOrEqual(4);
    expect(new Set(variants.map(signature)).size).toBe(variants.length);
    expect(variants.some((variant) => variant.primary.hex !== '#777777')).toBe(true);
  });
});
