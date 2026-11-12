import { createMockComputeProvider } from './mock-compute.provider';
import { DockerPythonSandboxRunner } from './docker-python-sandbox.runner';

describe('createMockComputeProvider', () => {
  it('định nghĩa tool run_python và run_bash với authType là SYSTEM', () => {
    const provider = createMockComputeProvider();
    expect(provider.id).toBe('compute');
    expect(provider.tools).toHaveLength(2);
    expect(provider.tools.map((t) => t.name)).toEqual(['run_python', 'run_bash']);
    expect(provider.tools.every((t) => t.authType === 'SYSTEM')).toBe(true);
  });

  it('thực thi run_python qua Docker runner khi có runner', async () => {
    const mockRunner = {
      runPython: jest.fn().mockResolvedValue({
        success: true,
        stdout: 'Transformed 500 rows\n',
        stderr: '',
      }),
    } as unknown as DockerPythonSandboxRunner;

    const provider = createMockComputeProvider(mockRunner);
    const result = await provider.call(
      'run_python',
      { code: 'print("hello")' },
      { workspaceId: 'turn-999' },
    );

    expect(mockRunner.runPython).toHaveBeenCalledWith('print("hello")', 'turn-999');
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Transformed 500 rows');
  });

  it('thực thi run_python với turn_id snake_case trong args', async () => {
    const mockRunner = {
      runPython: jest.fn().mockResolvedValue({
        success: true,
        stdout: 'Done\n',
        stderr: '',
      }),
    } as unknown as DockerPythonSandboxRunner;

    const provider = createMockComputeProvider(mockRunner);
    await provider.call('run_python', { code: 'x = 1', turn_id: 'turn-snake-case' });
    expect(mockRunner.runPython).toHaveBeenCalledWith('x = 1', 'turn-snake-case');
  });

  it('khởi tạo runner tự động khi truyền IArtifactTmpManager', async () => {
    const mockTmpManager = {
      getBaseDir: jest.fn().mockReturnValue('/tmp'),
      getTurnDir: jest.fn().mockReturnValue('/tmp/turn-1'),
      saveJsonToFile: jest.fn(),
      readJsonFromFile: jest.fn(),
      cleanTurnDir: jest.fn(),
      cleanExpiredDirs: jest.fn(),
    };

    const provider = createMockComputeProvider(mockTmpManager);
    expect(provider).toBeDefined();
    expect(provider.tools).toHaveLength(2);
  });

  it('thực thi run_python trả về lỗi khi Docker execution thất bại', async () => {
    const mockRunner = {
      runPython: jest.fn().mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'SyntaxError: invalid syntax',
      }),
    } as unknown as DockerPythonSandboxRunner;

    const provider = createMockComputeProvider(mockRunner);
    const result = await provider.call('run_python', { code: 'def (' });

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('SyntaxError: invalid syntax');
  });

  it('thực thi run_python trả về kết quả fallback khi không có runner', async () => {
    const provider = createMockComputeProvider();
    const result = await provider.call('run_python', { code: 'import pandas as pd' });
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Python Sandbox 3.11 Execution Completed');
  });

  it('thực thi run_bash trả về output', async () => {
    const provider = createMockComputeProvider();
    const result = await provider.call('run_bash', { command: 'ls -la' });
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Bash Sandbox Output');
  });
});
