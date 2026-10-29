const fs = require('fs');
const path = require('path');

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(fullPath);
    }
  });
  return results;
}

const files = getFiles('src');
let hexMatches = [];

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, lineIdx) => {
    const regex = /className=(?:\{`([\s\S]*?)`\}|"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const classStr = match[1] || match[2] || match[3] || '';
      const hexes = classStr.match(/#[0-9a-fA-F]{3,8}/g);
      if (hexes) {
        hexMatches.push({ file: f, line: lineIdx + 1, hexes, classStr: classStr.trim().replace(/\s+/g, ' ') });
      }
    }
  });
});

console.log('Hex in className count:', hexMatches.length);
hexMatches.forEach(r => console.log(`${r.file}:${r.line} [${r.hexes.join(', ')}] -> ${r.classStr}`));
