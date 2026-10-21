import { ServerResponse } from 'http';
import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { pipeUIMessageStreamToResponse } from 'ai';
import { ApproveRequestDto, ChatRequestDto, HistoryQueryDto } from './chat.dto';
import { ChatService, TurnStream } from './chat.service';

/**
 * API cho client (CLI web playground...) gọi engine. Stream trả về theo chuẩn UI
 * Message Stream v7 (SSE). Dùng @Res() vì @Sse() của Nest chỉ hỗ trợ GET, không
 * gửi được body.
 */
@Controller('api')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat')
  async chat(@Body() dto: ChatRequestDto, @Res() res: ServerResponse): Promise<void> {
    await this.pipe(res, await this.chatService.chat(dto.prompt, dto.sessionId));
  }

  @Post('approve')
  async approve(@Body() dto: ApproveRequestDto, @Res() res: ServerResponse): Promise<void> {
    await this.pipe(
      res,
      await this.chatService.approve(dto.sessionId, dto.messageId, dto.action),
    );
  }

  @Get('history')
  async history(@Query() query: HistoryQueryDto) {
    return { turns: await this.chatService.history(query.sessionId) };
  }

  private async pipe(res: ServerResponse, turn: TurnStream): Promise<void> {
    // Client ngắt giữa chừng thì huỷ turn; đã ghi xong thì không làm gì.
    res.on('close', () => {
      if (!res.writableFinished) void turn.cancel();
    });
    await pipeUIMessageStreamToResponse({
      response: res,
      stream: turn.stream,
      headers: { 'x-playground-session': turn.sessionId },
    });
  }
}
