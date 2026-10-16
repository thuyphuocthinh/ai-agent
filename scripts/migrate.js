const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function getAllFiles(dir) {
  let res = [];
  if (!fs.existsSync(dir)) return res;
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      res = res.concat(getAllFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.js')) {
      res.push(full);
    }
  }
  return res;
}

// 1. Define migration map (relative to src/)
const migrationMap = new Map();

function mapMove(oldRel, newRel) {
  migrationMap.set(oldRel.replace(/\\/g, '/'), newRel.replace(/\\/g, '/'));
}

function mapDir(oldDir, newDir) {
  const fullOldDir = path.join(SRC, oldDir);
  if (!fs.existsSync(fullOldDir)) return;
  const files = getAllFiles(fullOldDir);
  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const subRel = path.relative(fullOldDir, file).replace(/\\/g, '/');
    const targetRel = path.join(newDir, subRel).replace(/\\/g, '/');
    mapMove(rel, targetRel);
  }
}

// Tools
mapDir('mcp', 'tools/mcp');
mapDir('mcp-auth', 'tools/mcp');
mapDir('parser', 'tools/openapi');
mapDir('registry', 'tools/registry');

// Executor (except pii files)
const fullExecutorDir = path.join(SRC, 'executor');
if (fs.existsSync(fullExecutorDir)) {
  const files = getAllFiles(fullExecutorDir);
  for (const file of files) {
    const name = path.basename(file);
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    if (name.startsWith('pii-')) {
      if (name.endsWith('.spec.ts')) {
        mapMove(rel, `security/pii/${name}`);
      }
    } else {
      mapMove(rel, `tools/executor/${name}`);
    }
  }
}

// Cancellation
mapDir('cancellation', 'core/cancellation');

// Checkpoint & Trigger Claim -> HITL
mapDir('checkpoint', 'core/hitl');
mapDir('trigger-claim', 'core/hitl');

// Processor
const fullProcessorDir = path.join(SRC, 'processor');
if (fs.existsSync(fullProcessorDir)) {
  const files = getAllFiles(fullProcessorDir);
  for (const file of files) {
    const name = path.basename(file);
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    if (name.startsWith('approval-') || name.startsWith('checkpoint-pause')) {
      mapMove(rel, `core/hitl/${name}`);
    } else {
      mapMove(rel, `core/orchestrator/${name}`);
    }
  }
}

// LLM
const fullLlmDir = path.join(SRC, 'llm');
if (fs.existsSync(fullLlmDir)) {
  const files = getAllFiles(fullLlmDir);
  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const subRel = path.relative(fullLlmDir, file).replace(/\\/g, '/');
    const name = path.basename(file);
    if (subRel.startsWith('strategy/')) {
      const stratName = path.relative(path.join(fullLlmDir, 'strategy'), file).replace(/\\/g, '/');
      mapMove(rel, `core/strategy/${stratName}`);
    } else if (name.startsWith('supervisor') || name.startsWith('agent-ranking')) {
      mapMove(rel, `core/supervisor/${name}`);
    } else {
      mapMove(rel, `core/loop/${name}`);
    }
  }
}

// Socket & root legacy slack
mapDir('socket', 'interfaces/legacy-slack');
mapMove('message-client.service.ts', 'interfaces/legacy-slack/message-client.service.ts');
mapMove('message-client.service.spec.ts', 'interfaces/legacy-slack/message-client.service.spec.ts');
mapMove('orchestration.controller.ts', 'interfaces/legacy-slack/orchestration.controller.ts');
mapMove('orchestration.controller.spec.ts', 'interfaces/legacy-slack/orchestration.controller.spec.ts');

console.log(`Registered ${migrationMap.size} file migrations.`);

// Build index of old and new locations
const oldToNewLookup = new Map();
for (const [oldRel, newRel] of migrationMap.entries()) {
  const oldNoExt = oldRel.replace(/\.(ts|js)$/, '');
  const newNoExt = newRel.replace(/\.(ts|js)$/, '');
  oldToNewLookup.set(oldNoExt, newNoExt);
}
oldToNewLookup.set('executor/pii-scrubber.util', 'security/pii/pii-scrubber.util');
oldToNewLookup.set('executor/pii-scrub.processor', 'security/pii/pii-scrub.processor');

