/* istanbul ignore file */

export const SUPPORTED_ROOM_FUNCTIONS = [
  'Bedroom',
  'Home-Office',
  'Kids Room',
  'Guest Room',
  'Living Room',
  'Dining Room',
  'Hobby/Studio',
  'Fitness/Yoga',
  'Library/Reading',
  'Music/Recording',
  'Walk-in Closet',
  'Storage/Utility',
  'Other',
];

export const SUPPORTED_STYLES = [
  'Scandi',
  'Japandi',
  'Modern Minimal',
  'Contemporary Cozy',
  'Mid-Century',
  'Industrial Soft',
  'Boho',
  'Rustic',
  'Mediterranean',
  'Art-Deco',
];

export const ANALYSIS_SCHEMA = {
  type: 'object',
  required: [
    'usage_candidates',
    'photo_findings',
    'palette_60_30_10',
    'constraints',
    'quick_wins',
    'styles_top10',
    'smart_mixed_axes',
    'negative_prompts',
    'safety_checks',
    'render_gallery',
  ],
  properties: {
    usage_candidates: {
      type: 'array',
      minItems: 3,
      items: {
        type: 'object',
        properties: {
          function: {
            type: 'string',
          },
          confidence: { type: 'number' },
          why: { type: 'string', minLength: 1 },
        },
      },
    },
    photo_findings: {
      type: 'object',
      properties: {
        envelope: { type: 'string' },
        lighting: { type: 'string' },
        architectural_features: { type: 'string' },
        warnings: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    palette_60_30_10: {
      type: 'object',
      properties: {
        primary: paletteColorSchema(),
        secondary: paletteColorSchema(),
        accent: paletteColorSchema(),
      },
    },
    constraints: {
      type: 'object',
      properties: {
        scale_guesses: {
          type: 'object',
          properties: {
            width_m: scaleGuessSchema(),
            depth_m: scaleGuessSchema(),
            height_m: scaleGuessSchema(),
          },
        },
        limitations: {
          type: 'array',
          items: { type: 'string' },
        },
        notes: { type: 'string' },
      },
    },
    quick_wins: {
      type: 'array',
      items: quickWinSchema(),
    },
    styles_top10: {
      type: 'array',
      items: styleScoreSchema(),
    },
    smart_mixed_axes: {
      type: 'object',
      properties: {
        axisA: smartAxisSchema(),
        axisB: smartAxisSchema(),
        summary: { type: 'string' },
      },
    },
    negative_prompts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
    safety_checks: {
      type: 'object',
      properties: {
        nsfw: safetyFlagSchema(),
        copyright: safetyFlagSchema(),
        architectural_integrity: safetyFlagSchema(),
      },
    },
    render_gallery: {
      type: 'array',
      items: renderPromptSchema(),
    },
  },
};

function paletteColorSchema() {
  return {
    type: 'object',
    required: ['name', 'hex', 'finish', 'usage'],
    properties: {
      name: { type: 'string' },
      hex: { type: 'string' },
      finish: { type: 'string' },
      usage: { type: 'string' },
    },
  };
}

function scaleGuessSchema() {
  return {
    type: 'object',
    required: ['value', 'confidence'],
    properties: {
      value: {
        type: 'number',
        nullable: true,
      },
      confidence: { type: 'number' },
    },
  };
}

function quickWinSchema() {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      effort: { type: 'string' },
      impact: { type: 'string' },
    },
  };
}

function styleScoreSchema() {
  return {
    type: 'object',
    properties: {
      style: { type: 'string' },
      score: { type: 'number' },
      why: { type: 'string' },
    },
  };
}

function smartAxisSchema() {
  return {
    type: 'object',
    properties: {
      label: { type: 'string' },
      description: { type: 'string' },
      spectrum: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'number' },
            descriptor: { type: 'string' },
          },
        },
      },
    },
  };
}

function safetyFlagSchema() {
  return {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'warn', 'block'] },
      notes: { type: 'string' },
    },
  };
}

function renderPromptSchema() {
  return {
    type: 'object',
    properties: {
      style: { type: 'string' },
      prompt: { type: 'string' },
      focus: { type: 'string' },
      guidance: { type: 'string' },
    },
  };
}
