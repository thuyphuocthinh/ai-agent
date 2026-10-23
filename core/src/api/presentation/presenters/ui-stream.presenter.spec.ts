import { ServerResponse } from 'http';
import { EventEmitter } from 'events';
import type { UIMessageChunk } from 'ai';
import { TurnStream } from '../../../contracts';
import { UiStreamPresenter } from './ui-stream.presenter';

jest.mock('ai', () => ({
  pipeUIMessageStreamToResponse: jest.fn().mockResolvedValue(undefined),
}));

describe('UiStreamPresenter', () => {
  let presenter: UiStreamPresenter;

  beforeEach(() => {
    presenter = new UiStreamPresenter();
    jest.clearAllMocks();
  });

  it('pipes stream to response with session header', async () => {
    const { pipeUIMessageStreamToResponse } = jest.requireMock('ai');
    const mockRes = new EventEmitter() as unknown as ServerResponse;
    const mockTurn: TurnStream = {
      sessionId: 'sess-123',
      stream: new ReadableStream<UIMessageChunk>(),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    await presenter.pipe(mockRes, mockTurn);

    expect(pipeUIMessageStreamToResponse).toHaveBeenCalledWith({
      response: mockRes,
      stream: mockTurn.stream,
      headers: {
        'x-playground-session': 'sess-123',
      },
    });
  });

  it('cancels turn when client disconnects before finished', async () => {
    const mockRes = new EventEmitter() as unknown as ServerResponse & { writableFinished: boolean };
    mockRes.writableFinished = false;

    const mockCancel = jest.fn().mockResolvedValue(undefined);
    const mockTurn: TurnStream = {
      sessionId: 'sess-123',
      stream: new ReadableStream<UIMessageChunk>(),
      cancel: mockCancel,
    };

    await presenter.pipe(mockRes as unknown as ServerResponse, mockTurn);

    mockRes.emit('close');
    expect(mockCancel).toHaveBeenCalled();
  });
});
