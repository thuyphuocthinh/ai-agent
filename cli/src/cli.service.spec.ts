import { CliService } from './cli.service';
import { Readable, Writable } from 'stream';

describe('CliService', () => {
  let cliService: CliService;
  let outData: string;
  let mockOut: Writable;
  let mockIn: Readable;

  beforeEach(() => {
    outData = '';
    mockOut = new Writable({
      write(chunk, encoding, callback) {
        outData += chunk.toString();
        callback();
      },
    });

    mockIn = new Readable({
      read() {},
    });

    cliService = new CliService({
      inputStream: mockIn,
      outputStream: mockOut,
    });
  });

  describe('IMessageSink', () => {
    it('should create message, store in history, and return id', async () => {
      const res = await cliService.createMessage({
        channelId: 'cli-channel',
        senderId: 'user-1',
        content: 'Hello from agent',
      });

      expect(res.id).toMatch(/^cli-msg-\d+/);
      expect(outData).toContain('Hello from agent');

      const text = await cliService.getMessageText({
        id: res.id,
        userId: 'user-1',
      });
      expect(text).toBe('Hello from agent');
    });

    it('should update message', async () => {
      const res = await cliService.createMessage({
        channelId: 'cli-channel',
        senderId: 'user-1',
        content: 'Initial message',
      });

      await cliService.updateMessage({
        id: res.id,
        userId: 'user-1',
        content: 'Updated text',
      });

      const updated = await cliService.getMessageText({
        id: res.id,
        userId: 'user-1',
      });
      expect(updated).toBe('Updated text');
      expect(outData).toContain('Updated text');
    });

    it('should return recent history', async () => {
      await cliService.createMessage({
        channelId: 'cli-channel',
        senderId: 'user-1',
        content: 'Turn 1',
      });
      await cliService.createMessage({
        channelId: 'cli-channel',
        senderId: 'user-1',
        content: 'Turn 2',
      });

      const history = await cliService.getRecentHistory({
        channelId: 'cli-channel',
        userId: 'user-1',
        beforeMessageId: 'cli-msg-3',
        limit: 5,
      });

      expect(history.length).toBe(2);
      expect(history[0].text).toBe('Turn 1');
      expect(history[1].text).toBe('Turn 2');
    });
  });

  describe('IStreamSink', () => {
    const ctx = {
      userId: 'u1',
      channelId: 'c1',
      messageId: 'm1',
      channelType: 'cli',
    };

    it('should stream steps', async () => {
      await cliService.emitStep(ctx, {
        type: 'tool_call',
        tool: 'weather_tool',
        argsPreview: 'city: Hanoi',
      });
      expect(outData).toContain('[Tool Call] weather_tool(city: Hanoi)');

      await cliService.emitStep(ctx, {
        type: 'tool_result',
        tool: 'weather_tool',
        resultPreview: 'Sunny 28C',
      });
      expect(outData).toContain('[Tool Result] weather_tool -> Sunny 28C');

      await cliService.emitStep(ctx, {
        type: 'done',
      });
      expect(outData).toContain('[Done]');
    });

    it('should support conversationId and sessionType in stream context', async () => {
      const modernCtx = {
        userId: 'u1',
        conversationId: 'conv-1',
        messageId: 'm1',
        sessionType: 'cli',
      };
      await cliService.emitStep(modernCtx, {
        type: 'step_start',
        label: 'Starting agent',
      });
      expect(outData).toContain('[Step] Starting agent');
    });

    it('should stream token and flush', async () => {
      await cliService.emitToken(ctx, 'Hello ');
      await cliService.emitToken(ctx, 'world!');
      await cliService.flush();

      expect(outData).toContain('Hello world!\n');
    });
  });

  describe('Interactive HITL Approval', () => {
    it('should resolve true when user answers y', async () => {
      const approvalPromise = cliService.askHumanApproval('delete_database', { dropAll: true });
      mockIn.push('y\n');

      const approved = await approvalPromise;
      expect(approved).toBe(true);
      expect(outData).toContain('[HITL Approval Required]');
      expect(outData).toContain('delete_database');
    });

    it('should resolve false when user answers n', async () => {
      const approvalPromise = cliService.askHumanApproval('delete_database', { dropAll: true });
      mockIn.push('n\n');

      const approved = await approvalPromise;
      expect(approved).toBe(false);
    });
  });
});
