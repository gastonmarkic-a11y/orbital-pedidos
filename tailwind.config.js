/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#7048e8',
        brandDark: '#6741d9',
        ink: '#1a1a24',
        muted: '#6b6b85',
        faint: '#9797ad',
        gold: '#c8a96e',
      },
    },
  },
  plugins: [],
}
