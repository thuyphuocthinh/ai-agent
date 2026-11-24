import type { IncomingMessage, ServerResponse } from 'http';
import { StorageController } from '../presentation/controllers/storage.controller';
import { ChatController } from '../presentation/controllers/chat.controller';
import { UiStreamPresenter } from '../presentation/presenters/ui-stream.presenter';
import { ChatService } from './chat.service';
import { ChatSessionManager } from './chat-session.manager';
import { TurnStreamFactory } from './turn-stream.factory';
import { MessageClientService } from '../../engine/streaming/message-client.service';
import { AgentStreamService } from '../../engine/streaming/agent-stream.service';
import { PromptInjectionGuard } from '../../security';
import { LocalStorageService } from '../../infrastructure/storage/local-storage.service';
import { VisionLlmOcrService } from '../../engine/ocr/vision-llm-ocr.service';
import { VisionProviderResolver } from '../../engine/ocr/vision-provider.resolver';
import { IQueueDispatcher, EQueueName, EJobName } from '../../infrastructure/queue';

describe('Storage Upload & Multimodal End-to-End Flow (Integration)', () => {
  let storageController: StorageController;
  let chatController: ChatController;
  let sessionManager: ChatSessionManager;
  let messages: MessageClientService;
  let ocrService: VisionLlmOcrService;
  let localStorageService: LocalStorageService;
  const queueDispatcher: jest.Mocked<IQueueDispatcher> = {
    dispatch: jest.fn(),
    getJobCounts: jest.fn(),
  };

  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queueDispatcher.dispatch.mockResolvedValue({ id: 'job-123' } as never);
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    localStorageService = new LocalStorageService();
    storageController = new StorageController(localStorageService);

    sessionManager = new ChatSessionManager();
    const agentStream = new AgentStreamService();
    messages = new MessageClientService(agentStream);
    const streamFactory = new TurnStreamFactory(agentStream, messages, { requestCancel: jest.fn() } as never);
    const injectionGuard = new PromptInjectionGuard();

    const mockProvider = {
      id: 'gemini',
      isAvailable: jest.fn().mockReturnValue(true),
      generateText: jest
        .fn()
        .mockResolvedValue('| Dịch vụ | Thành tiền |\n| Phí lưu kho | 1.500.000đ |'),
    };
    const mockResolver = {
      resolve: jest.fn().mockReturnValue({ primary: mockProvider }),
    } as unknown as VisionProviderResolver;

    ocrService = new VisionLlmOcrService(mockResolver, localStorageService);

    const chatService = new ChatService(
      sessionManager,
      streamFactory,
      queueDispatcher,
      messages,
      undefined as never,
      injectionGuard,
      undefined,
      undefined,
      undefined,
      ocrService,
    );

    const streamPresenter = {
      pipe: jest.fn().mockResolvedValue(undefined),
    } as unknown as UiStreamPresenter;

    chatController = new ChatController(chatService, streamPresenter);
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('thực thi trọn vẹn luồng thật: Presigned URL -> PUT upload -> GET verify -> Chat kèm imageUrl -> Lưu attachments và enriched prompt', async () => {
    // 1. Client xin Pre-signed URL
    const presigned = await storageController.createPresignedUrl({
      filename: 'invoice-receipt.png',
      contentType: 'image/png',
      folder: 'attachments',
    });

    expect(presigned.uploadUrl).toBeDefined();
    expect(presigned.publicUrl).toBeDefined();
    expect(presigned.key).toMatch(/^attachments\/[0-9a-f-]+\.png$/);

    const filename = presigned.key.replace('attachments/', '');

    // 2. Client gửi HTTP PUT upload dữ liệu ảnh lên uploadUrl
    const mockPutReq = {
      headers: { 'content-type': 'image/png' },
      async *[Symbol.asyncIterator]() {
        yield samplePngBuffer;
      },
    } as unknown as IncomingMessage;

    const putResult = await storageController.uploadLocalFile(
      'attachments',
      filename,
      'image/png',
      mockPutReq,
    );
    expect(putResult.status).toBe('success');
    expect(putResult.key).toBe(presigned.key);

    // 3. Client hoặc trình duyệt kiểm tra GET file từ publicUrl
    const resHeaders: Record<string, string> = {};
    const mockGetRes = {
      setHeader: (name: string, value: string) => {
        resHeaders[name] = value;
      },
    } as unknown as ServerResponse;

    const streamable = await storageController.getLocalFile('attachments', filename, mockGetRes);
    expect(resHeaders['Content-Type']).toBe('image/png');
    expect(streamable.getStream()).toBeDefined();

    // 4. Client gọi POST /api/chat với imageUrl trỏ tới publicUrl vừa tải lên
    const userPrompt = 'Tính tổng tiền giúp tôi';
    const mockRes = {} as unknown as ServerResponse;

    await chatController.chat(
      {
        sessionId: 'session-e2e-real-flow',
        prompt: userPrompt,
        imageUrl: presigned.publicUrl,
      },
      mockRes,
    );

    // 5. Kiểm chứng User Message lưu prompt gốc sạch + mảng attachments
    const session = sessionManager.get('session-e2e-real-flow')!;
    const sessionHistory = await messages.getRecentHistory({
      conversationId: session.conversationId,
      limit: 10,
    });
    const lastTurn = sessionHistory[sessionHistory.length - 1];

    expect(lastTurn).toBeDefined();
    expect(lastTurn.text).toBe(userPrompt);
    expect(lastTurn.attachments).toEqual([
      {
        type: 'image',
        url: presigned.publicUrl,
      },
    ]);

    // 6. Kiểm chứng BullMQ Job nhận enriched prompt mang nội dung trích xuất OCR
    expect(queueDispatcher.dispatch).toHaveBeenCalledWith(
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EJobName.PROCESS_AI_TRIGGER,
      expect.objectContaining({
        prompt: expect.stringContaining('| Dịch vụ | Thành tiền |'),
      }),
    );
  });
});
