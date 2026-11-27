import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  CONV_ARTIFACT_DIR_NAME,
  CONV_ARTIFACT_ERROR_CODES,
  CONV_ARTIFACT_FILE_PREFIX,
  CONV_ARTIFACT_FORMAT,
  ORCHESTRATION_CONSTANTS,
} from '@agent/core/constants';
import { buildTTL } from '../../common/async/ttl.util';
import {
  ConversationArtifactMimeType,
  ConversationArtifactRecord,
  IConversationArtifactStore,
} from '../../contracts/storage/conversation-artifact.interface';

@Injectable()
export class LocalConversationArtifactStore
  implements IConversationArtifactStore, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LocalConversationArtifactStore.name);
  private readonly rootDir = path.join(os.tmpdir(), CONV_ARTIFACT_DIR_NAME);
  private cleanupTimer?: NodeJS.Timeout;

  onModuleInit(): void {
    const intervalMs = buildTTL(
      'MINUTE',
      ORCHESTRATION_CONSTANTS.ARTIFACT_CLEANUP_INTERVAL_MINUTES,
    );
    this.cleanupTimer = setInterval(() => {
      void this.cleanExpired().catch((err) => {
        this.logger.warn(
          `Cleanup conversation artifacts failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async save(params: {
    conversationId: string;
    sourceTool: string;
    rawText: string;
  }): Promise<ConversationArtifactRecord> {
    const convId = this.sanitizeSegment(params.conversationId);
    const { mimeType, extension, recordCount, sample } = this.inspectPayload(
      params.rawText,
    );
    const shortId = randomUUID().slice(
      0,
      ORCHESTRATION_CONSTANTS.ARTIFACT_SHORT_ID_LENGTH,
    );
    const filename = `${CONV_ARTIFACT_FILE_PREFIX}${shortId}${extension}`;
    const convDir = path.join(this.rootDir, convId);
    await fs.mkdir(convDir, { recursive: true });
    await fs.writeFile(path.join(convDir, filename), params.rawText, 'utf8');

    return {
      filename,
      conversationId: convId,
      sourceTool: params.sourceTool,
      mimeType,
      recordCount,
      byteSize: Buffer.byteLength(params.rawText, 'utf8'),
      sample,
    };
  }

  async read(conversationId: string, filename: string): Promise<string> {
    const convId = this.sanitizeSegment(conversationId);
    const safeFile = this.sanitizeSegment(filename);
    const filePath = path.join(this.rootDir, convId, safeFile);

    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new NotFoundException(
          `${CONV_ARTIFACT_ERROR_CODES.NOT_FOUND}: ${safeFile}`,
        );
      }
      throw error;
    }
  }

  async cleanExpired(
    ttlMs = buildTTL('HOUR', ORCHESTRATION_CONSTANTS.ARTIFACT_TTL_HOURS),
  ): Promise<number> {
    const entries = await fs.readdir(this.rootDir).catch(() => null);
    if (!entries) return 0;

    const cutoff = Date.now() - ttlMs;
    let deleted = 0;

    for (const convId of entries) {
      const convDir = path.join(this.rootDir, convId);
      const files = await fs.readdir(convDir).catch(() => []);
      for (const file of files) {
        const fullPath = path.join(convDir, file);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat?.isFile() && stat.mtimeMs < cutoff) {
          await fs.unlink(fullPath).catch(() => undefined);
          deleted++;
        }
      }
      const remaining = await fs.readdir(convDir).catch(() => null);
      if (remaining && remaining.length === 0) {
        await fs.rmdir(convDir).catch(() => undefined);
      }
    }
    return deleted;
  }

  private sanitizeSegment(raw: string): string {
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed === '.' ||
      trimmed === '..' ||
      trimmed.includes('/') ||
      trimmed.includes('\\')
    ) {
      throw new BadRequestException(CONV_ARTIFACT_ERROR_CODES.INVALID_ARGUMENTS);
    }
    return trimmed;
  }

  private inspectPayload(rawText: string): {
    mimeType: ConversationArtifactMimeType;
    extension: string;
    recordCount: number;
    sample: unknown[];
  } {
    const sampleCount = ORCHESTRATION_CONSTANTS.ARTIFACT_JSON_SAMPLE_COUNT;
    try {
      const parsed: unknown = JSON.parse(rawText);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return {
        mimeType: CONV_ARTIFACT_FORMAT.JSON.mimeType,
        extension: CONV_ARTIFACT_FORMAT.JSON.extension,
        recordCount: items.length,
        sample: items.slice(0, sampleCount),
      };
    } catch {
      const lines = rawText.split(/\r?\n/);
      return {
        mimeType: CONV_ARTIFACT_FORMAT.TEXT.mimeType,
        extension: CONV_ARTIFACT_FORMAT.TEXT.extension,
        recordCount: lines.length,
        sample: lines.slice(0, ORCHESTRATION_CONSTANTS.ARTIFACT_TEXT_PREVIEW_LINES),
      };
    }
  }
}
