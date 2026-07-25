/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
          muted: 'hsl(var(--brand-muted))'
        },
        rule: 'hsl(var(--rule) / <alpha-value>)',
        dim: 'hsl(var(--dim) / <alpha-value>)',
        soft: 'hsl(var(--soft-fg) / <alpha-value>)',
        quiet: 'hsl(var(--quiet-fg) / <alpha-value>)',
        bone: 'hsl(var(--bone) / <alpha-value>)',
        ok: 'hsl(var(--ok) / <alpha-value>)',
        ember: 'hsl(var(--ember) / <alpha-value>)',
        'panel-hi': 'hsl(var(--panel-hi) / <alpha-value>)',
        signal: {
          DEFAULT: 'hsl(var(--brand) / <alpha-value>)',
          deep: 'hsl(var(--brand-muted) / <alpha-value>)'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)'
      },
      fontFamily: {
        sans: ['Inter Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      animation: {
        'pulse-signal': 'pulse-signal 2.4s ease-in-out infinite',
        'pulse-signal-fast': 'pulse-signal 1.6s ease-in-out infinite'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
