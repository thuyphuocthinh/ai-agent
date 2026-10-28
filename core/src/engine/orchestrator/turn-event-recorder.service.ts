import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { EMessageEventType, EMessageRole } from '@agent/core/constants';
import { MessageClientService } from '../../contracts/message-client.service';
import { MessageEvent } from '../../contracts/message-sink.interface';
import { messageEventToChunk } from '../../contracts/message-event-chunk';
import {
  ETurnLogStatus,
  ITurnEventLog,
  TURN_EVENT_LOG,
} from '../../contracts/turn-event-log.interface';

/**
 * Ghi vào event log những thứ KHÔNG đi qua step của engine: yêu cầu duyệt/làm rõ
 * và câu trả lời cuối (chỉ có dưới dạng event message). Chạy phía worker nên log
 * đầy đủ kể cả khi không còn client nào đang kết nối.
 *
 * Xử lý tuần tự qua 1 hàng đợi để thứ tự trong log đúng thứ tự event; caller chờ
 * idle() trước khi phát DONE để mọi chunk này nằm TRƯỚC DONE.
 */
@Injectable()
export class TurnEventRecorderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TurnEventRecorderService.name);
  private unsubscribe?: () => void;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly messages: MessageClientService,
    @Optional()
    @Inject(TURN_EVENT_LOG)
    private readonly eventLog?: ITurnEventLog,
  ) {}

  onModuleInit(): void {
    if (!this.eventLog) return;
    this.unsubscribe = this.messages.onMessage((event) => this.enqueue(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** Chờ mọi event đã nhận được ghi xong vào log. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(event: MessageEvent): void {
    if (event.role !== EMessageRole.MODEL) return;
    this.chain = this.chain
      .then(() => this.record(event))
      .catch((error: unknown) =>
        this.logger.warn(`Không ghi được event message vào turn log: ${(error as Error)?.message}`),
      );
  }

  private async record(event: MessageEvent): Promise<void> {
    const log = this.eventLog;
    if (!log) return;

    if (event.type === EMessageEventType.CREATED) {
      const chunk = messageEventToChunk(event);
      if (!chunk) return;
      // Message duyệt/làm rõ có id riêng, thuộc turn đang chạy của conversation.
      const turnId = await log.findActiveTurnId(event.conversationId);
      if (turnId) await log.appendChunk(turnId, chunk);
      return;
    }

    // 'updated': chỉ câu trả lời (chuỗi, không rỗng) của 1 turn đang ACTIVE.
    if (typeof event.content !== 'string' || event.content.length === 0) return;
    const meta = await log.getMeta(event.id);
    if (!meta || meta.status !== ETurnLogStatus.ACTIVE) return;
    const chunk = messageEventToChunk(event, event.id);
    if (chunk) await log.appendChunk(event.id, chunk);
  }
}
