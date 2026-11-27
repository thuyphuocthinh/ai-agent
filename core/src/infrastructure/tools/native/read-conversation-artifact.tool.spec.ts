import { CONV_ARTIFACT_ERROR_CODES } from '@agent/core/constants';
import { IConversationArtifactStore } from '../../../contracts/storage/conversation-artifact.interface';
import { ReadConversationArtifactTool } from './read-conversation-artifact.tool';

describe('ReadConversationArtifactTool', () => {
  const mockStore: jest.Mocked<IConversationArtifactStore> = {
    save: jest.fn(),
    read: jest.fn(),
    cleanExpired: jest.fn(),
  };

  let tool: ReadConversationArtifactTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ReadConversationArtifactTool(mockStore);
  });

  it('returns MISSING_CONVERSATION when conversationId is absent', async () => {
    const res = await tool.execute({ filename: 'artifact_1.json' }, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(
      CONV_ARTIFACT_ERROR_CODES.MISSING_CONVERSATION,
    );
  });

  it('returns INVALID_ARGUMENTS when filename is missing or blank', async () => {
    const res = await tool.execute(
      { filename: '   ' },
      { conversationId: 'conv-1' },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(
      CONV_ARTIFACT_ERROR_CODES.INVALID_ARGUMENTS,
    );
  });

  it('returns READ_FAILED when store throws', async () => {
    mockStore.read.mockRejectedValueOnce(new Error('ARTIFACT_NOT_FOUND: missing'));

    const res = await tool.execute(
      { filename: 'missing.json' },
      { conversationId: 'conv-1' },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(CONV_ARTIFACT_ERROR_CODES.READ_FAILED);
    expect(res.content[0].text).toContain('missing');
  });

  it('reads artifact slice by offsetChars and limitChars cleanly', async () => {
    mockStore.read.mockResolvedValueOnce('0123456789ABCDEF');

    const res = await tool.execute(
      { filename: 'artifact_abc.txt', offsetChars: 4, limitChars: 6 },
      { conversationId: 'conv-1' },
    );

    expect(mockStore.read).toHaveBeenCalledWith('conv-1', 'artifact_abc.txt');
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.content[0].text ?? '{}');
    expect(parsed).toEqual({
      filename: 'artifact_abc.txt',
      totalLength: 16,
      offset: 4,
      hasMore: true,
      content: '456789',
    });
  });
});
