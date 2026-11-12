import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DockerPythonSandboxRunner } from './docker-python-sandbox.runner';
import { IArtifactTmpManager } from '../../../contracts/storage/artifact-tmp.interface';

describe('DockerPythonSandboxRunner', () => {
  let testBaseDir: string;
  let mockTmpManager: jest.Mocked<IArtifactTmpManager>;

  beforeEach(() => {
    testBaseDir = path.join(os.tmpdir(), `test-docker-runner-${Date.now()}`);
    fs.mkdirSync(testBaseDir, { recursive: true });

    mockTmpManager = {
      getBaseDir: jest.fn().mockReturnValue(testBaseDir),
      getTurnDir: jest.fn((turnId: string) => {
        const turnDir = path.join(testBaseDir, turnId);
        if (!fs.existsSync(turnDir)) {
          fs.mkdirSync(turnDir, { recursive: true });
        }
        return turnDir;
      }),
      saveJsonToFile: jest.fn(),
      readJsonFromFile: jest.fn(),
      cleanTurnDir: jest.fn(),
      cleanExpiredDirs: jest.fn(),
    };
  });

  afterEach(async () => {
    if (fs.existsSync(testBaseDir)) {
      await fs.promises.rm(testBaseDir, { recursive: true, force: true });
    }
  });

  it('writes python code to script file and executes Docker with full isolation arguments', async () => {
    const mockExecFn = jest.fn().mockResolvedValue({
      stdout: 'Transformed 100 rows\n',
      stderr: '',
    });

    const runner = new DockerPythonSandboxRunner(mockTmpManager, mockExecFn);
    const pythonCode = 'print("Hello Docker")';
    const turnId = 'turn-test-123';

    const result = await runner.runPython(pythonCode, turnId);

    // 1. Kiểm tra file script được ghi đúng thư mục turn
    const scriptPath = path.join(testBaseDir, turnId, 'run_transform.py');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const writtenCode = await fs.promises.readFile(scriptPath, 'utf8');
    expect(writtenCode).toBe(pythonCode);

    // 2. Kiểm tra tham số docker bảo mật
    expect(mockExecFn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '1000:1000',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m',
        '-v',
        `${testBaseDir}:/tmp/artifacts:rw`,
        '--cpus',
        '1.0',
        '--memory',
        '512m',
        'python:3.11-slim',
        'python',
        `/tmp/artifacts/${turnId}/run_transform.py`,
      ]),
      { timeout: 30_000 },
    );

    // 3. Kết quả trả về
    expect(result).toEqual({
      success: true,
      stdout: 'Transformed 100 rows\n',
      stderr: '',
    });
  });

  it('handles execution error and captures stderr when script fails', async () => {
    const mockExecFn = jest.fn().mockRejectedValue({
      message: 'Command failed: docker run...',
      stdout: '',
      stderr: 'ZeroDivisionError: division by zero\n',
    });

    const runner = new DockerPythonSandboxRunner(mockTmpManager, mockExecFn);
    const result = await runner.runPython('1 / 0', 'turn-err');

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('ZeroDivisionError');
    expect(result.error).toContain('Command failed');
  });

  it('handles execution failure when docker daemon is not available', async () => {
    const mockExecFn = jest.fn().mockRejectedValue(new Error('spawn docker ENOENT'));

    const runner = new DockerPythonSandboxRunner(mockTmpManager, mockExecFn);
    const result = await runner.runPython('print(1)', 'turn-no-docker');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});
