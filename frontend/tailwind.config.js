/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Tight', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Times New Roman', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          0: '#0A0A0D',
          1: '#111114',
          2: '#18181D',
          3: '#232328',
          4: '#2E2E36',
          5: '#3A3A44',
        },
        paper: {
          0: '#F4F1E8',
          1: '#EDEAE0',
          2: '#B7B3A8',
          3: '#7E7A70',
          4: '#4A4742',
        },
        seal: {
          DEFAULT: '#D7373F',
          hi: '#E04951',
          soft: 'rgba(215, 55, 63, 0.12)',
          faint: 'rgba(215, 55, 63, 0.06)',
          line: 'rgba(215, 55, 63, 0.32)',
        },
        reveal: {
          DEFAULT: '#8DBF6D',
          soft: 'rgba(141, 191, 109, 0.14)',
          line: 'rgba(141, 191, 109, 0.34)',
        },
        crit: {
          DEFAULT: '#C45A4A',
          soft: 'rgba(196, 90, 74, 0.12)',
        },
        steel: {
          DEFAULT: '#5A6E8F',
          soft: 'rgba(90, 110, 143, 0.14)',
          line: 'rgba(90, 110, 143, 0.32)',
        },
      },
      animation: {
        'pulse-slow': 'pulse-slow 3s ease-in-out infinite',
        'seal-pulse': 'seal-pulse 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 6s ease-in-out infinite',
        shimmer: 'redact-shimmer 4s linear infinite',
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.55' },
        },
        'redact-shimmer': {
          '0%':   { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '10px',
        xl: '14px',
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.025em',
      },
    },
  },
  plugins: [],
};
