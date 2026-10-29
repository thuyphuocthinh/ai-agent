import { Injectable, Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ECheckpointKind,
  ECheckpointRiskLevel,
} from '@agent/core/constants';
import {
  AmbiguousAgentCandidate,
  CheckpointResponseDto,
  ClaimCheckpointExecutionRequestDto,
  ClaimCheckpointRequestDto,
  ClaimCheckpointResponseDto,
  CreateCheckpointRequestDto,
  FindCheckpointByIdRequestDto,
  FindPendingByConversationRequestDto,
  FindPendingCheckpointRequestDto,
  MarkStalledAsRejectedRequestDto,
  MarkToolExecutedRequestDto,
  OrchestrationCheckpointStatus,
} from '../../../contracts/dtos/checkpoint.dto';
import { DelegationDto, SupervisorRoundDto } from '../../../contracts/dtos/supervisor.dto';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';
import { ToolCallTraceDto } from '../../../contracts/dtos/react-loop.dto';
import { EExecutionEngineMode } from '../../../contracts/engine/execution-engine.interface';
import { PrismaService } from '../prisma.service';
import { sanitizePrismaError } from '../../../common/errors';
import { CheckpointKind, CheckpointStatus, Prisma } from '@prisma/client';
import { DEFAULT_DEV_USER_ID } from './prisma-chat-session.manager';

export const DEFAULT_DEV_CONVERSATION_ID = '00000000-0000-7000-8000-000000000002';

/**
 * PrismaCheckpointService
 * Quản lý vòng đời Human-in-the-loop Checkpoint (Pause/Resume/Claim/Reaper) trên PostgreSQL qua Prisma.
 * Đảm bảo các thao tác chuyển trạng thái (State Transition) là nguyên tử (Atomic).
 * Tuyệt đối không để lộ lỗi SQL ra ngoài response.
 */
@Injectable()
export class PrismaCheckpointService {
  private readonly logger = new Logger(PrismaCheckpointService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async ensureParentRelations(
    userId: string,
    conversationId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      await this.prisma.user.upsert({
        where: { id: userId || DEFAULT_DEV_USER_ID },
        update: {},
        create: {
          id: userId || DEFAULT_DEV_USER_ID,
          email: `${userId || DEFAULT_DEV_USER_ID}@local.agent`,
          fullName: 'Developer / Guest',
          role: 'ADMIN',
        },
      });

      await this.prisma.conversation.upsert({
        where: { id: conversationId },
        update: {
          lastSeenAt: new Date(),
        },
        create: {
          id: conversationId,
          userId: userId || DEFAULT_DEV_USER_ID,
          workspaceId: workspaceId || 'default',
          title: 'Cuộc trò chuyện mới',
          state: 'AI_ACTIVE',
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.ensureParentRelations');
    }
  }

  async create(dto: CreateCheckpointRequestDto): Promise<CheckpointResponseDto> {
    const expiresAt = new Date(
      Date.now() + ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS,
    );
    const userId = dto.userId && dto.userId !== 'default' ? dto.userId : DEFAULT_DEV_USER_ID;
    const conversationId =
      dto.conversationId && dto.conversationId !== 'default'
        ? dto.conversationId
        : dto.channelId && dto.channelId !== 'default'
        ? dto.channelId
        : DEFAULT_DEV_CONVERSATION_ID;
    const workspaceId = dto.tenantId ?? dto.workspaceId ?? 'default';
    const sessionType = dto.sessionType ?? dto.channelType ?? 'web';

    try {
      await this.ensureParentRelations(userId, conversationId, workspaceId);

      const replyMessageId = dto.runId ?? dto.replyMessageId;

      let checkpointKind: CheckpointKind = CheckpointKind.APPROVAL;
      if (dto.kind === ECheckpointKind.CLARIFICATION) {
        checkpointKind = CheckpointKind.CLARIFICATION;
      }

      const created = await this.prisma.checkpoint.create({
        data: {
          replyMessageId,
          userId,
          conversationId,
          workspaceId,
          sessionType,
          originalPrompt: dto.originalPrompt,
          pendingTool: dto.pendingTool ? (JSON.parse(JSON.stringify(dto.pendingTool)) as Prisma.InputJsonObject) : Prisma.JsonNull,
          pendingTask: dto.pendingTask,
          kind: checkpointKind,
          riskLevel: dto.riskLevel ?? null,
          clarificationQuestion: dto.clarificationQuestion ?? null,
          clarificationCandidates: dto.clarificationCandidates ? (JSON.parse(JSON.stringify(dto.clarificationCandidates)) as Prisma.InputJsonArray) : Prisma.JsonNull,
          selectedProvider: null,
          roundsSoFar: (dto.roundsSoFar
            ? [
                ...JSON.parse(JSON.stringify(dto.roundsSoFar)),
                ...(dto.engineMode ? [{ __engineMode: dto.engineMode }] : []),
                ...(dto.toolCalls && dto.toolCalls.length > 0 ? [{ __toolCalls: dto.toolCalls }] : []),
              ]
            : [
                ...(dto.engineMode ? [{ __engineMode: dto.engineMode }] : []),
                ...(dto.toolCalls && dto.toolCalls.length > 0 ? [{ __toolCalls: dto.toolCalls }] : []),
              ]) as Prisma.InputJsonArray,
          remainingSteps: (dto.remainingSteps ? JSON.parse(JSON.stringify(dto.remainingSteps)) : []) as Prisma.InputJsonArray,
          history: (dto.history ? JSON.parse(JSON.stringify(dto.history)) : []) as Prisma.InputJsonArray,
          status: CheckpointStatus.PENDING,
          expiresAt,
        },
      });

      if (replyMessageId && checkpointKind === CheckpointKind.APPROVAL && this.prisma.conversation?.findUnique) {
        const conv = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { approvalMessageIds: true },
        });
        const current = conv?.approvalMessageIds || [];
        if (!current.includes(replyMessageId) && this.prisma.conversation?.update) {
          await this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
              approvalMessageIds: [...current, replyMessageId],
              lastSeenAt: new Date(),
            },
          });
        }
      }

