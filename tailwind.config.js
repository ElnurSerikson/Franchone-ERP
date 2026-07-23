/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette copied from docs/demo_design.html ("Donezo")
        green: {
          DEFAULT: '#057269',
          2: '#0a857a',
          d: '#044f48',
          light: '#4db3a6',
        },
        dark: '#0c1f16',
        ink: {
          DEFAULT: '#1c1d22',
          2: '#3a3d44',
        },
        muted: {
          DEFAULT: '#9498a1',
          2: '#b6bac1',
        },
        line: {
          DEFAULT: '#eef0f1',
          2: '#e7e9ea',
        },
        bg: '#f4f4f4',
        card: '#ffffff',
        chip: '#f4f5f6',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        card: '20px',
        xl2: '16px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,40,30,.04)',
        soft: '0 6px 24px rgba(20,40,30,.06)',
      },
    },
  },
  plugins: [],
}