// All TS files currently in SRC
const allSrcFiles = getAllFiles(SRC);

// Function to resolve an import path from a file
function resolveNewImport(currentFileNewRel, importSpecifier) {
  let targetSrcRel = null;

  if (importSpecifier.startsWith('@agent/core/')) {
    targetSrcRel = importSpecifier.replace('@agent/core/', '');
  } else if (importSpecifier.startsWith('.')) {
    // Current file old location
    let currentOldRel = null;
    for (const [oldRel, newRel] of migrationMap.entries()) {
      if (newRel === currentFileNewRel) {
        currentOldRel = oldRel;
        break;
      }
    }
    if (!currentOldRel) {
      currentOldRel = currentFileNewRel;
    }
    const currentOldDir = path.dirname(path.join(SRC, currentOldRel));
    const resolvedAbs = path.resolve(currentOldDir, importSpecifier);
    targetSrcRel = path.relative(SRC, resolvedAbs).replace(/\\/g, '/');
  } else {
    // External package
    return importSpecifier;
  }

  // Normalize targetSrcRel (remove .ts/.js if present)
  const targetNoExt = targetSrcRel.replace(/\.(ts|js)$/, '');

  // Check if target was moved
  const targetNewNoExt = oldToNewLookup.has(targetNoExt) ? oldToNewLookup.get(targetNoExt) : targetNoExt;

  if (importSpecifier.startsWith('@agent/core/')) {
    return `@agent/core/${targetNewNoExt}`;
  }

  // Calculate new relative path
  const currentNewDir = path.dirname(path.join(SRC, currentFileNewRel));
  const targetNewAbs = path.join(SRC, targetNewNoExt);
  let relPath = path.relative(currentNewDir, targetNewAbs).replace(/\\/g, '/');
  if (!relPath.startsWith('.')) {
    relPath = './' + relPath;
  }
  return relPath;
}

// Regex for finding and replacing import/export specifiers
const specifierRegex = /((?:from|import|require)\s*\(?\s*['"])([^'"]+)(['"]\)?)/g;

// Step 1: Read all files, update imports, and prepare memory writes
const pendingWrites = new Map();
const filesToDelete = new Set();

for (const file of allSrcFiles) {
  const oldRel = path.relative(SRC, file).replace(/\\/g, '/');

  // Skip old forwarding files that are getting deleted
  if (oldRel === 'executor/pii-scrubber.util.ts' || oldRel === 'executor/pii-scrub.processor.ts') {
    filesToDelete.add(file);
    continue;
  }

  // If this is src/core/index.ts or src/tools/index.ts or src/interfaces/index.ts, we will overwrite with fresh barrels later
  if (oldRel === 'core/index.ts' || oldRel === 'tools/index.ts' || oldRel === 'interfaces/index.ts') {
    continue;
  }

  const newRel = migrationMap.has(oldRel) ? migrationMap.get(oldRel) : oldRel;
  const newAbs = path.join(SRC, newRel);

  let content = fs.readFileSync(file, 'utf8');

  // Update specifiers
  content = content.replace(specifierRegex, (match, prefix, specifier, suffix) => {
    if (specifier.startsWith('.') || specifier.startsWith('@agent/core/')) {
      const newSpecifier = resolveNewImport(newRel, specifier);
      return `${prefix}${newSpecifier}${suffix}`;
    }
    return match;
  });

  pendingWrites.set(newAbs, content);

  if (file !== newAbs) {
    filesToDelete.add(file);
  }
}

// Step 2: Write all new files
for (const [newAbs, content] of pendingWrites.entries()) {
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  fs.writeFileSync(newAbs, content, 'utf8');
}

// Step 3: Delete old files
for (const oldAbs of filesToDelete) {
  if (fs.existsSync(oldAbs) && !pendingWrites.has(oldAbs)) {
    fs.unlinkSync(oldAbs);
  }
}

// Step 4: Remove empty old directories
const oldDirs = [
  'cancellation',
  'checkpoint',
  'trigger-claim',
  'executor',
  'mcp',
  'mcp-auth',
  'parser',
  'registry',
  'socket',
  'llm/strategy',
  'llm',
  'processor'
];

