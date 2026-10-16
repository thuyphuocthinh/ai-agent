const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'src');

// 1. Move directories
const moves = [
  { from: path.join(srcDir, 'core', 'cancellation'), to: path.join(srcDir, 'cancellation') },
  { from: path.join(srcDir, 'core', 'hitl'), to: path.join(srcDir, 'hitl') },
  { from: path.join(srcDir, 'core', 'loop'), to: path.join(srcDir, 'loop') },
  { from: path.join(srcDir, 'core', 'orchestrator'), to: path.join(srcDir, 'orchestrator') },
  { from: path.join(srcDir, 'core', 'strategy'), to: path.join(srcDir, 'strategy') },
  { from: path.join(srcDir, 'core', 'supervisor'), to: path.join(srcDir, 'supervisor') },
  { from: path.join(srcDir, 'interfaces', 'contracts'), to: path.join(srcDir, 'contracts') },
];

moves.forEach(({ from, to }) => {
  if (fs.existsSync(from)) {
    if (!fs.existsSync(to)) {
      fs.renameSync(from, to);
      console.log(`Moved ${from} -> ${to}`);
    }
  }
});

// Remove core/index.ts and core dir if empty
const coreIndex = path.join(srcDir, 'core', 'index.ts');
if (fs.existsSync(coreIndex)) fs.unlinkSync(coreIndex);
const coreDir = path.join(srcDir, 'core');
if (fs.existsSync(coreDir) && fs.readdirSync(coreDir).length === 0) {
  fs.rmdirSync(coreDir);
  console.log('Removed empty src/core directory');
}

// 2. Gather all .ts files in src
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

const files = getTsFiles(srcDir);

// 3. Rewrite imports
files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Replace @agent/core/core/* with @agent/core/*
  content = content.replace(/@agent\/core\/core\//g, '@agent/core/');

  // Replace @agent/core/interfaces/contracts with @agent/core/contracts
  content = content.replace(/@agent\/core\/interfaces\/contracts/g, '@agent/core/contracts');

  // If file was previously inside src/core/<subfolder>, its depth relative to src was 2 (now 1).
  // Check if file is in one of the moved folders:
  const relToSrc = path.relative(srcDir, filePath);
  const parts = relToSrc.split(path.sep);
  const topFolder = parts[0];

  const wasMovedFromCore = ['cancellation', 'hitl', 'loop', 'orchestrator', 'strategy', 'supervisor'].includes(topFolder);
  const wasMovedFromInterfaces = topFolder === 'contracts';

  if (wasMovedFromCore) {
    // Relative imports going up to src was ../../, now it is ../
    // But relative imports within core (e.g. ../loop from hitl) were ../loop and are STILL ../loop!
    // So ../../common/ becomes ../common/
    // ../../dto/ becomes ../dto/
    // ../../entity/ becomes ../entity/
    // ../../infrastructure/ becomes ../infrastructure/
    // ../../memory/ becomes ../memory/
    // ../../security/ becomes ../security/
    // ../../tools/ becomes ../tools/
    // ../../constants becomes ../constants
    // ../../contracts becomes ../contracts
    // ../../interfaces/contracts becomes ../contracts
    // ../../interfaces/cli becomes ../interfaces/cli
    content = content.replace(/\.\.\/\.\.\/(common|dto|entity|infrastructure|memory|security|tools|constants)/g, '../$1');
    content = content.replace(/\.\.\/\.\.\/interfaces\/contracts/g, '../contracts');
    content = content.replace(/\.\.\/\.\.\/interfaces\/cli/g, '../interfaces/cli');
  }

  if (wasMovedFromInterfaces) {
    // Inside src/contracts:
    // was ../../dto -> now ../dto
    // was ../contracts -> now ./
    content = content.replace(/\.\.\/\.\.\/(common|dto|entity|infrastructure|memory|security|tools|constants)/g, '../$1');
    content = content.replace(/\.\.\/contracts\//g, './');
  }

  // Files outside that were importing ./core/* or ../core/*:
  content = content.replace(/(['"])\.\/core\/(cancellation|hitl|loop|orchestrator|strategy|supervisor)/g, '$1./$2');
  content = content.replace(/(['"])\.\.\/core\/(cancellation|hitl|loop|orchestrator|strategy|supervisor)/g, '$1../$2');
  content = content.replace(/(['"])\.\.\/\.\.\/core\/(cancellation|hitl|loop|orchestrator|strategy|supervisor)/g, '$1../../$2');

  // Interfaces contracts references:
  content = content.replace(/(['"])\.\/interfaces\/contracts/g, '$1./contracts');
  content = content.replace(/(['"])\.\.\/interfaces\/contracts/g, '$1../contracts');
  content = content.replace(/(['"])\.\.\/\.\.\/interfaces\/contracts/g, '$1../../contracts');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated imports in: ${relToSrc}`);
  }
});

console.log('Flattening migration complete!');
