import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';

export interface IPendingApprovalDto {
  messageId: string;
  tool: Record<string, unknown>;
  preview?: unknown;
  friendlySummary?: string;
}

export class HistoryResponseDto {
  @ApiProperty({
    type: [ChatHistoryTurnDto],
    description: 'Danh sách các lượt hội thoại gần nhất trong phiên',
  })
  readonly turns: ChatHistoryTurnDto[];

  @ApiPropertyOptional({
    description: 'Thông tin checkpoint đang chờ duyệt (nếu có)',
  })
  readonly pendingApproval?: IPendingApprovalDto;

  constructor(turns: ChatHistoryTurnDto[], pendingApproval?: IPendingApprovalDto) {
    this.turns = turns;
    this.pendingApproval = pendingApproval;
  }
}
