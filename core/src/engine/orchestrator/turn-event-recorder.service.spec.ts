import { EMessageEventType, EMessageRole } from '@agent/core/constants';
import {
  ETurnLogStatus,
  ITurnEventLog,
  MessageEvent,
  TurnLogMeta,
} from '../../contracts';
import { MessageClientService } from '../../contracts/message-client.service';
import { TurnEventRecorderService } from './turn-event-recorder.service';

describe('TurnEventRecorderService', () => {
  let emit: (event: MessageEvent) => void;
  const unsubscribe = jest.fn();
  const messages = {
    onMessage: jest.fn((listener: (event: MessageEvent) => void) => {
      emit = listener;
      return unsubscribe;
    }),
  };
  const log = {
    appendChunk: jest.fn(),
    findActiveTurnId: jest.fn(),
    getMeta: jest.fn(),
  } as unknown as jest.Mocked<ITurnEventLog>;

  const meta = (status: ETurnLogStatus): TurnLogMeta => ({
    messageId: 'reply-1',
    status,
    startedAt: 1,
    updatedAt: 1,
  });
  const approval = (over: Partial<MessageEvent> = {}): MessageEvent => ({
    type: EMessageEventType.CREATED,
    id: 'approval-1',
    conversationId: 'conv-1',
    role: EMessageRole.MODEL,
    content: { type: 'approval_request', tool: { name: 't' }, preview: 'p' },
    ...over,
  });

  let recorder: TurnEventRecorderService;

  beforeEach(() => {
    jest.clearAllMocks();
    (log.appendChunk as jest.Mock).mockResolvedValue(undefined);
    recorder = new TurnEventRecorderService(
      messages as unknown as MessageClientService,
      log,
    );
    recorder.onModuleInit();
  });

  it('không có event log thì không đăng ký lắng nghe', () => {
    messages.onMessage.mockClear();
    new TurnEventRecorderService(messages as unknown as MessageClientService).onModuleInit();

    expect(messages.onMessage).not.toHaveBeenCalled();
  });

  it('huỷ đăng ký khi module huỷ', () => {
    recorder.onModuleDestroy();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('yêu cầu duyệt: ghi data-approval vào turn đang chạy của conversation', async () => {
    log.findActiveTurnId.mockResolvedValue('reply-1');

    emit(approval());
    await recorder.idle();

    expect(log.findActiveTurnId).toHaveBeenCalledWith('conv-1');
    expect(log.appendChunk).toHaveBeenCalledWith(
      'reply-1',
      expect.objectContaining({ type: 'data-approval' }),
    );
  });

  it('không có turn đang chạy: không ghi gì', async () => {
    log.findActiveTurnId.mockResolvedValue(null);

    emit(approval());
    await recorder.idle();

    expect(log.appendChunk).not.toHaveBeenCalled();
  });

  it('câu trả lời cuối của turn ACTIVE: ghi data-reply', async () => {
    log.getMeta.mockResolvedValue(meta(ETurnLogStatus.ACTIVE));

    emit({ ...approval(), type: EMessageEventType.UPDATED, id: 'reply-1', content: 'Đáp án' });
    await recorder.idle();

    expect(log.appendChunk).toHaveBeenCalledWith('reply-1', {
      type: 'data-reply',
      data: { messageId: 'reply-1', text: 'Đáp án' },
    });
  });

  it.each([
    ['turn đã kết thúc', meta(ETurnLogStatus.DONE), 'Đáp án'],
    ['không phải turn nào (không có meta)', null, 'Đáp án'],
    ['nội dung rỗng', meta(ETurnLogStatus.ACTIVE), ''],
  ])('bỏ qua cập nhật khi %s', async (_name, found, content) => {
    log.getMeta.mockResolvedValue(found);

    emit({ ...approval(), type: EMessageEventType.UPDATED, id: 'reply-1', content });
    await recorder.idle();

    expect(log.appendChunk).not.toHaveBeenCalled();
  });

  it('bỏ qua event của user và nội dung không phải chuỗi khi cập nhật', async () => {
    emit(approval({ role: EMessageRole.USER }));
    emit({ ...approval(), type: EMessageEventType.UPDATED, id: 'reply-1', content: { type: 'x' } });
    await recorder.idle();

    expect(log.findActiveTurnId).not.toHaveBeenCalled();
    expect(log.appendChunk).not.toHaveBeenCalled();
  });

  it('giữ đúng thứ tự event và idle() chờ ghi xong tất cả', async () => {
    const written: string[] = [];
    log.findActiveTurnId.mockResolvedValue('reply-1');
    log.getMeta.mockResolvedValue(meta(ETurnLogStatus.ACTIVE));
    (log.appendChunk as jest.Mock).mockImplementation(async (_id, chunk) => {
      await new Promise((resolve) => setTimeout(resolve, chunk.type === 'data-approval' ? 20 : 0));
      written.push(chunk.type);
    });

    emit(approval());
    emit({ ...approval(), type: EMessageEventType.UPDATED, id: 'reply-1', content: 'Đáp án' });
    await recorder.idle();

    expect(written).toEqual(['data-approval', 'data-reply']);
  });

  it('lỗi ghi log không làm hỏng các event sau', async () => {
    log.findActiveTurnId.mockResolvedValue('reply-1');
    (log.appendChunk as jest.Mock)
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);

    emit(approval());
    emit(approval({ id: 'approval-2' }));
    await recorder.idle();

    expect(log.appendChunk).toHaveBeenCalledTimes(2);
  });
});
