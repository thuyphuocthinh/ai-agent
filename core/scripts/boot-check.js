/**
 * Smoke test khởi động core: chạy src/main.ts và chờ log "Nest application successfully started".
 *
 * Vì sao cần: vòng phụ thuộc DI (provider A cần B, B cần A qua useExisting/factory) KHÔNG làm Nest
 * báo lỗi mà treo im lặng ở bước khởi tạo module. `tsc`, `jest` và `pnpm arch` đều không bắt được
 * lỗi này; chỉ chạy app thật mới thấy.
 *
 * Yêu cầu: PostgreSQL/Redis local đang chạy như khi `pnpm dev` (xem `pnpm local:up`).
 * Exit 0 = khởi động xong, 1 = treo/chết sớm.
 */
const { spawn, spawnSync } = require('node:child_process');

const TIMEOUT_MS = Number(process.env.BOOT_CHECK_TIMEOUT_MS) || 90_000;
const SUCCESS_MARKER = 'Nest application successfully started';
const port = String(39000 + Math.floor(Math.random() * 900));
const isWindows = process.platform === 'win32';

const child = spawn(
  'npx',
  ['ts-node', '-r', 'tsconfig-paths/register', 'src/main.ts'],
  {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, PORT: port, FORCE_COLOR: '0' },
    shell: isWindows,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let output = '';
let finished = false;

function killTree() {
  if (!child.pid) return;
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* đã thoát */
    }
  }
}

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  killTree();
  console.log(message);
  if (code !== 0) {
    console.log('--- 30 dòng log cuối ---');
    console.log(output.split('\n').slice(-30).join('\n'));
  }
  process.exit(code);
}

function onData(chunk) {
  output += chunk.toString();
  if (output.includes(SUCCESS_MARKER)) {
    finish(0, `✔ Core khởi động thành công (port ${port}).`);
  }
}

child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('exit', (code) => {
  finish(1, `✘ Core thoát sớm (exit code ${code}) trước khi khởi động xong.`);
});

const timer = setTimeout(() => {
  finish(
    1,
    `✘ Core không khởi động xong sau ${TIMEOUT_MS / 1000}s. Nghi ngờ vòng phụ thuộc DI (treo im lặng) ` +
      'hoặc PostgreSQL/Redis chưa chạy (pnpm local:up).',
  );
}, TIMEOUT_MS);
