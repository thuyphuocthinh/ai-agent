import { ApiProperty } from '@nestjs/swagger';
import { ChatHistoryTurnDto } from '../../../contracts/dtos/message-client.dto';

export class HistoryResponseDto {
  @ApiProperty({
    type: [ChatHistoryTurnDto],
    description: 'Danh sách các lượt hội thoại gần nhất trong phiên',
  })
  readonly turns: ChatHistoryTurnDto[];

  constructor(turns: ChatHistoryTurnDto[]) {
    this.turns = turns;
  }
}
