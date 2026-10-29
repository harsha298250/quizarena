const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function woffToTtf(woffBuf) {
  const flavor = woffBuf.readUInt32BE(4);
  const numTables = woffBuf.readUInt16BE(12);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const ttfHeader = Buffer.alloc(12);
  ttfHeader.writeUInt32BE(flavor, 0);
  ttfHeader.writeUInt16BE(numTables, 4);
  ttfHeader.writeUInt16BE(searchRange, 6);
  ttfHeader.writeUInt16BE(entrySelector, 8);
  ttfHeader.writeUInt16BE(rangeShift, 10);

  let woffOffset = 44;
  const tableEntries = [];
  for (let i = 0; i < numTables; i++) {
    const tag = woffBuf.slice(woffOffset, woffOffset + 4).toString('ascii');
    const offset = woffBuf.readUInt32BE(woffOffset + 4);
    const compLength = woffBuf.readUInt32BE(woffOffset + 8);
    const origLength = woffBuf.readUInt32BE(woffOffset + 12);
    const origChecksum = woffBuf.readUInt32BE(woffOffset + 16);
    tableEntries.push({ tag, offset, compLength, origLength, origChecksum });
    woffOffset += 20;
  }

  let currentOffset = 12 + numTables * 16;
  const tableDir = Buffer.alloc(numTables * 16);
  const tableDataBufs = [];

  for (let i = 0; i < numTables; i++) {
    const entry = tableEntries[i];
    let data = woffBuf.slice(entry.offset, entry.offset + entry.compLength);
    if (entry.compLength < entry.origLength) {
      data = zlib.inflateSync(data);
    }
    const pad = (4 - (data.length % 4)) % 4;
    const paddedData = pad > 0 ? Buffer.concat([data, Buffer.alloc(pad)]) : data;

    tableDir.write(entry.tag, i * 16, 4, 'ascii');
    tableDir.writeUInt32BE(entry.origChecksum, i * 16 + 4);
    tableDir.writeUInt32BE(currentOffset, i * 16 + 8);
    tableDir.writeUInt32BE(entry.origLength, i * 16 + 12);

    currentOffset += paddedData.length;
    tableDataBufs.push(paddedData);
  }

  return Buffer.concat([ttfHeader, tableDir, ...tableDataBufs]);
}

const tamilWoffPath = path.join(__dirname, '../node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff');
const devanagariWoffPath = path.join(__dirname, '../node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff');

const tamilTtf = woffToTtf(fs.readFileSync(tamilWoffPath));
const devanagariTtf = woffToTtf(fs.readFileSync(devanagariWoffPath));

const outPath = path.join(__dirname, '../src/services/unicodeFontData.ts');
const fileContent = `/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Self-hosted TrueType Unicode fonts extracted from bundled @fontsource packages.
 */

export const NOTO_SANS_TAMIL_BASE64 = ${JSON.stringify(tamilTtf.toString('base64'))};
export const NOTO_SANS_DEVANAGARI_BASE64 = ${JSON.stringify(devanagariTtf.toString('base64'))};
`;

fs.writeFileSync(outPath, fileContent, 'utf-8');
console.log('Successfully generated src/services/unicodeFontData.ts');

