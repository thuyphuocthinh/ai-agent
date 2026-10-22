import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class NumberedPaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Số thứ tự trang cần lấy' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Số lượng phần tử trên mỗi trang' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class NumberedPageMetaDto {
  @ApiProperty({ example: 1, description: 'Trang hiện tại' })
  page: number;

  @ApiProperty({ example: 20, description: 'Số phần tử mỗi trang' })
  limit: number;

  @ApiProperty({ example: 150, description: 'Tổng số phần tử khớp điều kiện' })
  total: number;

  @ApiProperty({ example: 8, description: 'Tổng số trang' })
  totalPages: number;

  @ApiProperty({ example: true, description: 'Có trang kế tiếp hay không' })
  hasNext: boolean;

  @ApiProperty({ example: false, description: 'Có trang trước đó hay không' })
  hasPrev: boolean;

  constructor(page: number, limit: number, total: number) {
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = Math.ceil(total / limit) || 1;
    this.hasNext = this.page < this.totalPages;
    this.hasPrev = this.page > 1;
  }
}

export class CursorPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Con trỏ chỉ định vị trí bản ghi tiếp theo' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100, description: 'Số lượng phần tử tối đa cần lấy' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class CursorPageMetaDto {
  @ApiProperty({ example: 50, description: 'Số phần tử yêu cầu' })
  limit: number;

  @ApiPropertyOptional({ example: 'cursor_abc123', description: 'Con trỏ của trang kế tiếp (nếu có)' })
  nextCursor?: string;

  @ApiProperty({ example: true, description: 'Còn dữ liệu phía sau hay không' })
  hasMore: boolean;

  constructor(limit: number, nextCursor?: string, hasMore = false) {
    this.limit = limit;
    this.nextCursor = nextCursor;
    this.hasMore = hasMore;
  }
}

export interface PaginatedResult<T, M = NumberedPageMetaDto | CursorPageMetaDto> {
  data: T[];
  meta: M;
}
