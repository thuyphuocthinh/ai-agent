import { PipelineChainingEngine } from './pipeline-chaining.engine';
import { ReactLoopService } from '../loop/react-loop.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../common/metrics-registry.service';
import { TurnCancelledError } from '../loop/turn-cancelled.error';
import { ApprovalRequiredError } from '../loop/approval-required.error';
import {
  EngineExecutionContext,
  EngineRoutingContext,
} from '../../contracts/execution-engine.interface';
import {
  PipelineDefinition,
  EPipelineStepType,
} from '../../contracts/pipeline-chaining.interface';
import { AnswerResult } from './orchestration-answer.types';

describe('PipelineChainingEngine', () => {
  let engine: PipelineChainingEngine;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockCheckpointPause: jest.Mocked<CheckpointPauseService>;
  let mockMetrics: jest.Mocked<MetricsRegistryService>;

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

    engine = new PipelineChainingEngine(
      mockReactLoop,
      mockCancellation,
      mockCheckpointPause,
      mockMetrics,
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

    it('dừng lại chờ duyệt HITL khi một step được cấu hình requireHumanApproval=true', async () => {
      const pipelineWithGate: PipelineDefinition = {
        id: 'p-with-gate',
        name: 'Pipeline có cổng duyệt',
        steps: [
          {
            id: 'step1',
            name: 'Đọc dữ liệu',
          },
          {
            id: 'step2_dangerous',
            name: 'Gửi email hàng loạt',
            requireHumanApproval: true,
          },
        ],
      };

      mockReactLoop.run.mockResolvedValueOnce({
        answer: 'Đã sẵn sàng danh sách email gửi',
        toolCalls: [],
      });

      const result = await engine.executePipeline(pipelineWithGate, baseContext);

      // Phải dừng trước khi chạy step 2
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      expect(mockMetrics.incrementBehaviorSignal).toHaveBeenCalledWith('approval_required');
      expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Paused for approval');
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

    it('ném TurnCancelledError khi nhận tín hiệu hủy', async () => {
      mockCancellation.isCancelled.mockResolvedValue(true);

      const pipeline: PipelineDefinition = {
        id: 'p-cancel',
        name: 'Pipeline',
        steps: [{ id: 's1', name: 'Step 1' }],
      };

      await expect(engine.executePipeline(pipeline, baseContext)).rejects.toThrow(TurnCancelledError);
    });
  });
});
