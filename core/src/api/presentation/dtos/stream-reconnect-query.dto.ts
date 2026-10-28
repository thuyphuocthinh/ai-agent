import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class StreamReconnectQueryDto {
  @ApiProperty({
    description: 'Mã định danh phiên hội thoại (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsNotEmpty({ message: 'sessionId không được để trống' })
  @IsUUID('all', { message: 'sessionId phải là định dạng UUID hợp lệ' })
  sessionId: string;

  @ApiPropertyOptional({
    description: 'Mã định danh tin nhắn đang thực thi cần nghe tiếp stream',
    example: '018f4a12-873b-7a32-9cb1-3a0e1b234567',
  })
  @IsOptional()
  @IsUUID('all', { message: 'messageId phải là định dạng UUID hợp lệ' })
  messageId?: string;
}
