import { buildReactRequestIdentity } from './react-request-identity.util';
import { IProcessAiTriggerJobData } from '../../../contracts/queue/job-data.interface';

const base: IProcessAiTriggerJobData = {
  userId: 'user-1',
  channelId: 'channel-1',
  messageId: 'msg-1',
};

describe('buildReactRequestIdentity', () => {
  it('maps the minimal job data, defaulting the channel type to "web"', () => {
    expect(buildReactRequestIdentity(base)).toEqual({
      userId: 'user-1',
      channelId: 'channel-1',
      conversationId: undefined,
      workspaceId: undefined,
      tenantId: undefined,
      channelType: 'web',
      sessionType: undefined,
    });
  });

  it('prefers conversationId over the legacy channelId alias', () => {
    const identity = buildReactRequestIdentity({
      ...base,
      conversationId: 'conv-1',
    });

    expect(identity.channelId).toBe('conv-1');
    expect(identity.conversationId).toBe('conv-1');
  });

  it('prefers tenantId over workspaceId for the workspace (same identifier, legacy name)', () => {
    const identity = buildReactRequestIdentity({
      ...base,
      workspaceId: 'ws-1',
      tenantId: 'tenant-1',
    });

    expect(identity.workspaceId).toBe('tenant-1');
    expect(identity.tenantId).toBe('tenant-1');
  });

  it('falls back to workspaceId when there is no tenantId', () => {
    const identity = buildReactRequestIdentity({ ...base, workspaceId: 'ws-1' });

    expect(identity.workspaceId).toBe('ws-1');
    expect(identity.tenantId).toBeUndefined();
  });

  it.each([
    [{ sessionType: 'group', channelType: 'direct' }, 'group'],
    [{ channelType: 'direct' }, 'direct'],
    [{}, 'web'],
  ])('derives the channel type from %j as %s', (extra, expected) => {
    const identity = buildReactRequestIdentity({ ...base, ...extra });

    expect(identity.channelType).toBe(expected);
  });

  it('keeps sessionType as given (no default)', () => {
    expect(
      buildReactRequestIdentity({ ...base, sessionType: 'cli' }).sessionType,
    ).toBe('cli');
  });
});
