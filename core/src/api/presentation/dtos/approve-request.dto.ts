import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { EApprovalAction } from '@agent/core/constants';

export class ApproveRequestDto {
  @ApiProperty({
    description: 'ID của phiên làm việc chứa yêu cầu duyệt hoặc làm rõ',
    example: '5f1d6a0e-8b0c-4a53-9d0b-1c2d3e4f5a6b',
  })
  @IsUUID('all', { message: 'sessionId phải là định dạng UUID' })
  sessionId: string;

  @ApiProperty({
    description: 'ID của message checkpoint yêu cầu phê duyệt hoặc làm rõ',
    example: '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  })
  @IsUUID('all', { message: 'messageId phải là định dạng UUID' })
  messageId: string;

  @ApiProperty({
    description:
      'Hành động quyết định: "approve" để duyệt thực thi, "reject" để hủy bỏ, hoặc "clarify" để giải quyết làm rõ',
    enum: EApprovalAction,
    example: EApprovalAction.APPROVE,
  })
  @IsEnum(EApprovalAction, {
    message: `action phải là một trong các giá trị: ${Object.values(EApprovalAction).join(', ')}`,
  })
  action: EApprovalAction;

  @ApiPropertyOptional({
    description: 'Mã định danh hoặc provider của candidate được chọn khi action là "clarify"',
    example: 'sql_server',
  })
  @IsOptional()
  @IsString()
  selectedProvider?: string;

  @ApiPropertyOptional({
    description: 'ID của candidate làm rõ được người dùng lựa chọn (Entity ID hoặc Provider ID)',
    example: 'KH-001',
  })
  @IsOptional()
  @IsString()
  selectedCandidateId?: string;

  @ApiPropertyOptional({
    description: 'Nội dung trả lời tự do của người dùng khi làm rõ câu hỏi',
    example: 'Chọn kênh #sales-team',
  })
  @IsOptional()
  @IsString()
  customAnswer?: string;
}
