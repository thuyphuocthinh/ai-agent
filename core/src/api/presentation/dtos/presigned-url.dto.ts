import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PresignedUrlRequestDto {
  @ApiProperty({
    description: 'Tên file gốc bao gồm phần mở rộng (ví dụ: invoice.png)',
    example: 'invoice.png',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'filename không được để trống' })
  filename: string;

  @ApiProperty({
    description: 'MIME type của ảnh cần tải lên',
    enum: ALLOWED_IMAGE_MIME_TYPES,
    example: 'image/png',
  })
  @Transform(trim)
  @IsString()
  @IsIn(ALLOWED_IMAGE_MIME_TYPES as unknown as string[], {
    message: `Chỉ hỗ trợ các định dạng ảnh: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
  })
  contentType: string;

  @ApiPropertyOptional({
    description: 'Thời gian hiệu lực tính bằng giây (mặc định 900s = 15 phút)',
    example: 900,
  })
  @IsOptional()
  @IsPositive({ message: 'expiresInSeconds phải là số nguyên dương' })
  expiresInSeconds?: number;
}

export class PresignedUrlResponseDto {
  @ApiProperty({
    description: 'Pre-signed URL dùng để PUT binary file lên Cloud Storage',
  })
  uploadUrl: string;

  @ApiProperty({
    description: 'URL công khai để truy cập và xem file sau khi tải lên',
  })
  publicUrl: string;

  @ApiProperty({
    description: 'Key định danh của file trong bucket',
  })
  key: string;

  @ApiProperty({
    description: 'Thời gian hiệu lực của uploadUrl (giây)',
  })
  expiresInSeconds: number;
}
