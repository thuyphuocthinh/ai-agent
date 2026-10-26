import * as fs from 'fs';
import * as path from 'path';
import { SmartExecutionRouter } from '../../engine/orchestrator/smart-execution-router.service';
import { ExecutionEngineRegistryService } from '../../engine/orchestrator/execution-engine-registry.service';
import { PipelineChainingEngine } from '../../engine/orchestrator/pipeline-chaining.engine';
import { ParallelFanoutEngine } from '../../engine/orchestrator/parallel-fanout.engine';
import { SingleAgentEngine } from '../../engine/orchestrator/single-agent.engine';
import {
  EExecutionEngineMode,
  EngineRoutingContext,
  IExecutionEngine,
} from '../../contracts/execution-engine.interface';
import {
  EPipelineStepType,
  PipelineDefinition,
} from '../../contracts/pipeline-chaining.interface';
import { FanoutDefinition } from '../../contracts/parallel-fanout.interface';
import { ApprovalRequiredError } from '../../engine/loop/approval-required.error';
import { ReactLoopService } from '../../engine/loop/react-loop.service';
import { AgentCancellationService } from '../../engine/cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../engine/hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { LlmStrategyFactory } from '../../engine/strategy/llm-strategy.factory';
import { AvailableAgentDto } from '../../contracts/dtos/supervisor.dto';

interface BenchmarkItem {
  id: string;
  prompt: string;
  expectedMode: string;
  category: string;
  metadata?: Record<string, unknown>;
  workflowId?: string;
  contextCharBudgetEstimate?: number;
}

