// Quick icon placeholder generator - creates valid minimal PNGs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createPNG(width, height, r, g, b) {
  // Create raw image data (filter byte + RGB for each row)
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b);
    }
  }
  const raw = Buffer.from(rawData);
  const compressed = zlib.deflateSync(raw);

  const chunks = [];
  
  // PNG Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrType = Buffer.from('IHDR');
  const ihdrLen = Buffer.alloc(4); ihdrLen.writeUInt32BE(13, 0);
  const ihdrCrc = Buffer.alloc(4); ihdrCrc.writeUInt32BE(crc32(Buffer.concat([ihdrType, ihdr])), 0);
  chunks.push(ihdrLen, ihdrType, ihdr, ihdrCrc);

  // IDAT
  const idatType = Buffer.from('IDAT');
  const idatLen = Buffer.alloc(4); idatLen.writeUInt32BE(compressed.length, 0);
  const idatCrc = Buffer.alloc(4); idatCrc.writeUInt32BE(crc32(Buffer.concat([idatType, compressed])), 0);
  chunks.push(idatLen, idatType, compressed, idatCrc);

  // IEND
  const iendType = Buffer.from('IEND');
  const iendLen = Buffer.alloc(4); iendLen.writeUInt32BE(0, 0);
  const iendCrc = Buffer.alloc(4); iendCrc.writeUInt32BE(crc32(iendType), 0);
  chunks.push(iendLen, iendType, iendCrc);

  return Buffer.concat(chunks);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

// Create purple (#6366f1) icons at each size
[16, 32, 48, 128].forEach(size => {
  const png = createPNG(size, size, 99, 102, 241);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png (${size}x${size})`);
});

console.log('\nDone! For better icons, open generate-icons.html in your browser.');
