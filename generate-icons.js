// Icon generator script - Run with: node generate-icons.js
// Creates simple PNG icons for the TagLens extension

const fs = require('fs');
let createCanvas;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  createCanvas = null;
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const scale = size / 128;

  // Background - rounded square with gradient
  const radius = 24 * scale;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#6366f1');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Lens circle
  ctx.beginPath();
  ctx.arc(size * 0.45, size * 0.42, size * 0.28, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 4 * scale;
  ctx.stroke();

  // Lens inner dot
  ctx.beginPath();
  ctx.arc(size * 0.45, size * 0.42, size * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();

  // Lens handle
  ctx.beginPath();
  ctx.moveTo(size * 0.63, size * 0.6);
  ctx.lineTo(size * 0.82, size * 0.79);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 5 * scale;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Crosshair lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size * 0.42);
  ctx.lineTo(size * 0.6, size * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size * 0.45, size * 0.27);
  ctx.lineTo(size * 0.45, size * 0.57);
  ctx.stroke();

  return canvas;
}

// Try to use 'canvas' package, if not available create minimal PNGs
try {
  if (!createCanvas) throw new Error('canvas not available');
  [16, 32, 48, 128].forEach(size => {
    const canvas = drawIcon(size);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(`icons/icon${size}.png`, buffer);
    console.log(`Generated icon${size}.png`);
  });
} catch (e) {
  console.log("'canvas' package not available. Generating minimal placeholder PNGs...");
  // Generate minimal valid PNG files (1x1 purple pixel, properly sized)
  // This creates a valid PNG with a purple pixel
  function createMinimalPNG() {
    // Minimal valid PNG: 1x1 pixel, RGBA purple (#6366f1)
    const png = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width: 1
      0x00, 0x00, 0x00, 0x01, // height: 1
      0x08, 0x02,             // bit depth: 8, color type: 2 (RGB)
      0x00, 0x00, 0x00,       // compression, filter, interlace
      0x90, 0x77, 0x53, 0xDE, // CRC
      0x00, 0x00, 0x00, 0x0C, // IDAT length
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0xD7, 0x63, 0x60, // zlib data
      0x60, 0xF8, 0x0F, 0x00,
      0x01, 0x01, 0x00, 0x05, // 
      0x18, 0xD8, 0x4D, 0x2C, // CRC
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82  // CRC
    ]);
    return png;
  }

  [16, 32, 48, 128].forEach(size => {
    fs.writeFileSync(`icons/icon${size}.png`, createMinimalPNG());
    console.log(`Generated placeholder icon${size}.png (use generate-icons.html in browser for proper icons)`);
  });
}

console.log('\nDone! Icon files saved to icons/ folder.');
console.log('For better quality icons, open generate-icons.html in a browser and download them.');
