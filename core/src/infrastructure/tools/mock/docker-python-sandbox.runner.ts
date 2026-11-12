import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import { IArtifactTmpManager } from '../../../contracts/storage/artifact-tmp.interface';

const defaultExecFileAsync = promisify(execFile);

export interface DockerSandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export type DockerExecFn = (
  file: string,
  args: readonly string[],
  options: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * DockerPythonSandboxRunner:
 * Thực thi mã Python sinh ra bởi Agent bên trong container Docker `python:3.11-slim`
 * được cách ly mạng hoàn toàn (--network none) và giới hạn tài nguyên nghiêm ngặt.
 */
export class DockerPythonSandboxRunner {
  private readonly logger = new Logger(DockerPythonSandboxRunner.name);
  private readonly execFn: DockerExecFn;

  constructor(
    private readonly tmpManager: IArtifactTmpManager,
    execFn?: DockerExecFn,
  ) {
    this.execFn = execFn ?? (defaultExecFileAsync as unknown as DockerExecFn);
  }

  async runPython(
    code: string,
    turnId: string = 'turn-default',
  ): Promise<DockerSandboxResult> {
    const turnHostDir = this.tmpManager.getTurnDir(turnId);
    const scriptFilename = 'run_transform.py';
    const scriptHostPath = path.join(turnHostDir, scriptFilename);

    // Ghi mã nguồn script ra file tạm trên máy host
    await fs.promises.writeFile(scriptHostPath, code, {
      encoding: 'utf8',
      mode: 0o600,
    });

    const baseHostDir = this.tmpManager.getBaseDir();
    const sanitizedTurnId = path.basename(turnHostDir);
    const scriptContainerPath = `/tmp/artifacts/${sanitizedTurnId}/${scriptFilename}`;

    const dockerArgs = [
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
      `${baseHostDir}:/tmp/artifacts:rw`,
      '--cpus',
      '1.0',
      '--memory',
      '512m',
      'python:3.11-slim',
      'python',
      scriptContainerPath,
    ];

    try {
      const { stdout, stderr } = await this.execFn('docker', dockerArgs, {
        timeout: 30_000,
      });

      return {
        success: true,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      };
    } catch (err: unknown) {
      const execError = err as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const errorMessage = execError.message ?? 'Unknown Docker execution error';
      this.logger.warn(`Docker execution failed: ${errorMessage}`);

      return {
        success: false,
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        error: errorMessage,
      };
    }
  }
}