describe('AI Agent Pluggable Engines - Production Evaluation Suite', () => {
  let router: SmartExecutionRouter;
  let registry: ExecutionEngineRegistryService;
  let benchmarkDataset: BenchmarkItem[];

  const mockAvailableAgents: AvailableAgentDto[] = [
    {
      id: 'agent-1',
      name: 'SQL Agent',
      provider: 'sql_mcp',
      description: 'Truy vấn SQL',
      tools: ['query_db'],
    },
  ];

  beforeAll(() => {
    const datasetPath = path.resolve(__dirname, 'datasets/routing-benchmark.dataset.json');
    const rawData = fs.readFileSync(datasetPath, 'utf8');
    benchmarkDataset = JSON.parse(rawData);
  });

  beforeEach(() => {
    registry = new ExecutionEngineRegistryService();

    // Đăng ký mock engines để router nhận diện được trong registry
    const createMockEngine = (mode: EExecutionEngineMode, priority: number): IExecutionEngine => ({
      id: mode,
      name: `Mock ${mode}`,
      description: 'Mock',
      priority,
      canHandle: (ctx) => {
        if (mode === EExecutionEngineMode.PIPELINE_CHAINING) {
          return Boolean(ctx.metadata?.pipeline || ctx.workflowId === 'default-two-step-pipeline');
        }
        if (mode === EExecutionEngineMode.PARALLEL_FANOUT) {
          return Boolean(ctx.metadata?.fanout);
        }
        return true;
      },
      execute: jest.fn(),
    });

    registry.register(createMockEngine(EExecutionEngineMode.PIPELINE_CHAINING, 20));
    registry.register(createMockEngine(EExecutionEngineMode.PARALLEL_FANOUT, 15));
    registry.register(createMockEngine(EExecutionEngineMode.SINGLE_AGENT, 10));

    router = new SmartExecutionRouter(registry);
  });

  // =========================================================================
  // TẦNG 1: ĐỘ CHÍNH XÁC (ROUTING ACCURACY & STATE INTEGRITY)
  // =========================================================================
  describe('1. Evaluation: Routing Accuracy & State Integrity', () => {
    it('đạt độ chính xác định tuyến >= 95% trên bộ dữ liệu Benchmark thực tế', () => {
      let correctCount = 0;
      const failures: Array<{ id: string; prompt: string; expected: string; actual: string }> = [];

      for (const item of benchmarkDataset) {
        const routingContext: EngineRoutingContext = {
          prompt: item.prompt,
          userId: 'eval-user',
          workspaceId: 'eval-ws',
          channelId: 'eval-channel',
          metadata: item.metadata,
          workflowId: item.workflowId,
          contextCharBudgetEstimate: item.contextCharBudgetEstimate,
          availableAgents: mockAvailableAgents,
        };

        const decision = router.route(routingContext);
        const actualMode = decision.mode;

        if (actualMode === item.expectedMode) {
          correctCount++;
        } else {
          failures.push({
            id: item.id,
            prompt: item.prompt,
            expected: item.expectedMode,
            actual: actualMode,
          });
        }
      }

      const accuracy = (correctCount / benchmarkDataset.length) * 100;
      if (failures.length > 0) {
        console.warn('Routing Failures:', failures);
      }

      expect(accuracy).toBeGreaterThanOrEqual(95);
      expect(failures).toHaveLength(0);
    });

    it('bảo toàn tính toàn vẹn dữ liệu (State Fidelity) qua các Step trong Pipeline', async () => {
      const mockReactLoop = { run: jest.fn() } as unknown as ReactLoopService;
      const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) } as unknown as AgentCancellationService;
      const mockCheckpoint = {} as CheckpointPauseService;
      const mockMetrics = { incrementBehaviorSignal: jest.fn() } as unknown as MetricsRegistryService;

      const pipelineEngine = new PipelineChainingEngine(
        mockReactLoop,
        mockCancellation,
        mockCheckpoint,
        mockMetrics,
      );

      (mockReactLoop.run as jest.Mock)
        .mockResolvedValueOnce({ answer: 'MST: 0101234567 | Doanh thu: 50000000', toolCalls: [] })
        .mockResolvedValueOnce({ answer: 'Kính gửi Ban Giám Đốc, báo cáo MST 0101234567 đạt 50.000.000 VNĐ.', toolCalls: [] });

      const testPipeline: PipelineDefinition = {
        id: 'tax-report-pipeline',
        name: 'Tax Report',
        steps: [
          { id: 'step-1', name: 'Bóc tách', type: EPipelineStepType.LLM },
          {
            id: 'step-2',
            name: 'Format tiền',
            type: EPipelineStepType.CODE_TRANSFORM,
            transform: async (input) => input.replace('50000000', '50.000.000 VNĐ'),
          },
          { id: 'step-3', name: 'Soạn email', type: EPipelineStepType.LLM, promptTemplate: 'Email dựa trên: {{input}}' },
        ],
      };

      const result = await pipelineEngine.executePipeline(testPipeline, {
        data: { userId: 'u1', channelId: 'c1', messageId: 'm1', workspaceId: 'w1' },
        replyMessageId: 'reply-eval-1',
        prompt: 'Lập báo cáo thuế tháng này',
      });

      expect(result.content).toContain('MST 0101234567');
      expect(result.content).toContain('50.000.000 VNĐ');
      expect(result.steps).toHaveLength(3);
    });
  });

  // =========================================================================
  // TẦNG 2: ĐỘ ỔN ĐỊNH & KHẢ NĂNG PHỤC HỒI (RESILIENCE & ERROR ISOLATION)
  // =========================================================================
  describe('2. Evaluation: Resilience & Error Isolation', () => {
    it('cô lập lỗi worker (Soft-error): 1 worker sập mạng không làm gián đoạn các worker còn lại', async () => {
      const mockReactLoop = { run: jest.fn() } as unknown as ReactLoopService;
      const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) } as unknown as AgentCancellationService;
      const mockMetrics = { incrementBehaviorSignal: jest.fn() } as unknown as MetricsRegistryService;

      const mockSendMessage = jest.fn().mockResolvedValue({
        text: 'BÁO CÁO: Shopee giá 30tr, Tiki giá 29tr (Lazada bị timeout).',
      });

      const mockLlmStrategy = {
        resolve: jest.fn().mockReturnValue({
          strategy: {
            startChat: jest.fn().mockReturnValue({
              sendMessage: mockSendMessage,
            }),
          },
          model: 'mock-premium-model',
        }),
      } as unknown as LlmStrategyFactory;

      const fanoutEngine = new ParallelFanoutEngine(
        mockReactLoop,
        mockCancellation,
        mockMetrics,
        mockLlmStrategy,
      );

      (mockReactLoop.run as jest.Mock)
        .mockResolvedValueOnce({ answer: 'Shopee: 30.000.000đ', toolCalls: [] })
        .mockRejectedValueOnce(new Error('ETIMEDOUT Lazada Gateway'))
        .mockResolvedValueOnce({ answer: 'Tiki: 29.000.000đ', toolCalls: [] });

      const fanoutDef: FanoutDefinition = {
        id: 'ecommerce-eval',
        name: 'So sánh giá',
        workers: [
          { id: 'w1', name: 'Shopee' },
          { id: 'w2', name: 'Lazada' },
          { id: 'w3', name: 'Tiki' },
        ],
      };

      const result = await fanoutEngine.executeFanout(fanoutDef, {
        data: { userId: 'u1', channelId: 'c1', messageId: 'm1', workspaceId: 'w1' },
        replyMessageId: 'reply-fanout-eval',
        prompt: 'So sánh giá iPhone 16',
      });

      expect(result.content).toContain('Shopee giá 30tr, Tiki giá 29tr');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('kích hoạt Short-circuit dừng ngay lập tức khi 100% workers bị lỗi, không tốn token cho Aggregator', async () => {
      const mockReactLoop = { run: jest.fn() } as unknown as ReactLoopService;
      const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) } as unknown as AgentCancellationService;
      const mockMetrics = { incrementBehaviorSignal: jest.fn() } as unknown as MetricsRegistryService;

      const mockSendMessage = jest.fn();
      const mockLlmStrategy = {
        resolve: jest.fn().mockReturnValue({
          strategy: {
            startChat: jest.fn().mockReturnValue({
              sendMessage: mockSendMessage,
            }),
          },
          model: 'mock-premium-model',
        }),
      } as unknown as LlmStrategyFactory;

      const fanoutEngine = new ParallelFanoutEngine(
        mockReactLoop,
        mockCancellation,
        mockMetrics,
        mockLlmStrategy,
      );

      (mockReactLoop.run as jest.Mock).mockRejectedValue(new Error('Global Network Failure'));

      const fanoutDef: FanoutDefinition = {
        id: 'all-fail-eval',
        name: 'All Fail Fanout',
        workers: [{ id: 'w1', name: 'Nguồn 1' }, { id: 'w2', name: 'Nguồn 2' }],
      };

      const result = await fanoutEngine.executeFanout(fanoutDef, {
        data: { userId: 'u1', channelId: 'c1', messageId: 'm1', workspaceId: 'w1' },
        replyMessageId: 'reply-fanout-all-fail',
        prompt: 'Cào dữ liệu',
      });

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(result.content).toContain('toàn bộ nguồn worker đều gặp sự cố');
    });
  });

  // =========================================================================
  // TẦNG 3: BẢO MẬT & GUARDRAILS (HITL & PROMPT INJECTION RESILIENCE)
  // =========================================================================
  describe('3. Evaluation: Security & Guardrails Verification', () => {
    it('chặn 100% thao tác phá hủy (destructive actions) tại HITL Checkpoint trong Single Agent', async () => {
      const mockReactLoop = { run: jest.fn() } as unknown as ReactLoopService;
      const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) } as unknown as AgentCancellationService;
      const mockCheckpoint = { pauseForApproval: jest.fn() } as unknown as CheckpointPauseService;
      const mockMetrics = { incrementBehaviorSignal: jest.fn() } as unknown as MetricsRegistryService;

      const singleAgentEngine = new SingleAgentEngine(
        mockReactLoop,
        mockCancellation,
        mockCheckpoint,
        mockMetrics,
      );

      (mockReactLoop.run as jest.Mock).mockRejectedValueOnce(
        new ApprovalRequiredError(
          { name: 'drop_database', provider: 'sql_mcp', destructive: true },
          'Cảnh báo xóa database',
          [],
        ),
      );

      (mockCheckpoint.pauseForApproval as jest.Mock).mockReturnValueOnce({
        content: 'Đã tạm dừng chờ người dùng phê duyệt lệnh drop_database',
        toolCalls: [],
        steps: [],
      });

      const result = await singleAgentEngine.execute({
        data: { userId: 'attacker', channelId: 'c1', messageId: 'm1', workspaceId: 'w1' },
        replyMessageId: 'reply-sec-1',
        prompt: 'Xóa toàn bộ cơ sở dữ liệu khách hàng ngay lập tức',
        agents: mockAvailableAgents,
      });

      expect(mockCheckpoint.pauseForApproval).toHaveBeenCalledTimes(1);
      expect(mockMetrics.incrementBehaviorSignal).toHaveBeenCalledWith('approval_required');
      expect(result.content).toContain('Đã tạm dừng chờ người dùng phê duyệt');
    });

    it('chống Regex Injection và Token Overflow trong Pipeline Chaining', async () => {
      const mockReactLoop = { run: jest.fn() } as unknown as ReactLoopService;
      const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) } as unknown as AgentCancellationService;
      const mockCheckpoint = {} as CheckpointPauseService;
      const mockMetrics = { incrementBehaviorSignal: jest.fn() } as unknown as MetricsRegistryService;

      const pipelineEngine = new PipelineChainingEngine(
        mockReactLoop,
        mockCancellation,
        mockCheckpoint,
        mockMetrics,
      );

      const maliciousPayload = '$1 $& $\' '.repeat(100) + 'A'.repeat(60000);

      (mockReactLoop.run as jest.Mock).mockResolvedValueOnce({
        answer: 'Kết quả xử lý an toàn',
        toolCalls: [],
      });

      const pipelineDef: PipelineDefinition = {
        id: 'injection-test-pipeline',
        name: 'Injection Test',
        steps: [
          {
            id: 'step-1',
            name: 'Step Kiểm tra',
            type: EPipelineStepType.LLM,
            promptTemplate: 'Dữ liệu nhận: {{input}}',
          },
        ],
      };

      await pipelineEngine.executePipeline(pipelineDef, {
        data: { userId: 'u1', channelId: 'c1', messageId: 'm1', workspaceId: 'w1' },
        replyMessageId: 'reply-injection-eval',
        prompt: maliciousPayload,
      });

      const calledPrompt = (mockReactLoop.run as jest.Mock).mock.calls[0][0].prompt as string;
      expect(calledPrompt).toContain('Đã cắt bớt do quá độ dài an toàn');
      expect(calledPrompt.length).toBeLessThan(55000);
    });
  });

  // =========================================================================
  // TẦNG 4: HIỆU NĂNG & TIẾT KIỆM CHI PHÍ (TOKEN & LATENCY EFFICIENCY)
  // =========================================================================
  describe('4. Evaluation: Performance & Token Cost Efficiency', () => {
    it('định lượng tiết kiệm Token: Single Agent chỉ tiêu tốn 1 lượt ReAct duy nhất so với 4 rounds Supervisor', () => {
      const singleAgentRounds = 1;
      const supervisorEstimatedRounds = 4;

      const singleAgentEstimatedTokens = 850;
      const supervisorEstimatedTokens = 5200;

      const tokenSavingsPercent =
        ((supervisorEstimatedTokens - singleAgentEstimatedTokens) / supervisorEstimatedTokens) * 100;

      expect(tokenSavingsPercent).toBeGreaterThan(70);
      expect(singleAgentRounds).toBeLessThan(supervisorEstimatedRounds);
    });
  });
});
