import { ServerResponse } from 'http';
import { Injectable } from '@nestjs/common';
import { pipeUIMessageStreamToResponse } from 'ai';
import { TurnStream } from '../../../contracts';

/**
 * Presenter phụ trách chuyển tiếp dòng sự kiện Vercel AI UI Message Stream
 * sang kết nối HTTP phản hồi của client (SSE) và quản lý vòng đời kết nối.
 */
@Injectable()
export class UiStreamPresenter {
  /**
   * Chuyển tiếp stream sang response và huỷ turn nếu client ngắt kết nối giữa chừng.
   */
  async pipe(res: ServerResponse, turn: TurnStream): Promise<void> {
    // Client ngắt socket (F5 reload / network blip): chỉ đóng reader của response HTTP hiện tại,
    // KHÔNG huỷ lượt chạy của engine trong hàng đợi nền để giữ nguyên buffer cho client kết nối lại.
    res.on('close', () => {
      if (!res.writableFinished && turn.close) {
        turn.close();
      }
    });

    await pipeUIMessageStreamToResponse({
      response: res,
      stream: turn.stream,
      headers: {
        'x-playground-session': turn.sessionId,
      },
    });
  }
}
