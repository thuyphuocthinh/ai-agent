import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class HistoryQueryDto {
  @ApiPropertyOptional({
    description: 'ID phiên làm việc để truy vấn lịch sử',
    example: '5f1d6a0e-8b0c-4a53-9d0b-1c2d3e4f5a6b',
  })
  @IsOptional()
  @IsUUID('4', { message: 'sessionId phải là định dạng UUID' })
  sessionId?: string;
}