for (const d of oldDirs) {
  const fullD = path.join(SRC, d);
  if (fs.existsSync(fullD)) {
    try {
      fs.rmSync(fullD, { recursive: true, force: true });
      console.log(`Cleaned up old directory: ${d}`);
    } catch (e) {
      console.error(`Failed to remove ${d}:`, e.message);
    }
  }
}

// Step 5: Write clean, proper domain barrel index files
fs.writeFileSync(path.join(SRC, 'core/index.ts'), `// Layer 2: Core Orchestration Engine
export * from './loop';
export * from './strategy';
export * from './supervisor';
export * from './orchestrator';
export * from './hitl';
export * from './cancellation';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'core/loop/index.ts'), `export * from './react-loop.service';
export * from './react-loop-run';
export * from './tool-call-executor';
export * from './tool-repeat-guard';
export * from './tool-risk-gate';
export * from './approval-required.error';
export * from './turn-cancelled.error';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'core/strategy/index.ts'), `export * from './llm-strategy.interface';
export * from './llm-strategy.factory';
export * from './gemini.strategy';
export * from './openai.strategy';
export * from './anthropic.strategy';
export * from './mock.strategy';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'core/supervisor/index.ts'), `export * from './supervisor.service';
export * from './agent-ranking.service';
export * from './supervisor-prompt.builder';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'core/orchestrator/index.ts'), `export * from './ai-orchestration.processor';
export * from './turn-resolver.service';
export * from './turn-resolver-run';
export * from './dynamic-provider.processor';
export * from './orchestration-answer.types';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'core/hitl/index.ts'), `export * from './checkpoint.service';
export * from './checkpoint-cleanup.service';
export * from './trigger-claim.service';
export * from './approval-request.service';
export * from './approval-execution.service';
export * from './approval-continuation-planner.service';
export * from './approval-skill-recorder.service';
export * from './checkpoint-pause.service';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'core/cancellation/index.ts'), `export * from './agent-cancellation.service';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'tools/index.ts'), `// Layer 5: Tool Integration & Execution
export * from './mcp';
export * from './openapi';
export * from './registry';
export * from './executor';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'tools/mcp/index.ts'), `export * from './mcp-client.service';
export * from './relay-client.transport';
export * from './route-key.util';
export * from './mcp-auth-client.service';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'tools/openapi/index.ts'), `export * from './openapi-parser.service';
export * from './openapi-converter.util';
export * from './ssrf-safe-http-reader.util';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'tools/registry/index.ts'), `export * from './agents.registry';
export * from './dynamic-tool-registry.service';
export * from './dynamic-provider-db.service';
export * from './provider-summary.service';
export * from './openai-embedding.provider';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'tools/executor/index.ts'), `export * from './dynamic-tool-executor.service';
export * from './openapi-security.injector';
export * from './tool-error-classifier.util';
export * from './tool-result-size-cap.util';
export * from './read-only-round-heuristic.util';
export * from './parse-insert-values.util';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'interfaces/index.ts'), `// Layer 4: Interface Adapters
export * from './contracts';
export * from './cli';
export * from './legacy-slack';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'interfaces/legacy-slack/index.ts'), `export * from './message-client.service';
export * from './orchestration.controller';
export * from './agent-stream.service';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'interfaces/cli/index.ts'), `export * from './cli.service';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'security/index.ts'), `export * from './pii';
`, 'utf8');

fs.writeFileSync(path.join(SRC, 'security/pii/index.ts'), `export * from './pii-scrubber.util';
export * from './pii-scrub.processor';
`, 'utf8');

// Update orchestration.module.ts
const orchModulePath = path.join(SRC, 'orchestration.module.ts');
let orchModule = fs.readFileSync(orchModulePath, 'utf8');
orchModule = orchModule
  .replace(/\.\/orchestration\.controller/g, './interfaces/legacy-slack/orchestration.controller')
  .replace(/\.\/processor\/ai-orchestration\.processor/g, './core/orchestrator/ai-orchestration.processor')
  .replace(/\.\/processor\/dynamic-provider\.processor/g, './core/orchestrator/dynamic-provider.processor')
  .replace(/\.\/mcp\/mcp-client\.service/g, './tools/mcp/mcp-client.service')
  .replace(/\.\/mcp-auth\/mcp-auth-client\.service/g, './tools/mcp/mcp-auth-client.service')
  .replace(/\.\/llm\/react-loop\.service/g, './core/loop/react-loop.service')
  .replace(/\.\/llm\/supervisor\.service/g, './core/supervisor/supervisor.service')
  .replace(/\.\/llm\/agent-ranking\.service/g, './core/supervisor/agent-ranking.service')
  .replace(/\.\/llm\/supervisor-prompt\.builder/g, './core/supervisor/supervisor-prompt.builder')
  .replace(/\.\/message-client\.service/g, './interfaces/legacy-slack/message-client.service')
  .replace(/\.\/llm\/strategy\/llm-strategy\.factory/g, './core/strategy/llm-strategy.factory')
  .replace(/\.\/llm\/strategy\/gemini\.strategy/g, './core/strategy/gemini.strategy')
  .replace(/\.\/llm\/strategy\/openai\.strategy/g, './core/strategy/openai.strategy')
  .replace(/\.\/llm\/strategy\/anthropic\.strategy/g, './core/strategy/anthropic.strategy')
  .replace(/\.\/llm\/strategy\/mock\.strategy/g, './core/strategy/mock.strategy')
  .replace(/\.\/socket\/agent-stream\.service/g, './interfaces/legacy-slack/agent-stream.service')
  .replace(/\.\/checkpoint\/checkpoint\.service/g, './core/hitl/checkpoint.service')
  .replace(/\.\/checkpoint\/checkpoint-cleanup\.service/g, './core/hitl/checkpoint-cleanup.service')
  .replace(/\.\/trigger-claim\/trigger-claim\.service/g, './core/hitl/trigger-claim.service')
  .replace(/\.\/parser\/openapi-parser\.service/g, './tools/openapi/openapi-parser.service')
  .replace(/\.\/registry\/dynamic-tool-registry\.service/g, './tools/registry/dynamic-tool-registry.service')
  .replace(/\.\/registry\/dynamic-provider-db\.service/g, './tools/registry/dynamic-provider-db.service')
  .replace(/\.\/registry\/provider-summary\.service/g, './tools/registry/provider-summary.service')
  .replace(/\.\/registry\/openai-embedding\.provider/g, './tools/registry/openai-embedding.provider')
  .replace(/\.\/executor\/dynamic-tool-executor\.service/g, './tools/executor/dynamic-tool-executor.service')
  .replace(/\.\/cancellation\/agent-cancellation\.service/g, './core/cancellation/agent-cancellation.service')
  .replace(/\.\/processor\/turn-resolver\.service/g, './core/orchestrator/turn-resolver.service')
  .replace(/\.\/processor\/checkpoint-pause\.service/g, './core/hitl/checkpoint-pause.service')
  .replace(/\.\/processor\/approval-request\.service/g, './core/hitl/approval-request.service')
  .replace(/\.\/processor\/approval-execution\.service/g, './core/hitl/approval-execution.service')
  .replace(/\.\/processor\/approval-continuation-planner\.service/g, './core/hitl/approval-continuation-planner.service')
  .replace(/\.\/processor\/approval-skill-recorder\.service/g, './core/hitl/approval-skill-recorder.service');

// Add CliService import and provider to orchestration.module.ts if not present
if (!orchModule.includes('CliService')) {
  orchModule = orchModule.replace(
    "import { ApprovalSkillRecorderService } from './core/hitl/approval-skill-recorder.service';",
    "import { ApprovalSkillRecorderService } from './core/hitl/approval-skill-recorder.service';\nimport { CliService } from './interfaces/cli/cli.service';"
  );
  orchModule = orchModule.replace(
    'ApprovalSkillRecorderService,',
    'ApprovalSkillRecorderService,\n    CliService,'
  );
}

fs.writeFileSync(orchModulePath, orchModule, 'utf8');

// Update src/index.ts
const indexPath = path.join(SRC, 'index.ts');
fs.writeFileSync(indexPath, `export * from './constants';
export * from './common';
export * from './infrastructure';
export * from './interfaces';
export * from './core';
export * from './tools';
export * from './security';
export * from './orchestration.module';
`, 'utf8');

console.log('File physical migration completed successfully!');
