import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const outDir = path.join(__dirname, "..", "src-tauri", "icons");
const outFile = path.join(outDir, "icon.ico");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Minimal valid ICO: 6 byte header + 16 byte dir entry + 40 byte BITMAPINFOHEADER + 32*32*4 pixels + 128 AND mask
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0);
entry.writeUInt8(32, 1);
entry.writeUInt16LE(0, 2);   // bColorCount, bReserved
entry.writeUInt16LE(1, 4);   // wPlanes
entry.writeUInt16LE(32, 6);  // wBitCount
const imageSize = 40 + 32 * 32 * 4 + 128;
entry.writeUInt32LE(imageSize, 8);   // dwBytesInRes
entry.writeUInt32LE(22, 12);        // dwImageOffset

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);
bmpHeader.writeInt32LE(32, 4);
bmpHeader.writeInt32LE(64, 8); // height*2 for BMP in ICO
bmpHeader.writeUInt16LE(1, 12);
bmpHeader.writeUInt16LE(32, 14);
bmpHeader.writeUInt32LE(0, 16);
bmpHeader.writeUInt32LE(32 * 32 * 4, 20);

const pixels = Buffer.alloc(32 * 32 * 4);
for (let i = 0; i < 32 * 32 * 4; i += 4) {
  pixels[i] = 70;
  pixels[i + 1] = 130;
  pixels[i + 2] = 180;
  pixels[i + 3] = 255;
}
const andMask = Buffer.alloc(128, 0);

fs.writeFileSync(outFile, Buffer.concat([header, entry, bmpHeader, pixels, andMask]));
console.log("Created:", outFile);
