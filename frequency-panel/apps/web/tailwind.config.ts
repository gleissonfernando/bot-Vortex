import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#030712',
          900: '#07111f',
          850: '#0b1728',
          800: '#0f2038'
        },
        brand: {
          500: '#0b6bff',
          400: '#4aa3ff'
        }
      },
      boxShadow: {
        panel: '0 18px 60px rgba(0, 0, 0, 0.32)'
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};

export default config;
