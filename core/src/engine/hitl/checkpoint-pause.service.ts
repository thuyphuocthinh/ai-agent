import { Inject, Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@agent/core/infrastructure/queue';
import {
  ECheckpointKind,
  ECheckpointRiskLevel,
  EMessageContentType,
  EStepExecutionStatus,
  EXECUTE_WRITE_QUERY_TOOL,
  SQL_SERVER_PROVIDER,
} from '@agent/core/constants';
import {
  buildExistingRowsPreview,
  buildGenericArgsPreview,
  buildInsertRowsPreview,
  buildWholeTableDestructivePreview,
} from './utils/hitl-message.util';
import { extractTextFromMcpResult } from '@agent/core/common';
import { MessageClientService } from '../streaming/message-client.service';
import { IToolProvider, TOOL_PROVIDER } from '../../contracts';
import { CheckpointService } from './checkpoint.service';
import {
  AmbiguousAgentCandidate,
  PendingToolCall,
} from '../../contracts';
import { CreateCheckpointRequestDto } from '../../contracts/dtos/checkpoint.dto';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../../contracts/dtos/supervisor.dto';
import { ChatHistoryTurnDto } from '../../contracts/dtos/message-client.dto';
import { ToolCallTraceDto } from '../../contracts/dtos/react-loop.dto';
import {
  EWriteQueryCountKind,
  EWriteQueryOperation,
  EWriteQueryTargetKind,
  extractWriteQueryPreviewTarget,
  parseSingleCountResult,
  WriteQueryPreviewTarget,
} from '../../common/action-summary/write-query-preview.util';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from '../../contracts/engine/orchestration-answer.types';
import { capToolResultSize } from '../../common/text/token-budget.util';
import { formatActionSummary } from '../../common/action-summary';

@Injectable()
export class CheckpointPauseService {
  private readonly logger = new Logger(CheckpointPauseService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly checkpoint: CheckpointService,
    @Inject(TOOL_PROVIDER)
    private readonly mcpClient: IToolProvider,
  ) {}

  // Dừng turn khi gặp tool rủi ro: tạo message MỚI "approval_request" (không
  // update message "Đang xử lý..."), lưu checkpoint để resume (Step 5), rồi
  // trỏ message "Đang xử lý..." sang message chờ duyệt. `triggerUserId` chỉ
  // để FE ẩn/disable nút cho user khác trong GROUP — bảo mật thật nằm ở
  // resolveApproval() (so checkpoint.userId).
  async pauseForApproval(
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    history: ChatHistoryTurnDto[],
    approvalNeeded: ApprovalRequiredDelegateResult,
    // accuracy_problem.md mục 9.2 — các bước CÒN LẠI CHƯA CHẠY của kế hoạch
    // gốc (đã `shift()` bước gây pause ra khỏi mảng này TRƯỚC khi gọi vào
    // đây) — lưu lại để resume ĐÚNG theo kế hoạch gốc, xem
    // TurnResolverService.continueRounds().
    remainingSteps: DelegationDto[],
    engineMode?: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, workspaceId } = data;
    const botUserId = data.botUserId ?? 'agent-bot';
    const { approvalRequired: pendingTool, task: pendingTask } = approvalNeeded;

    const { preview, riskLevel } = await this.buildRiskPreview(
      pendingTool,
      userId,
      workspaceId,
    );
    const friendlySummary = formatActionSummary({
      provider: pendingTool.provider,
      toolName: pendingTool.name,
      args: pendingTool.args,
    });
    const approvalContent = {
      type: EMessageContentType.APPROVAL_REQUEST,
      tool: pendingTool,
      status: 'pending',
      preview,
      friendlySummary,
      triggerUserId: userId,
    };
    const approvalMessage = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: approvalContent,
    });

    await this.createCheckpointSafely(
      data,
      approvalMessage.id,
      {
        originalPrompt,
        pendingTool,
        pendingTask,
        roundsSoFar: rounds,
        toolCalls,
        remainingSteps,
        history,
        riskLevel,
        engineMode,
      },
      '⚠️ Không thể tạo yêu cầu duyệt, vui lòng hỏi lại.',
    );
    await this.attachPendingToolCallTrace(
      approvalMessage.id,
      botUserId,
      channelId,
      approvalContent,
      toolCalls,
      pendingTool,
    );

    this.logger.log(
      `pauseForApproval() tool=${pendingTool.provider}.${pendingTool.name} approvalMessageId=${approvalMessage.id}`,
    );
    return buildAnswer(
      '',
      toolCalls,
    );
  }

  // Dùng chung cho pauseForApproval()/pauseForClarification() — createMessage()
  // (message service, TCP) và checkpoint.create() (Postgres riêng) không bọc
  // chung transaction được — lỗi ở đây để lại message mồ côi (không checkpoint
  // để resolve) nên sửa NGAY message đó thành lỗi rõ ràng.
  private async createCheckpointSafely(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    fields: Omit<
      CreateCheckpointRequestDto,
      | 'replyMessageId'
      | 'userId'
      | 'botUserId'
      | 'channelId'
      | 'workspaceId'
      | 'channelType'
    >,
    failureMessage: string,
  ): Promise<void> {
    const { userId, botUserId, channelId, workspaceId, channelType } = data;
    try {
      await this.checkpoint.create({
        replyMessageId,
        userId,
        botUserId,
        channelId,
        workspaceId,
        channelType,
        ...fields,
      });
    } catch (error) {
      this.logger.error(
        `createCheckpointSafely() failed for message ${replyMessageId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: failureMessage,
      });
      throw error;
    }
  }

  async pauseForClarification(
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    history: ChatHistoryTurnDto[],
    task: string,
    candidates: AvailableAgentDto[],
    remainingSteps: DelegationDto[],
    engineMode?: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, botUserId } = data;
    const question = this.buildClarificationQuestion(task, candidates);
    const clarificationContent = {
      type: EMessageContentType.CLARIFICATION_REQUEST,
      question,
      candidates: candidates.map(
        (c): AmbiguousAgentCandidate => ({
          provider: c.provider,
          label: c.label,
        }),
      ),
      status: 'pending',
      triggerUserId: userId,
    };
    const clarificationMessage = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: clarificationContent,
    });

    await this.createCheckpointSafely(
      data,
      clarificationMessage.id,
      {
        originalPrompt,
        pendingTool: null,
        pendingTask: task,
        roundsSoFar: rounds,
        toolCalls,
        remainingSteps,
        history,
        kind: ECheckpointKind.CLARIFICATION,
        clarificationQuestion: this.buildClarificationQuestion(
          task,
          candidates,
        ),
        clarificationCandidates: candidates.map(
          (c): AmbiguousAgentCandidate => ({
            provider: c.provider,
            label: c.label,
          }),
        ),
        engineMode,
      },
      '⚠️ Không thể tạo yêu cầu làm rõ, vui lòng hỏi lại.',
    );

    if (toolCalls && toolCalls.length > 0) {
      await this.attachPendingToolCallTrace(
        clarificationMessage.id,
        botUserId ?? '',
        channelId,
        clarificationContent,
        toolCalls,
        null,
      );
    }

    this.logger.log(
      `pauseForClarification() candidates=${candidates.map((c) => c.provider).join(',')} clarificationMessageId=${clarificationMessage.id}`,
    );
    return buildAnswer(
      '',
      toolCalls,
    );
  }

  private buildClarificationQuestion(
    task: string,
    candidates: AvailableAgentDto[],
  ): string {
    const labels = candidates.map((c) => `"${c.label}"`).join(' hay ');
    return `Bạn muốn dùng ${labels} cho việc: "${task}"?`;
  }

  // createMessage() (message service) chưa hỗ trợ toolCalls lúc tạo — gắn
  // thêm bằng 1 update() riêng để timeline hiện tool đang chờ duyệt giống mọi
  // message bot khác. Lỗi ở đây chỉ mất phần hiển thị, không ảnh hưởng luồng chính.
  private async attachPendingToolCallTrace(
    approvalMessageId: string,
    botUserId: string,
    channelId: string,
    approvalContent: Record<string, unknown>,
    toolCalls: ToolCallTraceDto[],
    pendingTool?: PendingToolCall | null,
  ): Promise<void> {
    try {
      const allCalls = [
        ...toolCalls,
        ...(pendingTool
          ? [
              {
                tool: `${pendingTool.provider}.${pendingTool.name}`,
                status: EStepExecutionStatus.AWAITING_APPROVAL,
              },
            ]
          : []),
      ];
      await this.messageClient.updateMessage({
        id: approvalMessageId,
        userId: botUserId,
        channelId,
        content: approvalContent,
        toolCalls: allCalls,
      });
    } catch (error) {
      this.logger.warn(
        `attachPendingToolCallTrace() failed for message ${approvalMessageId}: ${(error as Error).message}`,
      );
    }
  }

  // Ước lượng SỐ LIỆU chỉ khả thi cho sql_server.execute_write_query — "đếm
  // dòng ảnh hưởng" không có khái niệm tương đương cho GitHub/Google Docs/
  // dynamic provider... Với MỌI tool khác (và cả khi ước lượng SQL thất bại),
  // fallback KHÔNG còn là câu chung chung vô nghĩa nữa — hiện thẳng tham số
  // THẬT sắp gửi đi (buildGenericArgsPreview), luôn có sẵn cho BẤT KỲ provider
  // nào, không cần biết domain cụ thể.
  //
  // mục 15 — 3 kind preview KHÁC NHAU (write-query-preview.util.ts):
  // 'existing-rows' (UPDATE/DELETE) đếm THỬ qua execute_read_only_query như cũ;
  // 'insert-rows' (INSERT ... VALUES) đếm TRỰC TIẾP từ câu lệnh, khỏi cần hỏi
  // DB; 'whole-table-destructive' (TRUNCATE/DROP) cảnh báo THẲNG không cần đếm
  // gì — huỷ CẢ bảng, số dòng không còn ý nghĩa.
  private async buildRiskPreview(
    pendingTool: PendingToolCall,
    userId: string,
    workspaceId: string | undefined,
  ): Promise<{ preview: string; riskLevel: ECheckpointRiskLevel | null }> {
    if (
      pendingTool.provider === SQL_SERVER_PROVIDER &&
      pendingTool.name === EXECUTE_WRITE_QUERY_TOOL
    ) {
      const target = extractWriteQueryPreviewTarget(
        String(pendingTool.args?.query ?? ''),
      );
      if (target?.kind === EWriteQueryTargetKind.WHOLE_TABLE_DESTRUCTIVE) {
        return {
          preview: buildWholeTableDestructivePreview(
            target.table,
            target.operation,
            target.operation === EWriteQueryOperation.TRUNCATE,
          ),
          riskLevel: ECheckpointRiskLevel.HIGH,
        };
      }
      if (target?.kind === EWriteQueryTargetKind.INSERT_ROWS) {
        // Không bao giờ tới đây trong luồng thật — INSERT tự chạy thẳng ở
        // Risk Gate (react-loop-run.ts), không tạo checkpoint. Giữ nhánh này
        // phòng trường hợp pendingTool bị sửa tay qua edit_and_approve.
        return {
          preview: buildInsertRowsPreview(
            target.rowCount,
            target.table,
            target.countKind === EWriteQueryCountKind.MAXIMUM,
          ),
          riskLevel: ECheckpointRiskLevel.MEDIUM,
        };
      }
      if (target?.kind === EWriteQueryTargetKind.EXISTING_ROWS) {
        const count = await this.countAffectedRows(target, userId, workspaceId);
        if (count !== null) {
          return {
            preview: buildExistingRowsPreview(count, Boolean(target.whereClause)),
            riskLevel: ECheckpointRiskLevel.MEDIUM,
          };
        }
      }
    }

    return {
      preview: this.buildGenericArgsPreview(pendingTool),
      riskLevel: null,
    };
  }

  // Fallback TỔNG QUÁT — hiện nguyên tham số thật sẽ gửi đi kèm tên tool, thay
  // vì "không ước lượng được ảnh hưởng" không mang thông tin gì. capToolResultSize()
  // vì args có thể chứa nội dung dài (VD text sắp append vào Google Docs).
  private buildGenericArgsPreview(pendingTool: PendingToolCall): string {
    const argsText = capToolResultSize(
      JSON.stringify(pendingTool.args ?? {}, null, 2),
    );
    return buildGenericArgsPreview(
      pendingTool.provider,
      pendingTool.name,
      argsText,
    );
  }

  private async countAffectedRows(
    target: Extract<WriteQueryPreviewTarget, { kind: EWriteQueryTargetKind.EXISTING_ROWS }>,
    userId: string,
    workspaceId: string | undefined,
  ): Promise<number | null> {
    const countQuery = target.whereClause
      ? `SELECT COUNT(*) AS affectedRows FROM ${target.table} WHERE ${target.whereClause}`
      : `SELECT COUNT(*) AS affectedRows FROM ${target.table}`;

    try {
      const result = await this.mcpClient.callTool({
        provider: SQL_SERVER_PROVIDER,
        name: 'execute_read_only_query',
        args: { query: countQuery },
        ownerId: userId,
        workspaceId,
      });
      return parseSingleCountResult(extractTextFromMcpResult(result));
    } catch (error) {
      this.logger.warn(
        `countAffectedRows() không chạy được câu đếm thử: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

