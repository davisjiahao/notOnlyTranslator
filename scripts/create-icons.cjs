#!/usr/bin/env node

/**
 * Creates simple placeholder icons for the extension
 * Run with: node scripts/create-icons.js
 */

const fs = require('fs');
const path = require('path');

const ICON_DIR = path.join(__dirname, '..', 'public', 'icons');

// Ensure icons directory exists
if (!fs.existsSync(ICON_DIR)) {
  fs.mkdirSync(ICON_DIR, { recursive: true });
}

// SVG template for the icon
const createSVG = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#grad)" rx="${size * 0.15}"/>
  <text
    x="50%"
    y="50%"
    font-family="Arial, sans-serif"
    font-size="${size * 0.45}"
    font-weight="bold"
    fill="white"
    text-anchor="middle"
    dominant-baseline="central"
  >NT</text>
</svg>
`.trim();

// Note: Creating actual PNG files requires a library like 'sharp' or 'canvas'
// For development, create SVG files that can be converted to PNG later
const sizes = [16, 48, 128];

console.log('Creating placeholder icons...');

sizes.forEach(size => {
  const svg = createSVG(size);
  const filename = `icon${size}.svg`;
  const filepath = path.join(ICON_DIR, filename);

  fs.writeFileSync(filepath, svg);
  console.log(`✓ Created ${filename}`);
});

console.log('\n✓ SVG icons created successfully!');
console.log('\nNote: For production, convert SVG to PNG using:');
console.log('  - Online tool: https://cloudconvert.com/svg-to-png');
console.log('  - ImageMagick: convert icon.svg icon.png');
console.log('  - Or install "sharp" package and use Node.js');

// Create a note file
const noteContent = `
# Icon Files

SVG placeholder icons have been created. For production use, please:

1. Convert these SVG files to PNG format
2. Or create custom PNG icons with a design tool
3. Ensure you have: icon16.png, icon48.png, icon128.png

The manifest.json currently references .png files, so make sure to:
- Convert the SVG files to PNG, OR
- Update manifest.json to use .svg files (note: browser support varies)

## Quick Conversion (with ImageMagick)

\`\`\`bash
cd public/icons
for file in *.svg; do
  convert -background none -density 300 $file \${file%.svg}.png
done
\`\`\`
`.trim();

fs.writeFileSync(path.join(ICON_DIR, 'CONVERSION_NOTE.txt'), noteContent);

console.log('\n📝 See public/icons/CONVERSION_NOTE.txt for PNG conversion instructions');
