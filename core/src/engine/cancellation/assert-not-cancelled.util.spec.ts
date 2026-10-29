import { assertNotCancelled } from './assert-not-cancelled.util';
import { AgentCancellationService } from './agent-cancellation.service';
import { TurnCancelledError } from '../loop/errors/turn-cancelled.error';

describe('assertNotCancelled', () => {
  const isCancelled = jest.fn();
  const cancellation = { isCancelled } as unknown as AgentCancellationService;

  afterEach(() => jest.resetAllMocks());

  it('resolves when the turn is not cancelled and there is no abort signal', async () => {
    isCancelled.mockResolvedValue(false);

    await expect(assertNotCancelled(cancellation, 'msg-1')).resolves.toBeUndefined();
    expect(isCancelled).toHaveBeenCalledWith('msg-1');
  });

  it('resolves when the signal exists but is not aborted', async () => {
    isCancelled.mockResolvedValue(false);

    await expect(
      assertNotCancelled(cancellation, 'msg-1', new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('throws TurnCancelledError when the user requested a stop', async () => {
    isCancelled.mockResolvedValue(true);

    await expect(assertNotCancelled(cancellation, 'msg-1')).rejects.toBeInstanceOf(
      TurnCancelledError,
    );
  });

  it('throws TurnCancelledError when the signal is already aborted', async () => {
    isCancelled.mockResolvedValue(false);
    const controller = new AbortController();
    controller.abort();

    await expect(
      assertNotCancelled(cancellation, 'msg-1', controller.signal),
    ).rejects.toBeInstanceOf(TurnCancelledError);
  });

  it('still asks the cancellation store first even if the signal is aborted (same order as before)', async () => {
    isCancelled.mockResolvedValue(false);
    const controller = new AbortController();
    controller.abort();

    await assertNotCancelled(cancellation, 'msg-1', controller.signal).catch(() => undefined);

    expect(isCancelled).toHaveBeenCalledTimes(1);
  });

  it('throws an error without partial text', async () => {
    isCancelled.mockResolvedValue(true);

    await expect(assertNotCancelled(cancellation, 'msg-1')).rejects.toMatchObject({
      partialText: undefined,
    });
  });
});