      return this.toResponseDto(created);
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.create');
    }
  }

  async findPendingByReplyMessageId(
    dto: FindPendingCheckpointRequestDto,
  ): Promise<CheckpointResponseDto | null> {
    try {
      const record = await this.prisma.checkpoint.findFirst({
        where: {
          replyMessageId: dto.replyMessageId,
          status: CheckpointStatus.PENDING,
        },
      });

      return record ? this.toResponseDto(record) : null;
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.findPendingByReplyMessageId');
    }
  }

  async findPendingByConversationId(
    dto: FindPendingByConversationRequestDto,
  ): Promise<CheckpointResponseDto | null> {
    try {
      const record = await this.prisma.checkpoint.findFirst({
        where: {
          conversationId: dto.conversationId,
          status: CheckpointStatus.PENDING,
          expiresAt: {
            gt: new Date(),
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return record ? this.toResponseDto(record) : null;
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.findPendingByConversationId');
    }
  }

  async findExpiredPending(): Promise<CheckpointResponseDto[]> {
    try {
      const records = await this.prisma.checkpoint.findMany({
        where: {
          status: CheckpointStatus.PENDING,
          expiresAt: {
            lt: new Date(),
          },
        },
      });

      return records.map((r) => this.toResponseDto(r));
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.findExpiredPending');
    }
  }

  async findStalledExecution(): Promise<CheckpointResponseDto[]> {
    const stalledBefore = new Date(
      Date.now() - ORCHESTRATION_CONSTANTS.STALLED_EXECUTION_TTL_MS,
    );

    try {
      const records = await this.prisma.checkpoint.findMany({
        where: {
          status: CheckpointStatus.APPROVED,
          executionStartedAt: {
            not: null,
            lt: stalledBefore,
          },
          toolExecutedAt: null,
        },
      });

      return records.map((r) => this.toResponseDto(r));
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.findStalledExecution');
    }
  }

  async findById(
    dto: FindCheckpointByIdRequestDto,
  ): Promise<CheckpointResponseDto | null> {
    try {
      const record = await this.prisma.checkpoint.findUnique({
        where: { id: dto.id },
      });

      return record ? this.toResponseDto(record) : null;
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.findById');
    }
  }

  async claim(
    dto: ClaimCheckpointRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    try {
      let targetStatus: CheckpointStatus = CheckpointStatus.APPROVED;
      if (dto.toStatus === OrchestrationCheckpointStatus.REJECTED) {
        targetStatus = CheckpointStatus.REJECTED;
      }

      const updateData: Prisma.CheckpointUpdateManyMutationInput = {
        status: targetStatus,
      };

      if (dto.selectedProvider !== undefined) {
        updateData.selectedProvider = dto.selectedProvider;
      }
      if (dto.updatedPendingTool !== undefined) {
        updateData.pendingTool = dto.updatedPendingTool
          ? (JSON.parse(JSON.stringify(dto.updatedPendingTool)) as Prisma.InputJsonObject)
          : Prisma.JsonNull;
      }

      const result = await this.prisma.checkpoint.updateMany({
        where: {
          id: dto.id,
          status: CheckpointStatus.PENDING,
        },
        data: updateData,
      });

      const claimed = result.count === 1;
      this.logger.log(
        `claim() id=${dto.id} toStatus=${dto.toStatus} claimed=${claimed}`,
      );
      return { claimed };
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.claim');
    }
  }

  async claimExecution(
    dto: ClaimCheckpointExecutionRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    try {
      const result = await this.prisma.checkpoint.updateMany({
        where: {
          id: dto.id,
          executionStartedAt: null,
        },
        data: {
          executionStartedAt: new Date(),
        },
      });

      const claimed = result.count === 1;
      this.logger.log(`claimExecution() id=${dto.id} claimed=${claimed}`);
      return { claimed };
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.claimExecution');
    }
  }

  async markToolExecuted(dto: MarkToolExecutedRequestDto): Promise<void> {
    try {
      await this.prisma.checkpoint.updateMany({
        where: { id: dto.id },
        data: {
          toolExecutedAt: new Date(),
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.markToolExecuted');
    }
  }

  async revertApprovedClaim(dto: { id: string }): Promise<void> {
    try {
      await this.prisma.checkpoint.updateMany({
        where: {
          id: dto.id,
          status: CheckpointStatus.APPROVED,
        },
        data: {
          status: CheckpointStatus.PENDING,
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.revertApprovedClaim');
    }
  }

  async markStalledAsRejected(
    dto: MarkStalledAsRejectedRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    try {
      const result = await this.prisma.checkpoint.updateMany({
        where: {
          id: dto.id,
          status: CheckpointStatus.APPROVED,
        },
        data: {
          status: CheckpointStatus.REJECTED,
        },
      });

      const claimed = result.count === 1;
      this.logger.warn(`markStalledAsRejected() id=${dto.id} claimed=${claimed}`);
      return { claimed };
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaCheckpointService.markStalledAsRejected');
    }
  }

  private toResponseDto(record: {
    id: string;
    replyMessageId: string;
    userId: string;
    conversationId: string;
    workspaceId: string;
    sessionType: string;
    originalPrompt: string;
    pendingTool: Prisma.JsonValue | null;
    pendingTask: string;
    kind: CheckpointKind;
    riskLevel: string | null;
    clarificationQuestion: string | null;
    clarificationCandidates: Prisma.JsonValue | null;
    selectedProvider: string | null;
    roundsSoFar: Prisma.JsonValue;
    remainingSteps: Prisma.JsonValue;
    history: Prisma.JsonValue;
    status: CheckpointStatus;
    expiresAt: Date;
    executionStartedAt: Date | null;
    toolExecutedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CheckpointResponseDto {
    return {
      id: record.id,
      replyMessageId: record.replyMessageId,
      runId: record.replyMessageId,
      userId: record.userId,
      botUserId: 'agent-bot',
      channelId: record.conversationId,
      conversationId: record.conversationId,
      workspaceId: record.workspaceId,
      tenantId: record.workspaceId,
      channelType: record.sessionType,
      sessionType: record.sessionType,
      originalPrompt: record.originalPrompt,
      pendingTool: record.pendingTool as unknown as CheckpointResponseDto['pendingTool'],
      pendingTask: record.pendingTask,
      ...(() => {
        const raw = (record.roundsSoFar as unknown as Array<SupervisorRoundDto & { __engineMode?: string; __toolCalls?: ToolCallTraceDto[] }>) || [];
        const meta = raw.find((r) => r && r.__engineMode);
        const tcMeta = raw.find((r) => r && r.__toolCalls);
        const engineMode =
          meta?.__engineMode ??
          (raw.some((r) => r.agent === EExecutionEngineMode.SINGLE_AGENT)
            ? EExecutionEngineMode.SINGLE_AGENT
            : EExecutionEngineMode.DYNAMIC_SUPERVISOR);
        const clean = raw.filter((r) => !r || (!r.__engineMode && !r.__toolCalls));
        return {
          roundsSoFar: clean,
          engineMode,
          toolCalls: tcMeta?.__toolCalls ?? [],
          selectedCandidateId: record.selectedProvider ?? null,
        };
      })(),
      remainingSteps: (record.remainingSteps as unknown as DelegationDto[]) || [],
      history: (record.history as unknown as ChatHistoryTurnDto[]) || [],
      status: record.status.toLowerCase() as OrchestrationCheckpointStatus,
      kind: record.kind.toLowerCase() as ECheckpointKind,
      riskLevel: (record.riskLevel as ECheckpointRiskLevel) ?? null,
      clarificationQuestion: record.clarificationQuestion ?? null,
      clarificationCandidates: (record.clarificationCandidates as unknown as AmbiguousAgentCandidate[]) ?? null,
      selectedProvider: record.selectedProvider ?? null,
      expiresAt: record.expiresAt,
      toolExecutedAt: record.toolExecutedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
