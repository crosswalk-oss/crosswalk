/** Tokens live as CSS variables in src/index.css; Tailwind maps names to them. */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ground: v('ground'),      // page background
        surface: v('surface'),    // panels
        sunken: v('sunken'),      // wells, table heads
        line: v('line'),          // borders
        ink: v('ink'),            // primary text
        muted: v('muted'),        // secondary text
        faint: v('faint'),        // tertiary text
        steel: v('steel'),        // brand neutral (nav rail): sand in the light palette
        steelink: v('steelink'),  // text on steel
        marker: v('marker'),      // accent: pipeline-marker amber
        markerink: v('markerink'),// text on marker
        link: v('link'),          // interactive blue
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
        info: v('info'),
        c1: v('c1'), c2: v('c2'), c3: v('c3'), c4: v('c4'), // chart fills: blue, green, orange, berry
      },
      fontFamily: {
        // System fonts only: no web-font downloads (the app makes no third-party requests).
        display: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '12px' },
    },
  },
  plugins: [],
}
