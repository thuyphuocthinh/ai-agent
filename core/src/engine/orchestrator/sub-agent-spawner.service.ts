import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { ReactLoopService } from '../loop/react-loop.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { RunReactLoopRequestDto } from '../../contracts/dtos/react-loop.dto';
import {
  ISubAgentSpawner,
  SubAgentSpawnOptions,
  SubAgentSpawnResult,
} from '../../contracts/sub-agent-spawner.interface';

/**
 * SubAgentSpawnerService
 *
 * Primitive cho phép Single Agent (hoặc các Engine khác) đẻ ra các Sub-Agent worker
 * chạy trong ngữ cảnh cách ly (isolated context/history), giải quyết triệt để vấn đề
 * tràn context khi xử lý tài liệu lớn hoặc tính toán phức tạp.
 */
@Injectable()
export class SubAgentSpawnerService implements ISubAgentSpawner {
  private readonly logger = new Logger(SubAgentSpawnerService.name);

  constructor(
    private readonly reactLoop: ReactLoopService,
    private readonly cancellation: AgentCancellationService,
  ) {}

  /**
   * Khởi chạy một Sub-Agent cô lập để thực thi một nhiệm vụ con
   */
  async spawn(options: SubAgentSpawnOptions): Promise<SubAgentSpawnResult> {
    const {
      task,
      context,
      model,
      provider = 'compute',
      providers = ['compute'],
      allowedTools,
      parentMessageId,
      userId,
      channelId,
      conversationId,
      workspaceId,
      tenantId,
      sessionType,
      signal,
    } = options;

    const subAgentId = `sub-${randomUUID().slice(0, 8)}`;
    const subMessageId = `${parentMessageId}:${subAgentId}`;

    this.logger.log(
      `[SubAgentSpawner] Spawning sub-agent "${subAgentId}" for parent="${parentMessageId}" task="${task.slice(0, 60)}..."`,
    );

    const isCancelled = await this.cancellation.isCancelled(parentMessageId);
    if (signal?.aborted || isCancelled) {
      throw new TurnCancelledError(undefined);
    }

    const isolatedPrompt = context
      ? `=== DỮ LIỆU CUNG CẤP TỪ AGENT CHÍNH ===\n${context}\n\n=== NHIỆM VỤ CẦN THỰC HIỆN ===\n${task}`
      : task;

    const requestDto: RunReactLoopRequestDto = {
      prompt: isolatedPrompt,
      provider,
      providers,
      userId,
      channelId: conversationId ?? channelId,
      conversationId,
      workspaceId: tenantId ?? workspaceId,
      tenantId,
      messageId: subMessageId,
      channelType: sessionType ?? 'web',
      sessionType,
      history: [], // Cô lập hoàn toàn: không kế thừa toàn bộ lịch sử trò chuyện chính
      model:
        model ??
        process.env.SUBAGENT_REACT_MODEL ??
        process.env.DEFAULT_REACT_MODEL ??
        ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
      persona: {
        role: 'Isolated Sub-Agent Worker',
        goal: task,
      },
      allowedTools,
    };

    try {
      const result = await this.reactLoop.run(requestDto, signal);
      this.logger.log(
        `[SubAgentSpawner] Sub-agent "${subAgentId}" hoàn thành nhiệm vụ thành công`,
      );

      return {
        success: true,
        result: result.answer,
        toolCalls: result.toolCalls,
      };
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
      }

      this.logger.error(
        `[SubAgentSpawner] Sub-agent "${subAgentId}" gặp lỗi: ${(error as Error)?.message}`,
      );

      return {
        success: false,
        result: `Sub-agent không thể hoàn thành nhiệm vụ do lỗi: ${(error as Error)?.message}`,
        error: (error as Error)?.message,
      };
    }
  }
}
