import {
  buildChannelStreamContext,
  buildStreamContext,
  resolveTurnChannel,
} from './stream-context.util';
import { IProcessAiTriggerJobData } from '../../../../contracts/queue/job-data.interface';

const data: IProcessAiTriggerJobData = {
  userId: 'user-1',
  channelId: 'channel-1',
  messageId: 'trigger-1',
};

describe('resolveTurnChannel', () => {
  it('falls back to the legacy channelId and defaults the session type to "direct"', () => {
    expect(resolveTurnChannel(data)).toEqual({
      conversationId: 'channel-1',
      sessionType: 'direct',
    });
  });

  it('prefers conversationId and sessionType over their legacy aliases', () => {
    expect(
      resolveTurnChannel({
        ...data,
        conversationId: 'conv-1',
        sessionType: 'group',
        channelType: 'web',
      }),
    ).toEqual({ conversationId: 'conv-1', sessionType: 'group' });
  });

  it('uses channelType when there is no sessionType', () => {
    expect(resolveTurnChannel({ ...data, channelType: 'web' }).sessionType).toBe('web');
  });
});

describe('buildChannelStreamContext', () => {
  it('mirrors conversationId/sessionType into the legacy channelId/channelType aliases', () => {
    expect(buildChannelStreamContext('user-1', 'conv-1', 'group', 'reply-1')).toEqual({
      userId: 'user-1',
      conversationId: 'conv-1',
      channelId: 'conv-1',
      messageId: 'reply-1',
      sessionType: 'group',
      channelType: 'group',
    });
  });

  it('has no streamKey property unless one is given (exact object shape is preserved)', () => {
    const without = buildChannelStreamContext('u', 'c', 'direct', 'm');
    const withKey = buildChannelStreamContext('u', 'c', 'direct', 'm', 'worker-1');

    expect('streamKey' in without).toBe(false);
    expect(withKey.streamKey).toBe('worker-1');
  });
});

describe('buildStreamContext', () => {
  it('derives the context from the job data and the reply message id', () => {
    expect(buildStreamContext(data, 'reply-1')).toEqual({
      userId: 'user-1',
      conversationId: 'channel-1',
      channelId: 'channel-1',
      messageId: 'reply-1',
      sessionType: 'direct',
      channelType: 'direct',
    });
  });

  it('adds the stream key for parallel workers', () => {
    expect(buildStreamContext(data, 'reply-1', 'worker-2').streamKey).toBe('worker-2');
  });
});
