import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkflowSummaryDto {
  @ApiProperty({
    description: 'Mã định danh duy nhất của workflow',
    example: 'hotel-booking',
  })
  id: string;

  @ApiProperty({
    description: 'Tên hiển thị của workflow',
    example: 'Hotel Booking Assistant',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Mô tả chức năng nghiệp vụ của workflow',
    example: 'Hỗ trợ tra cứu phòng trống và đặt phòng khách sạn',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Danh sách các công cụ được gắn quyền cho workflow',
    example: ['search_rooms', 'book_room'],
    type: [String],
  })
  tools?: string[];
}
