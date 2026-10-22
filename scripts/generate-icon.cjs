// A small, dependency-free rasterizer for the original Checkpoint app mark.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const size = 256;
function segment(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
  return Math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay));
}
const pixels = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const color = [0, 0, 0, 0];
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const px = x + (sx + .5)/4, py = y + (sy + .5)/4;
    const dx = Math.max(48-px, 0, px-208), dy = Math.max(48-py, 0, py-208);
    const inside = Math.hypot(dx, dy) <= 36;
    const check = Math.min(segment(px,py,69,129,109,168),segment(px,py,109,168,187,88)) < 13;
    const c = inside ? (check ? [27,36,22,255] : [196,244,132,255]) : [0,0,0,0];
    for (let i = 0; i < 4; i++) color[i] += c[i]/16;
  }
  const offset = y*(size*4+1)+1+x*4;
  for(let i=0;i<4;i++) pixels[offset+i]=Math.round(color[i]);
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i=0;i<8;i++) crc = (crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(type, data) {
  const name = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([len,name,data,crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const header = Buffer.alloc(22);
header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
const dir = path.join(__dirname,'..','assets');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'checkpoint.png'),png);
fs.writeFileSync(path.join(dir,'checkpoint.ico'),Buffer.concat([header,png]));
