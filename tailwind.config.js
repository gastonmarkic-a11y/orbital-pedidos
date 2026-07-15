/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#15151A',
        brandDark: '#8F6A34',
        ink: '#17171C',
        muted: '#6E6A61',
        faint: '#9B968B',
        gold: '#C8A96E',
        goldSoft: '#EBDFC9',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
