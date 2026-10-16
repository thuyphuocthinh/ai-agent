const fs = require('fs');
const path = require('path');

function getTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      results = results.concat(getTsFiles(full));
    } else if (file.endsWith('.ts')) {
      results.push(full);
    }
  });
  return results;
}

const toolFiles = getTsFiles('src/tools');
const importsFromCore = new Set();
toolFiles.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  const regex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    const p = match[1];
    if (p.startsWith('@agent/core') || p.startsWith('../') || p.startsWith('../../')) {
      importsFromCore.add(`${f} -> ${p}`);
    }
  }
});

console.log('Imports in src/tools:');
Array.from(importsFromCore).sort().forEach(imp => console.log(' ', imp));
