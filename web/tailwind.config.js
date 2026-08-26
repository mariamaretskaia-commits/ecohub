/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
        display: ['Nunito', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#1a211c',
        cream: '#fff8ee',
        mint: {
          50: '#f3fbf6',
          100: '#e4f6ea',
          200: '#c8ecd4',
          300: '#9fdcb4',
          400: '#5fc987',
          500: '#2fb66a',
          600: '#1e9a56',
          700: '#187a45',
        },
        sun: {
          50: '#fff8e6',
          100: '#ffefc2',
          200: '#ffe08a',
          400: '#f5c542',
        },
        eco: {
          50: '#f3fbf6',
          100: '#e4f6ea',
          200: '#c8ecd4',
          300: '#9fdcb4',
          400: '#5fc987',
          500: '#2fb66a',
          600: '#1e9a56',
          700: '#187a45',
          800: '#145f37',
          900: '#0f4a2b',
        },
      },
      boxShadow: {
        soft: '0 10px 28px rgba(30, 70, 40, 0.08)',
        card: '0 12px 32px rgba(30, 70, 40, 0.07)',
        float: '0 16px 40px rgba(30, 70, 40, 0.14)',
      },
      borderRadius: {
        blob: '2rem',
      },
    },
  },
  plugins: [],
};
