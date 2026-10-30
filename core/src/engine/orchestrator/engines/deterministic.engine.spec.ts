import { DeterministicEngine } from './deterministic.engine';
import { DeterministicSingleRunner } from './deterministic/deterministic-single.runner';
import { DeterministicSequenceRunner } from './deterministic/deterministic-sequence.runner';
import { DeterministicParallelRunner } from './deterministic/deterministic-parallel.runner';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import {
  EDeterministicNodeType,
  DeterministicGraphDefinition,
} from '../../../contracts/engine/deterministic-graph.interface';
import {
  EExecutionEngineMode,
  EForcedExecutionMode,
  EngineExecutionContext,
  EngineRoutingContext,
} from '../../../contracts/engine/execution-engine.interface';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';
import { ECheckpointKind } from '../../../constants';
import { IWorkflowRegistry, IToolProvider } from '../../../contracts';
import { CheckpointResponseDto } from '../../../contracts/dtos/checkpoint.dto';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';

describe('DeterministicEngine', () => {
  let engine: DeterministicEngine;
  let mockSingleRunner: jest.Mocked<DeterministicSingleRunner>;
  let mockSequenceRunner: jest.Mocked<DeterministicSequenceRunner>;
  let mockParallelRunner: jest.Mocked<DeterministicParallelRunner>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockToolProvider: jest.Mocked<IToolProvider>;
  let mockWorkflowRegistry: jest.Mocked<IWorkflowRegistry>;

  const sampleAnswer: AnswerResult = {
    content: 'Hoàn tất kịch bản định sẵn',
    toolCalls: [],
    steps: [],
  };

  const baseContext: EngineExecutionContext = {
    data: {
      userId: 'user-1',
      channelId: 'chan-1',
      conversationId: 'conv-1',
      messageId: 'msg-in-1',
    },
    replyMessageId: 'reply-1',
    prompt: 'Bắt đầu quy trình',
    agents: [],
    history: [],
  };

  beforeEach(() => {
    mockSingleRunner = {
      run: jest.fn().mockResolvedValue(sampleAnswer),
    } as unknown as jest.Mocked<DeterministicSingleRunner>;

    mockSequenceRunner = {
      run: jest.fn().mockResolvedValue(sampleAnswer),
    } as unknown as jest.Mocked<DeterministicSequenceRunner>;

    mockParallelRunner = {
      run: jest.fn().mockResolvedValue(sampleAnswer),
    } as unknown as jest.Mocked<DeterministicParallelRunner>;

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    mockToolProvider = {
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Cập nhật database thành công' }],
        isError: false,
      }),
    } as unknown as jest.Mocked<IToolProvider>;

    mockWorkflowRegistry = {
      get: jest.fn().mockReturnValue({
        id: 'wf-order-cancel',
        name: 'Hủy đơn hàng',
        systemPrompt: 'Prompt hủy đơn',
        tools: ['table_schema', 'execute_write_query'],
      }),
      list: jest.fn().mockReturnValue([]),
      has: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<IWorkflowRegistry>;

    engine = new DeterministicEngine(
      mockSingleRunner,
      mockSequenceRunner,
      mockParallelRunner,
      mockCancellation,
      mockToolProvider,
      undefined, // CheckpointService
      mockWorkflowRegistry,
    );
  });

  describe('canHandle', () => {
    it('chấp nhận khi có forcedMode là deterministic, pipeline, hoặc fanout', () => {
      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.DETERMINISTIC,
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.PIPELINE,
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.FANOUT,
        } as EngineRoutingContext),
      ).toBe(true);
    });

    it('chấp nhận khi có workflowId, metadata.graph, pipeline hoặc fanout', () => {
      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          workflowId: 'wf-order-cancel',
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          metadata: { graph: {} },
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          metadata: { pipeline: {} },
        } as EngineRoutingContext),
      ).toBe(true);

      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          metadata: { fanout: {} },
        } as EngineRoutingContext),
      ).toBe(true);
    });

    it('từ chối khi hội thoại mở tự do không có định nghĩa kịch bản', () => {
      expect(
        engine.canHandle({
          prompt: 'Xin chào, bạn là ai?',
          userId: 'u1',
        } as EngineRoutingContext),
      ).toBe(false);

      expect(
        engine.canHandle({
          prompt: 'test',
          userId: 'u1',
          forcedMode: EForcedExecutionMode.AUTONOMOUS,
        } as EngineRoutingContext),
      ).toBe(false);
    });
  });

  describe('execute - Phân luồng các Runner con', () => {
    it('1. Chạy 1-Step Fixed Workflow khi có data.workflowId', async () => {
      const context: EngineExecutionContext = {
        ...baseContext,
        data: { ...baseContext.data, workflowId: 'wf-order-cancel' },
      };

      const result = await engine.execute(context);

      expect(mockWorkflowRegistry.get).toHaveBeenCalledWith('wf-order-cancel');
      expect(mockSingleRunner.run).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Hoàn tất kịch bản định sẵn');
    });

    it('2. Chạy Sequence DAG khi có metadata.graph với kind=SEQUENCE', async () => {
      const graph: DeterministicGraphDefinition = {
        id: 'graph-seq',
        name: 'Đồ thị tuần tự',
        rootNode: {
          id: 'root-seq',
          name: 'Chuỗi 2 bước',
          kind: EDeterministicNodeType.SEQUENCE,
          steps: [
            { id: 's1', name: 'Bước 1', type: 'llm_call', promptTemplate: 'P1' },
            { id: 's2', name: 'Bước 2', type: 'llm_call', promptTemplate: 'P2' },
          ],
        },
      };

      const context: EngineExecutionContext = {
        ...baseContext,
        metadata: { graph },
      };

      await engine.execute(context);

      expect(mockSequenceRunner.run).toHaveBeenCalledWith(
        graph.rootNode.kind === EDeterministicNodeType.SEQUENCE ? graph.rootNode.steps : [],
        context,
        'graph-seq',
      );
    });

    it('3. Chạy Parallel Fan-out khi có metadata.graph với kind=PARALLEL', async () => {
      const graph: DeterministicGraphDefinition = {
        id: 'graph-par',
        name: 'Đồ thị song song',
        rootNode: {
          id: 'root-par',
          name: 'Cụm song song',
          kind: EDeterministicNodeType.PARALLEL,
          config: {
            id: 'par-cfg',
            name: 'Song song 2 workers',
            workers: [
              { id: 'w1', name: 'Worker 1', prompt: 'P1' },
              { id: 'w2', name: 'Worker 2', prompt: 'P2' },
            ],
          },
        },
      };

      const context: EngineExecutionContext = {
        ...baseContext,
        metadata: { graph },
      };

      await engine.execute(context);

      expect(mockParallelRunner.run).toHaveBeenCalledTimes(1);
    });

    it('4. Tương thích ngược: tự động map metadata.pipeline sang SequenceRunner', async () => {
      const context: EngineExecutionContext = {
        ...baseContext,
        metadata: {
          pipeline: {
            id: 'legacy-p',
            name: 'Pipeline cũ',
            steps: [{ id: 'step-1', name: 'S1', type: 'llm_call', promptTemplate: 'P' }],
          },
        },
      };

      await engine.execute(context);

      expect(mockSequenceRunner.run).toHaveBeenCalledTimes(1);
    });

    it('5. Tương thích ngược: tự động map metadata.fanout sang ParallelRunner', async () => {
      const context: EngineExecutionContext = {
        ...baseContext,
        metadata: {
          fanout: {
            id: 'legacy-f',
            name: 'Fanout cũ',
            workers: [{ id: 'w1', name: 'W1', prompt: 'P' }],
          },
        },
      };

      await engine.execute(context);

      expect(mockParallelRunner.run).toHaveBeenCalledTimes(1);
    });

    it('ném lỗi TurnCancelledError khi nhận tín hiệu dừng', async () => {
      mockCancellation.isCancelled.mockResolvedValueOnce(true);

      await expect(engine.execute(baseContext)).rejects.toThrow(TurnCancelledError);
    });
  });

  describe('resume - Khép kín Checkpoint Resume (HITL)', () => {
    it('khôi phục an toàn checkpoint loại CLARIFICATION', async () => {
      const checkpoint: CheckpointResponseDto = {
        id: 'chk-clarify-1',
        kind: ECheckpointKind.CLARIFICATION,
        userId: 'u1',
        channelId: 'c1',
        replyMessageId: 'reply-chk-1',
        originalPrompt: 'Hủy đơn hàng',
        selectedProvider: 'sql_server',
        history: [],
        workflowId: 'wf-order-cancel',
      } as unknown as CheckpointResponseDto;

      // Giả lập sau clarifiedPrompt, execute chạy và hoàn tất
      const result = await engine.resume(checkpoint);
      expect(result).toBeDefined();
    });

    it('thực thi tool đã duyệt và hoàn tất checkpoint loại APPROVAL', async () => {
      const checkpoint: CheckpointResponseDto = {
        id: 'chk-appr-1',
        kind: ECheckpointKind.APPROVAL,
        userId: 'u1',
        channelId: 'c1',
        replyMessageId: 'reply-chk-2',
        originalPrompt: 'Hủy đơn hàng 102',
        pendingTool: {
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: 'DELETE FROM orders WHERE id=102' },
        },
        toolCalls: [],
        roundsSoFar: [],
      } as unknown as CheckpointResponseDto;

      const result = await engine.resume(checkpoint);

      expect(mockToolProvider.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: 'DELETE FROM orders WHERE id=102' },
        }),
      );
      expect(result.content).toBe('Cập nhật database thành công');
    });
  });
});
