import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';

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
  @IsUUID('all', { message: 'sessionId phải là định dạng UUID' })
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Mã định danh Fixed Workflow muốn thực thi trực tiếp (bỏ qua Dynamic Supervisor).',
    example: 'customer-support',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  workflowId?: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn công khai hoặc Pre-signed URL của ảnh cần phân tích (khuyên dùng Direct-to-Cloud).',
    example: 'https://storage.mycompany.com/temp/invoices/inv-001.jpg',
  })
  @Transform(trim)
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'], require_tld: false },
    { message: 'imageUrl phải là một URL hợp lệ bắt đầu bằng http:// hoặc https://' },
  )
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Dữ liệu ảnh dạng Base64 nếu gửi trực tiếp qua API (data:image/... hoặc raw base64).',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
  })
  @IsOptional()
  @IsString({ message: 'imageBase64 phải là chuỗi ký tự base64' })
  imageBase64?: string;

  @ApiPropertyOptional({
    description: 'Kênh hội thoại (web, api, telegram, slack). Mặc định là web.',
    example: 'web',
  })
  @IsOptional()
  @IsString()
  channelType?: string;

  @ApiPropertyOptional({
    description: 'Loại phiên làm việc (web, direct, group). Mặc định đồng bộ theo channelType.',
    example: 'direct',
  })
  @IsOptional()
  @IsString()
  sessionType?: string;
}
