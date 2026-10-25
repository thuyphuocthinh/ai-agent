import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export class ApproveRequestDto {
  @ApiProperty({
    description: 'ID của phiên làm việc chứa yêu cầu duyệt',
    example: '5f1d6a0e-8b0c-4a53-9d0b-1c2d3e4f5a6b',
  })
  @IsUUID('all', { message: 'sessionId phải là định dạng UUID' })
  sessionId: string;

  @ApiProperty({
    description: 'ID của message checkpoint yêu cầu phê duyệt',
    example: '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  })
  @IsUUID('all', { message: 'messageId phải là định dạng UUID' })
  messageId: string;

  @ApiProperty({
    description: 'Hành động quyết định: "approve" để cho phép thực thi, hoặc "reject" để hủy bỏ',
    enum: ['approve', 'reject'],
    example: 'approve',
  })
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';
}
