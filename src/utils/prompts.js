import { SUPPORTED_STYLES } from '../constants/analysis-schema.js';

export function buildAnalysisPrompt({ intendedUse, scope, notes }) {
  return [
    'ROLE: Interior design analyst for empty rooms.',
    `INTENDED USE: ${intendedUse}.`,
    `INTERVENTION SCOPE: ${scope}.`,
    `NOTES: ${notes || 'None provided.'}`,
    'Return strict JSON matching the response schema. Units in meters.',
  ].join('\n');
}

export function buildABPrompts(basePrompt, axes) {
  if (!basePrompt || !axes) {
    throw new Error('basePrompt and axes are required');
  }
  return [
    `${basePrompt}\nEmphasize axis ${axes.axisA.label}: ${axes.axisA.description}.`,
    `${basePrompt}\nEmphasize axis ${axes.axisB.label}: ${axes.axisB.description}.`,
  ];
}

export function buildHeroPrompts(basePrompt, axes) {
  if (!basePrompt || !axes) {
    throw new Error('basePrompt and axes are required');
  }
  return [
    `${basePrompt}\nHero mix leaning ${axes.axisA.label}.`,
    `${basePrompt}\nHero mix leaning ${axes.axisB.label}.`,
    `${basePrompt}\nHero blend capturing the sweet spot between ${axes.axisA.label} and ${axes.axisB.label}.`,
  ];
}

export function buildMiniList(analysis) {
  if (!analysis) return [];
  const quickWins = (analysis.quick_wins ?? []).slice(0, 3).map((win) => ({
    name: win.title,
    spec: win.description,
  }));
  const staples = (analysis.usage_candidates ?? [])
    .slice(0, 2)
    .map((candidate, index) => ({
      name: `${candidate.function} staple ${index + 1}`,
      spec: candidate.why,
    }));
  return [...quickWins, ...staples].slice(0, 5);
}

export function normalizeRenderGallery(analysis, paletteOverride) {
  if (!analysis) return [];

  const existing = Array.isArray(analysis.render_gallery)
    ? analysis.render_gallery.filter((item) => item && typeof item.style === 'string')
    : [];
  const styleScores = Array.isArray(analysis.styles_top10)
    ? analysis.styles_top10.filter((item) => item && typeof item.style === 'string')
    : [];

  const palette = paletteOverride ?? analysis.palette_60_30_10;
  const limitations = Array.isArray(analysis.constraints?.limitations)
    ? analysis.constraints.limitations.filter(Boolean)
    : [];
  const negativePrompts = Array.isArray(analysis.negative_prompts)
    ? analysis.negative_prompts.filter(Boolean)
    : [];
  const architecturalNotes = analysis.photo_findings?.architectural_features;
  const lightingNotes = analysis.photo_findings?.lighting;

  const rankedStyles = styleScores.map((item) => item.style);
  const orderedStyles = [...rankedStyles];
  for (const style of SUPPORTED_STYLES) {
    if (!orderedStyles.includes(style)) {
      orderedStyles.push(style);
    }
  }

  const styleReason = new Map(styleScores.map((item) => [item.style, item.why]));
  const existingByStyle = new Map(existing.map((item) => [item.style, item]));
  const results = [];
  const used = new Set();

  for (const style of orderedStyles) {
    if (!style || used.has(style)) continue;
    const entry = existingByStyle.get(style);
    const fallback = buildGalleryFallback({
      style,
      reason: styleReason.get(style) ?? entry?.guidance ?? entry?.focus,
      palette,
      limitations,
      negativePrompts,
      architecturalNotes,
      lightingNotes,
    });

    const prompt = sanitizePrompt(entry?.prompt) ?? fallback.prompt;
    results.push({
      style,
      prompt,
      focus: sanitizeText(entry?.focus) ?? fallback.focus,
      guidance: sanitizeText(entry?.guidance) ?? fallback.guidance,
    });
    used.add(style);
    if (results.length === 10) break;
  }

  if (results.length < 10) {
    for (const style of SUPPORTED_STYLES) {
      if (results.length === 10) break;
      if (used.has(style)) continue;
      const fallback = buildGalleryFallback({
        style,
        reason: styleReason.get(style),
        palette,
        limitations,
        negativePrompts,
        architecturalNotes,
        lightingNotes,
      });
      results.push(fallback);
      used.add(style);
    }
  }

  return results.slice(0, 10);
}

function buildGalleryFallback({
  style,
  reason,
  palette,
  limitations,
  negativePrompts,
  architecturalNotes,
  lightingNotes,
}) {
  const focus = reason?.trim() || `${style} concept direction`;
  const guidanceParts = [focus];
  if (palette) {
    guidanceParts.push(
      `Use the 60-30-10 palette → base ${palette.primary?.name ?? palette.primary?.hex}, secondary ${
        palette.secondary?.name ?? palette.secondary?.hex ?? ''
      }, accent ${palette.accent?.name ?? palette.accent?.hex ?? ''}.`.trim()
    );
  }
  guidanceParts.push('Preserve existing architecture and layout.');

  const promptLines = [
    `Photorealistic interior render of the provided room styled as ${style}.`,
    'Maintain the original camera angle, envelope, and proportions.',
  ];

  if (architecturalNotes) {
    promptLines.push(`Keep architectural features: ${architecturalNotes}.`);
  }
  if (lightingNotes) {
    promptLines.push(`Respect lighting cues (${lightingNotes}).`);
  }
  if (palette) {
    promptLines.push(
      `Adhere to the 60-30-10 palette: ${describePalette(palette)}.`
    );
  }
  if (limitations?.length) {
    promptLines.push(`Respect constraints: ${limitations.join('; ')}.`);
  }
  promptLines.push(`Highlight signature ${style} materials, silhouettes, and styling.`);
  if (negativePrompts.length) {
    promptLines.push(`Avoid: ${negativePrompts.join('; ')}.`);
  }
  promptLines.push('No text, watermarks, or graphic overlays.');

  return {
    style,
    prompt: promptLines.join('\n'),
    focus,
    guidance: guidanceParts.join(' '),
  };
}

function sanitizePrompt(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function sanitizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function describePalette(palette) {
  const primary = swatchString('Primary', palette.primary);
  const secondary = swatchString('Secondary', palette.secondary);
  const accent = swatchString('Accent', palette.accent);
  return [primary, secondary, accent].filter(Boolean).join(' · ');
}

function swatchString(label, swatch) {
  if (!swatch) return '';
  const parts = [label];
  if (swatch.name) parts.push(swatch.name);
  if (swatch.hex) parts.push(swatch.hex);
  return parts.join(' ');
}
