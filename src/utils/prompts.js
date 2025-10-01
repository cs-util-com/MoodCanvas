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
