import { PipelineChainingEngine } from './pipeline-chaining.engine';
import { ReactLoopService } from '../../loop/react-loop.service';
import { AgentCancellationService } from '../../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../../infrastructure/resilience/metrics-registry.service';
import { TurnCancelledError } from '../../loop/errors/turn-cancelled.error';
import { ApprovalRequiredError } from '../../loop/errors/approval-required.error';
import {
  EngineExecutionContext,
  EngineRoutingContext,
} from '../../../contracts/engine/execution-engine.interface';
import {
  PipelineDefinition,
  EPipelineStepType,
  EPipelineStepFailurePolicy,
} from '../../../contracts/engine/pipeline-chaining.interface';
import { AnswerResult } from '../../../contracts/engine/orchestration-answer.types';
import { z } from 'zod';

describe('PipelineChainingEngine', () => {
  let engine: PipelineChainingEngine;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockCheckpointPause: jest.Mocked<CheckpointPauseService>;
  let mockMetrics: jest.Mocked<MetricsRegistryService>;
  let mockToolProvider: { callTool: jest.Mock };

  beforeEach(() => {
    mockReactLoop = {
      run: jest.fn(),
    } as unknown as jest.Mocked<ReactLoopService>;

    mockCancellation = {
      isCancelled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AgentCancellationService>;

    mockCheckpointPause = {
      pauseForApproval: jest.fn().mockResolvedValue({
        content: 'Paused for approval',
      } as AnswerResult),
    } as unknown as jest.Mocked<CheckpointPauseService>;

    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    } as unknown as jest.Mocked<MetricsRegistryService>;

    mockToolProvider = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Tool executed successfully' }], isError: false }),
    };

    engine = new PipelineChainingEngine(
      mockReactLoop,
      mockCancellation,
      mockCheckpointPause,
      mockMetrics,
      mockToolProvider as any,
    );
  });

  describe('canHandle', () => {
    it('nhận diện khi forcedMode="pipeline"', () => {
      expect(
        engine.canHandle({ prompt: 'hello', userId: 'u1', forcedMode: 'pipeline' } as EngineRoutingContext),
      ).toBe(true);
    });

    it('tự động nhận diện prompt có từ khóa quy trình/pipeline cứng', () => {
      expect(
        engine.canHandle({ prompt: 'Lập báo cáo tuần theo các bước quy trình', userId: 'u1' } as EngineRoutingContext),
      ).toBe(true);
      expect(
        engine.canHandle({ prompt: 'Chạy pipeline onboarding nhân viên mới', userId: 'u1' } as EngineRoutingContext),
      ).toBe(true);
    });

    it('nhận diện khi workflowId trùng khớp với pipeline đã đăng ký', () => {
      expect(
        engine.canHandle({
          prompt: 'tác vụ thường',
          userId: 'u1',
          workflowId: 'default-two-step-pipeline',
        } as EngineRoutingContext),
      ).toBe(true);
    });

    it('từ chối khi forcedMode được chỉ định cho engine khác (ví dụ: single)', () => {
      expect(
        engine.canHandle({ prompt: 'chạy quy trình', userId: 'u1', forcedMode: 'single' } as EngineRoutingContext),
      ).toBe(false);
    });
  });

  describe('executePipeline', () => {
    const baseContext: EngineExecutionContext = {
      data: {
        userId: 'u1',
        channelId: 'c1',
        conversationId: 'conv-1',
        messageId: 'msg-p-1',
      },
      replyMessageId: 'reply-p-1',
      prompt: 'Dữ liệu doanh thu thô 100tr, chi phí 60tr',
      agents: [],
      history: [],
    };

    it('thực thi tuần tự 3 bước (Model rẻ -> Code transform -> Model xịn) và truyền data chính xác', async () => {
      const customPipeline: PipelineDefinition = {
        id: 'finance-report-pipeline',
        name: 'Finance Report Pipeline',
        steps: [
          {
            id: 'step1_extract',
            name: 'Trích xuất Dữ liệu',
            model: 'gemini-2.0-flash', // Model rẻ
            promptTemplate: 'Trích xuất từ: {{input}}',
          },
          {
            id: 'step2_compute',
            name: 'Tính toán Lợi nhuận',
            type: EPipelineStepType.CODE_TRANSFORM,
            transform: (prevOutput) => `${prevOutput} -> [Tính toán: Lợi nhuận = 40tr]`,
          },
          {
            id: 'step3_synthesize',
            name: 'Viết Báo cáo Ban Giám Đốc',
            model: 'claude-3-5-sonnet', // Model xịn
            promptTemplate: 'Viết báo cáo từ số liệu:\n{{input}}',
          },
        ],
      };

      // Giả lập kết quả từng step của reactLoop
      mockReactLoop.run
        .mockResolvedValueOnce({
          answer: 'Doanh thu: 100tr, Chi phí: 60tr',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          answer: 'BÁO CÁO TÀI CHÍNH: Doanh thu 100tr, Lợi nhuận 40tr (Tỷ suất 40%). Khuyến nghị: Duy trì.',
          toolCalls: [],
        });

      const result = await engine.executePipeline(customPipeline, baseContext);

      // 1. Kiểm tra số lần gọi reactLoop (Step 2 là code_transform nên chỉ có 2 lần gọi LLM)
      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);

      // 2. Kiểm tra Model Tiering ở từng step
      const firstCallArg = mockReactLoop.run.mock.calls[0][0];
      const secondCallArg = mockReactLoop.run.mock.calls[1][0];
      expect(firstCallArg.model).toBe('gemini-2.0-flash');
      expect(secondCallArg.model).toBe('claude-3-5-sonnet');

      // 3. Kiểm tra Output của Step 2 được bơm làm Input của Step 3
      expect(secondCallArg.prompt).toContain('[Tính toán: Lợi nhuận = 40tr]');

      // 4. Kiểm tra các bước được đóng gói trong AnswerResult
      expect(result.steps).toHaveLength(3);
      expect(result.steps?.[0].agent).toBe('step1_extract');
      expect(result.steps?.[1].agent).toBe('step2_compute');
      expect(result.steps?.[2].agent).toBe('step3_synthesize');
      expect(result.content).toContain('BÁO CÁO TÀI CHÍNH');
    });

    it('bắt và xử lý ApprovalRequiredError khi một tool trong step yêu cầu phê duyệt', async () => {
      const pipeline: PipelineDefinition = {
        id: 'p-tool-gate',
        name: 'Pipeline',
        steps: [
          {
            id: 'step1',
            name: 'Cập nhật database',
          },
        ],
      };

      mockReactLoop.run.mockRejectedValueOnce(
        new ApprovalRequiredError(
          { name: 'update_db', provider: 'sql' },
          'Cập nhật',
          [],
        ),
      );

      const result = await engine.executePipeline(pipeline, baseContext);

      expect(mockMetrics.incrementBehaviorSignal).toHaveBeenCalledWith('approval_required');
      expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Paused for approval');
    });

    it('thực thi tool và chạy tiếp các step còn lại khi resume()', async () => {
      const pipeline: PipelineDefinition = {
        id: 'p-resume',
        name: 'Pipeline Resume Test',
        steps: [
          { id: 'step1', name: 'Bước 1' },
          { id: 'step2', name: 'Bước 2' },
          { id: 'step3', name: 'Bước 3' },
        ],
      };
      engine.registerPipeline(pipeline);

      mockReactLoop.run.mockResolvedValueOnce({
        answer: 'Kết quả bước 3 hoàn tất',
        toolCalls: [],
      });

      const checkpoint: any = {
        id: 'cp-pipe-1',
        replyMessageId: 'reply-1',
        originalPrompt: 'Chạy pipeline p-resume',
        pendingTask: 'Thao tác trong p-resume',
        pendingTool: { provider: 'sql', name: 'update_db', args: { id: 1 } },
        roundsSoFar: [
          { agent: 'step1', task: 'Bước 1', result: 'Kết quả bước 1' },
        ],
        history: [],
        userId: 'u1',
        workspaceId: 'w1',
        channelId: 'c1',
      };

      const result = await engine.resume(checkpoint);

      expect(mockToolProvider.callTool).toHaveBeenCalledWith({
        provider: 'sql',
        name: 'update_db',
        args: { id: 1 },
        ownerId: 'u1',
        workspaceId: 'w1',
      });
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Kết quả bước 3 hoàn tất');
    });

    it('ném TurnCancelledError khi nhận tín hiệu hủy', async () => {
      mockCancellation.isCancelled.mockResolvedValue(true);

      const pipeline: PipelineDefinition = {
        id: 'p-cancel',
        name: 'Pipeline',
        steps: [{ id: 's1', name: 'Step 1' }],
      };

      await expect(engine.executePipeline(pipeline, baseContext)).rejects.toThrow(TurnCancelledError);
    });

    it('tự động kích hoạt 1-shot self-healing khi output step vi phạm zod schema', async () => {
      const CustomerSchema = z.object({
        customerId: z.string(),
        totalAmount: z.number(),
      });

      const pipeline: PipelineDefinition = {
        id: 'p-schema-heal',
        name: 'Schema Healing Pipeline',
        steps: [
          {
            id: 'step1_extract_json',
            name: 'Trích xuất JSON Khách hàng',
            outputSchema: CustomerSchema,
          },
        ],
      };

      // Lần 1: LLM trả về JSON lỗi (thiếu totalAmount hoặc sai kiểu dữ liệu)
      // Lần 2: LLM nhận correction prompt và trả về JSON đúng
      mockReactLoop.run
        .mockResolvedValueOnce({
          answer: '```json\n{"customerId": "CUST-001", "totalAmount": "one million"}\n```',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          answer: JSON.stringify({ customerId: 'CUST-001', totalAmount: 1000000 }),
          toolCalls: [],
        });

      const result = await engine.executePipeline(pipeline, baseContext);

      // Gọi lần 1 cho step bình thường, lần 2 cho 1-shot self-healing
      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
      expect(mockReactLoop.run.mock.calls[1][0].prompt).toContain('Dữ liệu JSON bạn vừa tạo ra không đúng định dạng schema bắt buộc');
      expect(result.content).toContain('1000000');
      const parsed = JSON.parse(result.content);
      expect(parsed.customerId).toBe('CUST-001');
      expect(parsed.totalAmount).toBe(1000000);
    });

    it('rẽ nhánh điều kiện thành công dựa trên output của step trước (conditional branching)', async () => {
      const pipeline: PipelineDefinition = {
        id: 'p-branching',
        name: 'Branching Pipeline',
        steps: [
          {
            id: 'step1_classify',
            name: 'Phân loại khách hàng',
            condition: (output) => (output.includes('VIP') ? 'vip_route' : 'standard_route'),
            branchMap: {
              vip_route: 'step_vip',
              standard_route: 'step_standard',
            },
          },
          {
            id: 'step_standard',
            name: 'Xử lý Standard',
          },
          {
            id: 'step_vip',
            name: 'Xử lý VIP Priority',
          },
        ],
      };

      mockReactLoop.run
        .mockResolvedValueOnce({
          answer: 'Khách hàng phân loại là VIP cấp Gold',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          answer: 'Ưu đãi VIP: Giảm giá 20% và tặng quà',
          toolCalls: [],
        });

      const result = await engine.executePipeline(pipeline, baseContext);

      // Chỉ thực thi step1_classify và step_vip (bỏ qua step_standard)
      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
      expect(result.steps).toHaveLength(2);
      expect(result.steps?.[0].agent).toBe('step1_classify');
      expect(result.steps?.[1].agent).toBe('step_vip');
      expect(result.content).toContain('Ưu đãi VIP');
    });

    it('bỏ qua step bị lỗi và tiếp tục các step sau khi failurePolicy = SKIP_AND_CONTINUE', async () => {
      const pipeline: PipelineDefinition = {
        id: 'p-skip-failure',
        name: 'Skip Failure Pipeline',
        steps: [
          {
            id: 'step1_flaky',
            name: 'Step không quan trọng bị lỗi',
            failurePolicy: EPipelineStepFailurePolicy.SKIP_AND_CONTINUE,
          },
          {
            id: 'step2_main',
            name: 'Step chính tiếp tục',
          },
        ],
      };

      mockReactLoop.run
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce({
          answer: 'Kết quả bước 2 thành công',
          toolCalls: [],
        });

      const result = await engine.executePipeline(pipeline, baseContext);

      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
      expect(result.steps).toHaveLength(1);
      expect(result.steps?.[0].agent).toBe('step2_main');
      expect(result.content).toBe('Kết quả bước 2 thành công');
    });

    it('tự động retry tối đa maxStepRetries khi failurePolicy = RETRY và step gặp lỗi', async () => {
      const pipeline: PipelineDefinition = {
        id: 'p-retry',
        name: 'Retry Pipeline',
        steps: [
          {
            id: 'step1_retryable',
            name: 'Step thử lại khi lỗi mạng',
            failurePolicy: EPipelineStepFailurePolicy.RETRY,
            maxStepRetries: 2,
          },
        ],
      };

      mockReactLoop.run
        .mockRejectedValueOnce(new Error('Transient 503 error'))
        .mockResolvedValueOnce({
          answer: 'Bước 1 thành công sau khi retry lần 1',
          toolCalls: [],
        });

      const result = await engine.executePipeline(pipeline, baseContext);

      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
      expect(result.steps).toHaveLength(1);
      expect(result.content).toContain('Bước 1 thành công sau khi retry lần 1');
    });
  });
});
