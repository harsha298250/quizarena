import fs from 'fs';
import zlib from 'zlib';

function createPng(width, height, r, g, b) {
  // Simple PNG generator with raw RGBA data
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // Compression
  ihdrData.writeUInt8(0, 11); // Filter
  ihdrData.writeUInt8(0, 12); // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw image data with filter type 0 (None) per scanline
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData.writeUInt8(0, rowOffset); // filter 0
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      // Border check for playful paper look
      const isBorder = x < 6 || x >= width - 6 || y < 6 || y >= height - 6;
      const isInner = x > 14 && x < width - 14 && y > 14 && y < height - 14;
      if (isBorder) {
        rawData.writeUInt8(22, pxOffset);     // #16
        rawData.writeUInt8(18, pxOffset + 1); // #12
        rawData.writeUInt8(14, pxOffset + 2); // #0E
        rawData.writeUInt8(255, pxOffset + 3);
      } else if (isInner) {
        // Inner sunshine or tomato
        rawData.writeUInt8(r, pxOffset);
        rawData.writeUInt8(g, pxOffset + 1);
        rawData.writeUInt8(b, pxOffset + 2);
        rawData.writeUInt8(255, pxOffset + 3);
      } else {
        // Paper background #FFF6E5
        rawData.writeUInt8(255, pxOffset);
        rawData.writeUInt8(246, pxOffset + 1);
        rawData.writeUInt8(229, pxOffset + 2);
        rawData.writeUInt8(255, pxOffset + 3);
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeInt32BE(crc, 8 + len);
  return chunk;
}

// Simple CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) | 0;
}

if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
}

// Generate PWA icons in tomato color #FF5A36 (255, 90, 54)
fs.writeFileSync('public/pwa-192x192.png', createPng(192, 192, 255, 90, 54));
fs.writeFileSync('public/pwa-512x512.png', createPng(512, 512, 255, 90, 54));
fs.writeFileSync('public/pwa-maskable-512x512.png', createPng(512, 512, 255, 200, 61)); // sunshine
fs.writeFileSync('public/apple-touch-icon.png', createPng(180, 180, 255, 90, 54));
console.log('PWA icons created successfully in public/');
