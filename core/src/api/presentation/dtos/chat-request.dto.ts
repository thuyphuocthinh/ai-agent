import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

export class ChatRequestDto {
  @ApiProperty({
    description: 'Nội dung câu hỏi hoặc chỉ thị của người dùng gửi tới engine',
    example: 'Tìm thông tin doanh thu tháng 10 của khách hàng Nguyễn Văn A',
  })
  @Trim()
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
  @Trim()
  @IsOptional()
  @IsString()
  workflowId?: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn công khai hoặc Pre-signed URL của ảnh cần phân tích (khuyên dùng Direct-to-Cloud).',
    example: 'https://storage.mycompany.com/temp/invoices/inv-001.jpg',
  })
  @Trim()
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
    description: 'Danh sách tối đa 5 đường dẫn URL ảnh để bóc tách song song.',
    example: ['https://storage.mycompany.com/temp/invoices/inv-001.jpg'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'images phải là một mảng chuỗi URL' })
  @ArrayMaxSize(5, { message: 'Tối đa chỉ được gửi 5 ảnh trong một lượt yêu cầu' })
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'], require_tld: false },
    {
      each: true,
      message: 'Mỗi phần tử trong images phải là một URL hợp lệ bắt đầu bằng http:// hoặc https://',
    },
  )
  images?: string[];

  @ApiPropertyOptional({
    description: 'Kênh hội thoại (web, api, telegram, slack). Mặc định là web.',
    example: 'web',
  })
  @Trim()
  @IsOptional()
  @IsString()
  channelType?: string;

  @ApiPropertyOptional({
    description: 'Loại phiên làm việc (web, direct, group). Mặc định đồng bộ theo channelType.',
    example: 'direct',
  })
  @Trim()
  @IsOptional()
  @IsString()
  sessionType?: string;
}
