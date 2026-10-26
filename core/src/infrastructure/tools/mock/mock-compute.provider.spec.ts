import { createMockComputeProvider } from './mock-compute.provider';

describe('createMockComputeProvider', () => {
  it('định nghĩa tool run_python và run_bash', () => {
    const provider = createMockComputeProvider();
    expect(provider.id).toBe('compute');
    expect(provider.tools).toHaveLength(2);
    expect(provider.tools.map((t) => t.name)).toEqual(['run_python', 'run_bash']);
  });

  it('thực thi run_python trả về ma trận tương quan', () => {
    const provider = createMockComputeProvider();
    const result = provider.call('run_python', { code: 'import pandas as pd' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Ma trận tương quan');
    expect(result.content[0].text).toContain('0.784512');
  });

  it('thực thi run_bash trả về output', () => {
    const provider = createMockComputeProvider();
    const result = provider.call('run_bash', { command: 'ls -la' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Bash Sandbox Output');
  });
});
