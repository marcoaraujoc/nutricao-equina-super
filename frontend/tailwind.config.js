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