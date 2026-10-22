import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiResponseDto<T = unknown> {
  @ApiProperty({ example: 200, description: 'Mã trạng thái HTTP' })
  readonly statusCode: number;

  @ApiProperty({ example: 'Success', description: 'Thông điệp phản hồi' })
  readonly message: string;

  @ApiProperty({ description: 'Dữ liệu kết quả nghiệp vụ' })
  readonly data: T;

  @ApiPropertyOptional({ description: 'Thông tin phân trang hoặc metadata kèm theo' })
  readonly meta?: unknown;

  @ApiProperty({
    example: '2026-10-22T21:15:00.000Z',
    description: 'Thời điểm phản hồi theo chuẩn ISO-8601',
  })
  readonly timestamp: string;

  @ApiProperty({
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    description: 'Mã định danh truy vết yêu cầu (Trace ID)',
  })
  readonly traceId: string;

  constructor(partial: Partial<ApiResponseDto<T>>) {
    Object.assign(this, partial);
  }
}
