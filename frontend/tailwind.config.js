/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Fonte de destaque da página institucional (Home) — não usada no
        // sistema interno, só nos títulos de `components/home/*`.
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
      },
      // Paleta da página institucional (Home) — tokens NOVOS, isolados dos
      // já usados no resto da aplicação. Mesmos valores oklch do rascunho
      // original (Página Principal/src/styles.css).
      colors: {
        ink:         'oklch(0.18 0.015 160)',
        'ink-soft':  'oklch(0.42 0.012 170)',
        cream:       'oklch(0.985 0.006 90)',
        'cream-deep':'oklch(0.965 0.012 88)',
        forest:      'oklch(0.32 0.055 158)',
        'forest-deep': 'oklch(0.24 0.05 158)',
        sage:        'oklch(0.72 0.08 158)',
        hairline:    'oklch(0.88 0.008 100)',
      },
      fontSize: {
        xs:    ['13px', { lineHeight: '1.4' }],
        sm:    ['14px', { lineHeight: '1.5' }],
        base:  ['16px', { lineHeight: '1.6' }],
        lg:    ['18px', { lineHeight: '1.6' }],
        xl:    ['20px', { lineHeight: '1.6' }],
        '2xl': ['24px', { lineHeight: '1.4' }],
        '3xl': ['30px', { lineHeight: '1.3' }],
        '4xl': ['36px', { lineHeight: '1.2' }],
      },
    },
  },
  plugins: [],
}