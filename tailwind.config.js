/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:     '#141B26',
        muted:   '#67728A',
        line:    '#E4E8EF',
        bg:      '#F5F7FA',
        surface: '#FFFFFF',
        brand:   { DEFAULT: '#2456A6', dark: '#1B4386', soft: '#EAF1FB' },
        ok:      '#2FA46A',
        warn:    '#D98A2B',
        danger:  '#D64545'
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,27,38,.06), 0 1px 3px rgba(20,27,38,.05)',
        pop:  '0 8px 30px rgba(20,27,38,.12)'
      }
    }
  },
  plugins: []
}
