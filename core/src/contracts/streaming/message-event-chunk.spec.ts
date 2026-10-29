import { EMessageEventType, EMessageRole } from '@agent/core/constants';
import { messageEventToChunk } from './message-event-chunk';
import { MessageEvent } from './message-sink.interface';

const event = (over: Partial<MessageEvent>): MessageEvent => ({
  type: EMessageEventType.CREATED,
  id: 'msg-1',
  conversationId: 'conv-1',
  role: EMessageRole.MODEL,
  content: '',
  ...over,
});

describe('messageEventToChunk', () => {
  it('yêu cầu duyệt → data-approval kèm id message, tool, preview, friendlySummary', () => {
    const chunk = messageEventToChunk(
      event({
        content: {
          type: 'approval_request',
          tool: { provider: 'sql', name: 'write' },
          preview: 'UPDATE ...',
          friendlySummary: 'Cập nhật đơn',
        },
      }),
    );

    expect(chunk).toEqual({
      type: 'data-approval',
      data: {
        messageId: 'msg-1',
        tool: { provider: 'sql', name: 'write' },
        preview: 'UPDATE ...',
        friendlySummary: 'Cập nhật đơn',
      },
    });
  });

  it('yêu cầu làm rõ → data-clarification kèm câu hỏi và ứng viên', () => {
    const chunk = messageEventToChunk(
      event({
        content: {
          type: 'clarification_request',
          question: 'Chọn ai?',
          candidates: [{ provider: 'a', label: 'A' }],
        },
      }),
    );

    expect(chunk).toMatchObject({
      type: 'data-clarification',
      data: {
        messageId: 'msg-1',
        preview: 'Chọn ai?',
        friendlySummary: 'Chọn ai?',
        candidates: [{ provider: 'a', label: 'A' }],
      },
    });
  });

  it('message tạo mới khác (VD reply placeholder) → null', () => {
    expect(messageEventToChunk(event({ content: '🤖 Đang xử lý...' }))).toBeNull();
    expect(messageEventToChunk(event({ content: { type: 'other' } }))).toBeNull();
  });

  it('cập nhật câu trả lời của đúng reply → data-reply; reply khác hoặc không phải chuỗi → null', () => {
    const updated = event({ type: EMessageEventType.UPDATED, content: 'Đáp án' });

    expect(messageEventToChunk(updated, 'msg-1')).toEqual({
      type: 'data-reply',
      data: { messageId: 'msg-1', text: 'Đáp án' },
    });
    expect(messageEventToChunk(updated, 'msg-khac')).toBeNull();
    expect(messageEventToChunk(updated)).toBeNull();
    expect(
      messageEventToChunk(event({ type: EMessageEventType.UPDATED, content: { type: 'x' } }), 'msg-1'),
    ).toBeNull();
  });
});
