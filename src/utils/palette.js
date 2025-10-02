const HEX_PATTERN = /^#[0-9A-F]{6}$/;

const VARIATION_PROFILES = [
  {
    id: 'moody-warm',
    adjustments: {
      primary: { h: -8, s: 0.08, l: -0.15 },
      secondary: { h: -4, s: 0.05, l: -0.1 },
      accent: { h: 18, s: 0.18, l: -0.06 },
    },
  },
  {
    id: 'airy-soft',
    adjustments: {
      primary: { h: 12, s: -0.12, l: 0.2 },
      secondary: { h: 16, s: -0.1, l: 0.15 },
      accent: { h: -6, s: -0.08, l: 0.25 },
    },
  },
  {
    id: 'earthy-blend',
    adjustments: {
      primary: { h: -22, s: -0.1, l: -0.04 },
      secondary: { h: -18, s: -0.16, l: 0.08 },
      accent: { h: -48, s: -0.22, l: -0.02 },
    },
  },
  {
    id: 'vibrant-pop',
    adjustments: {
      primary: { h: 28, s: 0.1, l: 0.05 },
      secondary: { h: 32, s: 0.14, l: -0.02 },
      accent: { h: 72, s: 0.25, l: 0.03 },
    },
  },
  {
    id: 'twilight-contrast',
    adjustments: {
      primary: { l: -0.22 },
      secondary: { h: 10, l: -0.14, s: 0.05 },
      accent: { complement: true, s: 0.12, l: -0.04 },
    },
  },
  {
    id: 'misty-muted',
    adjustments: {
      primary: { s: -0.2, l: 0.18 },
      secondary: { s: -0.22, l: 0.16 },
      accent: { h: 96, s: -0.05, l: 0.12 },
    },
  },
];

export function ensurePaletteOptions(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return [];
  }

  const provided = Array.isArray(analysis.palette_options)
    ? analysis.palette_options.map(sanitizePalette).filter(Boolean)
    : [];
  const basePalette = sanitizePalette(analysis.palette_60_30_10);
  const options = [];

  if (basePalette) {
    options.push(clonePalette(basePalette));
  }

  for (const palette of provided) {
    if (options.length >= 5) break;
    if (!options.some((existing) => palettesEqual(existing, palette))) {
      options.push(clonePalette(palette));
    }
  }

  const base = basePalette ?? options[0] ?? null;

  if (base) {
    const variants = generatePaletteVariations(base);
    for (const variant of variants) {
      if (options.length >= 5) break;
      if (!options.some((existing) => palettesEqual(existing, variant))) {
        options.push(clonePalette(variant));
      }
    }
  }

  if (options.length < 5 && base) {
    const supplementalSeeds = [
      {
        primary: { l: -0.28 },
        secondary: { l: -0.18 },
        accent: { h: 36, l: -0.04 },
      },
      {
        primary: { l: 0.24, s: -0.1 },
        secondary: { l: 0.2, s: -0.08 },
        accent: { complement: true, l: 0.16 },
      },
      {
        primary: { h: 40, s: 0.06 },
        secondary: { h: -30, s: 0.05 },
        accent: { h: 120, s: 0.2, l: 0.05 },
      },
    ];

    for (const adjustments of supplementalSeeds) {
      if (options.length >= 5) break;
      const variant = buildVariant(base, { adjustments });
      if (!variant) continue;
      if (!options.some((existing) => palettesEqual(existing, variant))) {
        options.push(clonePalette(variant));
      }
    }
  }

  return options.slice(0, 5);
}

export function generatePaletteVariations(base) {
  if (!base) return [];
  const source = clonePalette(base);
  const variants = [];
  for (const profile of VARIATION_PROFILES) {
    const candidate = buildVariant(source, profile);
    if (!candidate) continue;
    if (palettesEqual(candidate, source)) continue;
    if (!variants.some((existing) => palettesEqual(existing, candidate))) {
      variants.push(candidate);
    }
  }
  return variants;
}

