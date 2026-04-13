/**
 * generate-icon.mjs — placeholder app icon generator.
 *
 * Run with: `node scripts/generate-icon.mjs`
 *
 * Produces:
 *   build/icon.svg   — vector source, edit me to redesign
 *   build/icon.png   — 1024x1024 raster, what electron-builder consumes
 *
 * electron-builder auto-derives platform-specific formats from icon.png:
 *   - macOS .icns (multi-resolution Apple icon container)
 *   - Windows .ico (multi-resolution Windows icon container)
 *
 * Replacing the icon later: edit build/icon.svg, re-run this script,
 * commit the new icon.png. No code changes needed.
 *
 * Design rationale:
 *   The placeholder is a serif "P" in warm gold on a dark slate
 *   background — matches the "Sacred Calm" design system used in the
 *   app itself. The serif "P" mirrors the font-editorial wordmark on
 *   the Home page so the icon and the in-app brand stay coherent.
 */

import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const buildDir = join(__dirname, '..', 'build')

// Color tokens — kept in sync with the app's design tokens
// (--background = 240 10% 5%, --brand = 38 88% 62%).
const BG = '#0E0E14' // dark slate, matches app background
const FG = '#F5BC4E' // warm gold, matches app brand
const FG_GLOW = '#FFD37A' // brighter gold for radial highlight

// 1024×1024 SVG. The "P" is hand-pathed so it doesn't depend on a
// specific font being installed at build time. The path approximates
// a high-contrast serif Bowl-and-Stem capital P with a generous
// counter and a chunky stem foot for warmth.
//
// rx=180 on the background gives macOS/iOS-style "squircle" rounding
// even though the OS will further round on macOS to its own mask.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="glow" cx="50%" cy="35%" r="65%">
      <stop offset="0%"   stop-color="${FG_GLOW}" stop-opacity="0.18"/>
      <stop offset="60%"  stop-color="${FG}"      stop-opacity="0.0"/>
      <stop offset="100%" stop-color="${FG}"      stop-opacity="0.0"/>
    </radialGradient>
    <linearGradient id="goldFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#FFD37A"/>
      <stop offset="55%"  stop-color="${FG}"/>
      <stop offset="100%" stop-color="#D89A2E"/>
    </linearGradient>
  </defs>

  <!-- Background squircle in deep slate -->
  <rect x="0" y="0" width="1024" height="1024" rx="200" ry="200" fill="${BG}"/>

  <!-- Soft brand glow corner -->
  <rect x="0" y="0" width="1024" height="1024" rx="200" ry="200" fill="url(#glow)"/>

  <!--
    Serif "P" — drawn as a single filled path so it scales perfectly
    at every resolution and never depends on font availability.

    Stem on the left, bowl on top right. Coordinates picked by eye
    against a 1024x1024 grid; numbers tuned to feel substantial
    without crowding the squircle edge.
  -->
  <g fill="url(#goldFill)">
    <!-- Outer bowl: a closed shape combining stem + bowl -->
    <path d="
      M 320 200
      L 320 824
      L 460 824
      L 460 580
      L 580 580
      C 720 580 808 510 808 390
      C 808 270 720 200 580 200
      Z
      M 460 320
      L 580 320
      C 650 320 685 350 685 390
      C 685 430 650 460 580 460
      L 460 460
      Z
    " fill-rule="evenodd"/>

    <!-- Stem foot serif (left-right slabs at the bottom) -->
    <rect x="270" y="804" width="240" height="40" rx="6"/>

    <!-- Top serif on the stem (left-right slabs at the top of the stem) -->
    <rect x="270" y="180" width="240" height="40" rx="6"/>
  </g>
</svg>
`

async function main() {
  const svgPath = join(buildDir, 'icon.svg')
  const pngPath = join(buildDir, 'icon.png')

  await writeFile(svgPath, svg, 'utf8')
  console.log(`✓ wrote ${svgPath}`)

  // Render at native 1024×1024. sharp's SVG renderer uses librsvg on
  // Linux and resvg on macOS/Windows by default — both produce
  // identical pixel output for our flat shapes.
  await sharp(Buffer.from(svg))
    .resize(1024, 1024)
    .png({ compressionLevel: 9 })
    .toFile(pngPath)
  console.log(`✓ wrote ${pngPath} (1024×1024 PNG)`)

  // Helpful note for future-me when replacing the icon
  console.log('')
  console.log('To replace this icon later:')
  console.log('  1. Edit build/icon.svg (or replace it with your own SVG)')
  console.log('  2. Run: node scripts/generate-icon.mjs')
  console.log('  3. Commit build/icon.png')
}

main().catch((err) => {
  console.error('icon generation failed:', err)
  process.exit(1)
})
