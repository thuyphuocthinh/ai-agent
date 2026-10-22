import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ChatRequestDto {
  @ApiProperty({
    description: 'Nội dung câu hỏi hoặc chỉ thị của người dùng gửi tới engine',
    example: 'Tìm thông tin doanh thu tháng 10 của khách hàng Nguyễn Văn A',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'prompt không được để trống' })
  prompt: string;

  @ApiPropertyOptional({
    description: 'ID phiên làm việc hiện tại (UUID). Nếu để trống, hệ thống sẽ tự sinh phiên mới.',
    example: '5f1d6a0e-8b0c-4a53-9d0b-1c2d3e4f5a6b',
  })
  @IsOptional()
  @IsUUID('4', { message: 'sessionId phải là định dạng UUID' })
  sessionId?: string;
}
