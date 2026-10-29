import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GetIntegrationsStatusQueryDto {
  @ApiPropertyOptional({
    description: 'ID chủ sở hữu / người dùng kết nối (mặc định lấy theo phiên hoặc user)',
    example: 'user-default-1',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class IntegrationFormFieldDto {
  @ApiProperty({ description: 'Tên trường', example: 'host' })
  name: string;

  @ApiProperty({ description: 'Nhãn hiển thị', example: 'Server Host / IP' })
  label: string;

  @ApiProperty({ description: 'Kiểu dữ liệu (text, password, number)', example: 'text' })
  type: string;

  @ApiPropertyOptional({ description: 'Bắt buộc nhập', example: true })
  required?: boolean;

  @ApiPropertyOptional({ description: 'Placeholder gợi ý', example: 'localhost' })
  placeholder?: string;
}

export class IntegrationStatusItemDto {
  @ApiProperty({ description: 'Mã định danh provider', example: 'github' })
  providerId: string;

  @ApiProperty({ description: 'Tên hiển thị', example: 'GitHub' })
  name: string;

  @ApiProperty({ description: 'Phân loại tích hợp', example: 'oauth2', enum: ['oauth2', 'form', 'native'] })
  type: 'oauth2' | 'form' | 'native';

  @ApiProperty({ description: 'Mô tả tính năng', example: 'Quản lý repos, issues và pull requests' })
  description: string;

  @ApiProperty({ description: 'Trạng thái đã kết nối hay chưa', example: true })
  isConnected: boolean;

  @ApiProperty({ description: 'Trạng thái chi tiết', example: 'connected' })
  status: string;

  @ApiPropertyOptional({ description: 'Thời điểm kết nối thành công', example: '2026-10-28T20:00:00.000Z' })
  connectedAt?: string | null;

  @ApiPropertyOptional({
    description: 'Cấu hình các trường form (nếu là dạng form nhập liệu)',
    type: [IntegrationFormFieldDto],
  })
  fields?: IntegrationFormFieldDto[];
}

export class InitiateIntegrationQueryDto {
  @ApiProperty({ description: 'Mã provider cần kết nối', example: 'github' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'provider không được để trống' })
  provider: string;

  @ApiPropertyOptional({ description: 'ID chủ sở hữu kết nối', example: 'user-default-1' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class InitiateIntegrationResponseDto {
  @ApiProperty({ description: 'Mã provider', example: 'github' })
  provider: string;

  @ApiPropertyOptional({
    description: 'URL chuyển hướng đăng nhập OAuth2 (nếu là dạng OAuth)',
    example: 'https://github.com/login/oauth/authorize?...',
  })
  authUrl?: string;

  @ApiPropertyOptional({
    description: 'Danh sách các trường cần điền (nếu là dạng form nhập liệu DB)',
    type: [IntegrationFormFieldDto],
  })
  fields?: IntegrationFormFieldDto[];
}

export class SubmitIntegrationCredentialsDto {
  @ApiProperty({ description: 'Mã provider cần lưu credential', example: 'sql_server' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'provider không được để trống' })
  provider: string;

  @ApiProperty({
    description: 'Dữ liệu credentials cần mã hóa và lưu trữ an toàn trong mcp_auth',
    example: { host: 'localhost', user: 'sa', password: 'secretPassword', database: 'ecommerce' },
  })
  @IsObject()
  credentials: Record<string, string>;

  @ApiPropertyOptional({ description: 'ID chủ sở hữu kết nối', example: 'user-default-1' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class DisconnectIntegrationDto {
  @ApiPropertyOptional({ description: 'ID chủ sở hữu kết nối', example: 'user-default-1' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class IntegrationActionResponseDto {
  @ApiProperty({ description: 'Kết quả thao tác', example: true })
  success: boolean;

  @ApiProperty({ description: 'Thông báo', example: 'Disconnected successfully' })
  message: string;
}
