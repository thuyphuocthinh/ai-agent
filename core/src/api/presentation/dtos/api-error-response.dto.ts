import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 400, description: 'Mã trạng thái HTTP của lỗi' })
  readonly statusCode: number;

  @ApiProperty({ example: 'VALIDATION_ERROR', description: 'Mã định danh lỗi phân loại' })
  readonly code: string;

  @ApiProperty({ example: 'Dữ liệu đầu vào không hợp lệ', description: 'Thông báo lỗi chi tiết' })
  readonly message: string;

  @ApiPropertyOptional({
    description: 'Danh sách chi tiết các lỗi trường dữ liệu hoặc lỗi phụ',
    example: [{ field: 'prompt', message: 'prompt không được để trống' }],
  })
  readonly errors?: unknown;

  @ApiProperty({ example: '/api/chat', description: 'Đường dẫn API phát sinh lỗi' })
  readonly path: string;

  @ApiProperty({
    example: '2026-10-22T21:15:00.000Z',
    description: 'Thời điểm xảy ra lỗi theo chuẩn ISO-8601',
  })
  readonly timestamp: string;

  @ApiProperty({
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    description: 'Mã định danh truy vết yêu cầu (Trace ID)',
  })
  readonly traceId: string;

  constructor(partial: Partial<ApiErrorResponseDto>) {
    Object.assign(this, partial);
  }
}
