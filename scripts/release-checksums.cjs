const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {version} = require('../package.json');
const files = [`Checkpoint-${version}-Windows.exe`, `Checkpoint-${version}-Setup.exe`];
const lines = files.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..','dist',name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(__dirname,'..','dist','SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Checksums generated for ${files.length} Windows builds.`);
