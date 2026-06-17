import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vortex: {
          bg: 'var(--vx-bg)',
          surface: 'var(--vx-surface)',
          hover: 'var(--vx-hover)',
          primary: 'var(--vx-primary)',
          secondary: 'var(--vx-secondary)',
          success: 'var(--vx-success)',
          warning: 'var(--vx-warning)',
          danger: 'var(--vx-danger)',
          text: 'var(--vx-text)',
          muted: 'var(--vx-muted)',
          border: 'var(--vx-border)'
        },
        surface: {
          950: 'var(--vx-bg)',
          900: 'var(--vx-surface)',
          850: 'var(--vx-hover)',
          800: 'var(--vx-hover)'
        },
        brand: {
          500: 'var(--vx-primary)',
          400: 'var(--vx-secondary)'
        },
        slate: {
          50: 'var(--vx-text)',
          100: 'var(--vx-text)',
          200: 'rgba(255, 255, 255, 0.9)',
          300: 'rgba(255, 255, 255, 0.78)',
          400: 'var(--vx-muted)',
          500: 'rgba(148, 163, 184, 0.72)',
          600: 'rgba(148, 163, 184, 0.58)',
          700: 'var(--vx-hover)',
          800: 'var(--vx-surface)',
          900: 'var(--vx-surface)',
          950: 'var(--vx-bg)'
        },
        sky: {
          50: 'var(--vx-text)',
          100: 'rgba(226, 249, 255, 0.95)',
          200: 'rgba(180, 239, 255, 0.88)',
          300: 'var(--vx-primary)',
          400: 'var(--vx-primary)',
          500: 'var(--vx-secondary)',
          950: 'rgba(0, 191, 255, 0.16)'
        },
        blue: {
          50: 'var(--vx-text)',
          100: 'rgba(226, 249, 255, 0.95)',
          200: 'rgba(180, 239, 255, 0.88)',
          300: 'var(--vx-primary)',
          400: 'var(--vx-primary)',
          500: 'var(--vx-secondary)',
          950: 'rgba(0, 153, 255, 0.16)'
        },
        emerald: {
          100: 'rgba(214, 255, 244, 0.95)',
          200: 'rgba(167, 255, 232, 0.9)',
          300: 'var(--vx-success)',
          400: 'var(--vx-success)',
          500: 'var(--vx-success)',
          950: 'rgba(0, 255, 179, 0.16)'
        },
        amber: {
          100: 'rgba(255, 245, 214, 0.95)',
          200: 'rgba(255, 232, 173, 0.92)',
          300: 'var(--vx-warning)',
          400: 'var(--vx-warning)',
          500: 'var(--vx-warning)',
          950: 'rgba(255, 200, 87, 0.16)'
        },
        red: {
          100: 'rgba(255, 224, 229, 0.95)',
          200: 'rgba(255, 190, 200, 0.9)',
          300: 'var(--vx-danger)',
          400: 'var(--vx-danger)',
          500: 'var(--vx-danger)',
          950: 'rgba(255, 93, 115, 0.16)'
        }
      },
      boxShadow: {
        panel: 'var(--vx-shadow)'
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};

export default config;
