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

const allFiles = getTsFiles('src').filter(f => !f.includes('src\\tools\\') && !f.includes('src/tools/'));
const importsTools = [];
allFiles.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  const regex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    const p = match[1];
    if (p.includes('/tools') || p.includes('\\tools') || p.startsWith('@agent/tools')) {
      importsTools.push(`${f} -> ${p}`);
    }
  }
});

console.log('Files importing tools:');
importsTools.forEach(imp => console.log(' ', imp));
