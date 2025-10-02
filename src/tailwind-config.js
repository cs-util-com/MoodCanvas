/* istanbul ignore file */

if (typeof window !== 'undefined') {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = {
    theme: {
      extend: {
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
      },
    },
  };
}
