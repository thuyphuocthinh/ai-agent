import { ApiProperty } from '@nestjs/swagger';
import { EConversationState } from '../../../contracts';

export class ConversationItemDto {
  @ApiProperty({
    example: '01a171ed-5764-75bb-b455-73f7e34aed2b',
    description: 'Định danh duy nhất UUIDv7 của cuộc trò chuyện',
  })
  readonly id: string;

  @ApiProperty({
    example: 'Tra cứu danh sách sản phẩm',
    description: 'Tiêu đề cuộc trò chuyện',
  })
  readonly title: string;

  @ApiProperty({
    enum: EConversationState,
    example: EConversationState.AI_ACTIVE,
    description: 'Trạng thái hoạt động của cuộc trò chuyện',
  })
  readonly state: EConversationState;

  @ApiProperty({
    example: '2026-10-25T07:19:02.249Z',
    description: 'Thời điểm tương tác cuối cùng',
  })
  readonly lastSeenAt: Date;

  @ApiProperty({
    example: '2026-10-25T07:19:02.249Z',
    description: 'Thời điểm tạo cuộc trò chuyện',
  })
  readonly createdAt: Date;

  constructor(partial: Partial<ConversationItemDto>) {
    this.id = partial.id ?? '';
    this.title = partial.title ?? 'Cuộc trò chuyện mới';
    this.state = partial.state ?? EConversationState.AI_ACTIVE;
    this.lastSeenAt = partial.lastSeenAt ?? new Date();
    this.createdAt = partial.createdAt ?? new Date();
  }
}
