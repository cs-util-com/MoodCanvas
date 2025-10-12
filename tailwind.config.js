const sharedThemeExtensions = {
  colors: {
    plum: '#392338',
    'plum-surface': '#3F2840',
    'plum-surface-2': '#462E49',
    'plum-border': '#513354',
    'plum-muted': '#CFC7D2',
    'plum-text': '#EDEDED',
    peach: '#FFCFA4',
    coral: '#FF947F',
    raspberry: '#C1264E',
    bg: '#392338',
    surface: '#3F2840',
    surface2: '#462E49',
    text: '#EDEDED',
    textMuted: '#CFC7D2',
    accent: '#FFCFA4',
    accentOn: '#392338',
    accent2: '#FF947F',
    accent2On: '#392338',
    cta: '#C1264E',
    ctaOn: '#FFFFFF',
  },
  borderRadius: {
    xl2: '1.5rem',
  },
  boxShadow: {
    dialog: '0 32px 80px -32px rgba(0,0,0,0.65)',
  },
  fontFamily: {
    sans: [
      '"Inter"',
      '"SF Pro Text"',
      '"Segoe UI"',
      'system-ui',
      'sans-serif',
    ],
  },
};

module.exports = {
  content: [
    './index.html',
    './pages/**/*.html',
    './src/**/*.{js,html}',
  ],
  theme: {
    extend: sharedThemeExtensions,
  },
  plugins: [],
};