function buildVariant(base, profile) {
  if (!base) return null;
  const result = clonePalette(base);
  for (const key of ['primary', 'secondary', 'accent']) {
    const swatch = base[key];
    const adjustments = profile.adjustments?.[key] ?? {};
    result[key] = tweakSwatch(swatch, adjustments);
  }
  return result;
}

function tweakSwatch(swatch, adjustments) {
  if (!swatch) return null;
  const normalizedHex = normalizeHexString(swatch.hex ?? '');
  if (!isValidHex(normalizedHex)) {
    return { ...swatch };
  }

  let { h, s, l } = hexToHsl(normalizedHex);

  if (adjustments?.complement) {
    h = (h + 180) % 360;
  }
  if (typeof adjustments?.h === 'number') {
    h = (h + adjustments.h + 360) % 360;
  }
  if (typeof adjustments?.s === 'number') {
    s = clamp01(s + adjustments.s);
  }
  if (typeof adjustments?.l === 'number') {
    l = clamp01(l + adjustments.l);
  }

  const nextHex = hslToHex({ h, s, l });
  return {
    ...swatch,
    hex: nextHex,
  };
}

function sanitizePalette(palette) {
  if (!palette || typeof palette !== 'object') {
    return null;
  }
  const result = {};
  let found = false;
  for (const key of ['primary', 'secondary', 'accent']) {
    const swatch = sanitizeSwatch(palette[key]);
    if (swatch) {
      result[key] = swatch;
      found = true;
    } else {
      result[key] = null;
    }
  }
  return found ? result : null;
}

function sanitizeSwatch(swatch) {
  if (!swatch || typeof swatch !== 'object') {
    return null;
  }
  const result = {};
  if (typeof swatch.name === 'string') {
    result.name = swatch.name;
  }
  if (typeof swatch.hex === 'string') {
    const normalized = normalizeHexString(swatch.hex);
    if (isValidHex(normalized)) {
      result.hex = normalized;
    }
  }
  if (typeof swatch.finish === 'string') {
    result.finish = swatch.finish;
  }
  if (typeof swatch.usage === 'string') {
    result.usage = swatch.usage;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function clonePalette(palette) {
  if (!palette) return null;
  const result = {};
  for (const key of ['primary', 'secondary', 'accent']) {
    const swatch = palette[key];
    result[key] = swatch ? { ...swatch } : null;
  }
  return result;
}

export function palettesEqual(a, b) {
  if (!a || !b) return false;
  return ['primary', 'secondary', 'accent'].every((key) => {
    const hexA = normalizeHexString(a[key]?.hex ?? '');
    const hexB = normalizeHexString(b[key]?.hex ?? '');
    if (!hexA || !hexB) {
      return hexA === hexB;
    }
    return hexA === hexB;
  });
}

export function normalizeHexString(hex) {
  if (typeof hex !== 'string') return '';
  const trimmed = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.slice(1).toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }
  return trimmed.toUpperCase();
}

function isValidHex(hex) {
  return HEX_PATTERN.test(hex);
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        h = 0;
    }
    h /= 6;
  }

  return {
    h: h * 360,
    s,
    l,
  };
}

function hslToHex({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const light = clamp01(l);

  if (sat === 0) {
    const gray = toHexComponent(light);
    return `#${gray}${gray}${gray}`;
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;

  const r = hueToRgb(p, q, hue / 360 + 1 / 3);
  const g = hueToRgb(p, q, hue / 360);
  const b = hueToRgb(p, q, hue / 360 - 1 / 3);

  return `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`;
}

function hueToRgb(p, q, t) {
  let temp = t;
  if (temp < 0) temp += 1;
  if (temp > 1) temp -= 1;
  if (temp < 1 / 6) return p + (q - p) * 6 * temp;
  if (temp < 1 / 2) return q;
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
  return p;
}

function toHexComponent(value) {
  const clamped = clamp01(value);
  const intValue = Math.round(clamped * 255);
  return intValue.toString(16).padStart(2, '0').toUpperCase();
}
