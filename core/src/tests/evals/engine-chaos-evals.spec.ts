import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { SingleAgentEngine } from '../../engine/orchestrator/engines/single-agent.engine';
import { PipelineChainingEngine } from '../../engine/orchestrator/engines/pipeline-chaining.engine';
import { ReactLoopService } from '../../engine/loop/react-loop.service';
import { AgentCancellationService } from '../../engine/cancellation/agent-cancellation.service';
import { CheckpointPauseService } from '../../engine/hitl/checkpoint-pause.service';
import { MetricsRegistryService } from '../../infrastructure/resilience/metrics-registry.service';
import { ToolOutputCompressor } from '../../common/text/tool-output-compressor';
import { ClarificationRequiredError } from '../../contracts/engine/clarification-required.error';
import {
  EngineExecutionContext,
} from '../../contracts/engine/execution-engine.interface';
import {
  PipelineDefinition,
  EPipelineStepFailurePolicy,
} from '../../contracts/engine/pipeline-chaining.interface';
import { AnswerResult } from '../../contracts/engine/orchestration-answer.types';

interface ChaosDatasetTestCase {
  id: string;
  category: string;
  title: string;
  rawPayload?: Record<string, unknown>;
  expectedNormalizedRows?: Array<Record<string, unknown>>;
  malformedOutput?: string;
  healedOutput?: Record<string, unknown>;
  prompt?: string;
  matchedCandidates?: Array<{ id: string; label: string; description: string }>;
  initialError?: string;
  correctedQuery?: string;
}

interface ChaosDataset {
  description: string;
  version: string;
  testCases: ChaosDatasetTestCase[];
}

describe('Enterprise Chaos Evals & Resilience Suite', () => {
  let dataset: ChaosDataset;
  let mockReactLoop: jest.Mocked<ReactLoopService>;
  let mockCancellation: jest.Mocked<AgentCancellationService>;
  let mockCheckpointPause: jest.Mocked<CheckpointPauseService>;
  let mockMetrics: jest.Mocked<MetricsRegistryService>;

  let singleEngine: SingleAgentEngine;
  let pipelineEngine: PipelineChainingEngine;

  const baseContext: EngineExecutionContext = {
    data: {
      userId: 'enterprise-user-99',
      channelId: 'kintone-sync-channel',
      conversationId: 'conv-enterprise-01',
      messageId: 'msg-eval-01',
    },
    replyMessageId: 'reply-eval-01',
    prompt: 'Xử lý đồng bộ dữ liệu Kintone CRM sang Google Sheets',
    agents: [
      { id: 'kintone-agent', provider: 'kintone', name: 'Kintone CRM', description: '' },
      { id: 'sheets-agent', provider: 'google_sheets', name: 'Google Sheets', description: '' },
    ],
    history: [],
  };

  beforeAll(() => {
    const datasetPath = path.resolve(__dirname, 'datasets/enterprise-cross-system-mapping.dataset.json');
    const rawContent = fs.readFileSync(datasetPath, 'utf8');
    dataset = JSON.parse(rawContent);
  });

  beforeEach(() => {
    ToolOutputCompressor.clearCache();

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
      pauseForClarification: jest.fn().mockResolvedValue({
        content: 'Paused for clarification',
      } as AnswerResult),
    } as unknown as jest.Mocked<CheckpointPauseService>;

    mockMetrics = {
      incrementBehaviorSignal: jest.fn(),
    } as unknown as jest.Mocked<MetricsRegistryService>;

    singleEngine = new SingleAgentEngine(
      mockReactLoop,
      mockCancellation,
      mockCheckpointPause,
      mockMetrics,
    );

    pipelineEngine = new PipelineChainingEngine(
      mockReactLoop,
      mockCancellation,
      mockCheckpointPause,
      mockMetrics,
    );
  });

  describe('1. Single Agent Self-Correction Reflection Loop & Budget Capping', () => {
    it('cấu hình maxSelfCorrectionRetries = 2 và kích hoạt reflection khi tool thất bại', async () => {
      const sqlTestCase = dataset.testCases.find((tc) => tc.id === 'sql-syntax-tool-reflection')!;

      mockReactLoop.run.mockResolvedValueOnce({
        answer: `Đã tự động sửa câu lệnh SQL: ${sqlTestCase.correctedQuery}`,
        toolCalls: [
          { tool: 'sql_server.query', status: 'error', resultPreview: sqlTestCase.initialError },
          { tool: 'sql_server.query', status: 'success', resultPreview: 'Fetched 1 record' },
        ],
      });

      const result = await singleEngine.execute(baseContext);

      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      const callArgs = mockReactLoop.run.mock.calls[0][0];
      expect(callArgs.maxSelfCorrectionRetries).toBe(2);
      expect(result.content).toContain('Đã tự động sửa câu lệnh SQL');
      expect(result.toolCalls).toHaveLength(2);
    });

    it('tạm dừng an toàn và lưu Checkpoint Clarification khi phát hiện yêu cầu mơ hồ', async () => {
      const clarifyCase = dataset.testCases.find((tc) => tc.id === 'ambiguous-customer-disambiguation')!;

      mockReactLoop.run.mockRejectedValueOnce(
        new ClarificationRequiredError(
          'Tìm thấy 2 khách hàng tên Nguyễn Văn Nam. Bạn muốn chọn khách hàng nào?',
          clarifyCase.matchedCandidates!,
        ),
      );

      const result = await singleEngine.execute({
        ...baseContext,
        prompt: clarifyCase.prompt!,
      });

      expect(mockMetrics.incrementBehaviorSignal).toHaveBeenCalledWith('clarification_required');
      expect(mockCheckpointPause.pauseForClarification).toHaveBeenCalledTimes(1);
      const pauseCallArgs = mockCheckpointPause.pauseForClarification.mock.calls[0];
      expect(pauseCallArgs[5]).toContain('Tìm thấy 2 khách hàng');
      expect(pauseCallArgs[6]).toHaveLength(2);
      expect(result.content).toBe('Paused for clarification');
    });
  });

  describe('2. Tool Output Compression & Large Payload Token Protection', () => {
    it('bảo vệ Token Budget khi payload Kintone > 20k ký tự: bảo toàn JSON envelope và truy xuất raw qua dataRef', () => {
      // Đọc trực tiếp dataset thực tế 350 bản ghi Kintone CRM lồng nhau (> 600.000 ký tự) từ file JSON
      const bulkKintoneRecords = (dataset as { largeKintoneBulkPayload?: unknown[] }).largeKintoneBulkPayload!;
      expect(bulkKintoneRecords).toBeDefined();
      expect(bulkKintoneRecords.length).toBeGreaterThanOrEqual(300);

      const compressed = ToolOutputCompressor.compress(bulkKintoneRecords, {
        maxCharacters: 5000,
        sampleCount: 3,
      });

      expect(compressed.isTruncated).toBe(true);
      expect(compressed.dataRef).toBeDefined();
      expect(compressed.originalLength).toBeGreaterThan(500000); // Xác nhận dữ liệu gốc > 500.000 ký tự
      expect(compressed.text.length).toBeLessThanOrEqual(5000);

      // JSON Envelope phải parse được hoàn toàn, không bị syntax error
      const envelope = JSON.parse(compressed.text);
      expect(envelope._data_summary).toBeDefined();
      expect(envelope._data_summary.total_records).toBe(bulkKintoneRecords.length);
      expect(envelope._data_summary.dataRef).toBe(compressed.dataRef);
      expect(envelope.sample_records.length).toBeGreaterThanOrEqual(1);

      // Truy xuất lại dữ liệu gốc từ RAM Cache thông qua dataRef
      const rawRetrieved = ToolOutputCompressor.getRawPayload(compressed.dataRef!);
      expect(rawRetrieved).not.toBeNull();
      const parsedRaw = JSON.parse(rawRetrieved!);
      expect(parsedRaw).toHaveLength(bulkKintoneRecords.length);
      expect(parsedRaw[0].Record_Number.value).toBe('CRM-2026-OCT-0001');
    });
  });

  describe('3. Pipeline Chaining 1-Shot Schema Self-Healing & Dynamic Branching', () => {
    it('tự động chữa lành JSON đầu ra khi vi phạm Zod Schema (1-Shot Self-Healing)', async () => {
      const malformedCase = dataset.testCases.find((tc) => tc.id === 'malformed-schema-kintone')!;

      const NormalizedCrmSchema = z.object({
        recordId: z.string(),
        company: z.string(),
        totalRevenue: z.number(),
        taxRate: z.number(),
        isVerified: z.boolean(),
      });

      const healingPipeline: PipelineDefinition = {
        id: 'kintone-normalization-pipeline',
        name: 'Kintone Normalization Pipeline',
        steps: [
          {
            id: 'step_normalize',
            name: 'Chuẩn hóa định dạng số liệu',
            outputSchema: NormalizedCrmSchema,
          },
        ],
      };

      // Lần 1: LLM trả về JSON lỗi format (doanh thu dạng string kèm chữ VND)
      // Lần 2: LLM nhận correction prompt và trả về format số chuẩn
      mockReactLoop.run
        .mockResolvedValueOnce({
          answer: malformedCase.malformedOutput!,
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          answer: JSON.stringify(malformedCase.healedOutput),
          toolCalls: [],
        });

      const result = await pipelineEngine.executePipeline(healingPipeline, baseContext);

      // Kiểm tra có 2 lần gọi (1 lần chính + 1 lần self-healing prompt)
      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
      expect(mockReactLoop.run.mock.calls[1][0].prompt).toContain('Dữ liệu JSON bạn vừa tạo ra không đúng định dạng schema bắt buộc');

      const parsedOutput = JSON.parse(result.content);
      expect(parsedOutput.recordId).toBe('CRM-2026-ERR-01');
      expect(parsedOutput.totalRevenue).toBe(500000000); // Kiểu số chuẩn
      expect(parsedOutput.taxRate).toBe(0.1);
      expect(parsedOutput.isVerified).toBe(true);
    });

    it('rẽ nhánh điều kiện động (Conditional Branching) dựa trên phân hạng khách hàng Kintone', async () => {
      const branchingPipeline: PipelineDefinition = {
        id: 'crm-tier-dispatch-pipeline',
        name: 'CRM Tier Dispatch Pipeline',
        steps: [
          {
            id: 'step1_classify_tier',
            name: 'Đọc phân hạng Kintone',
            condition: (output) => (output.includes('VIP_PLATINUM') ? 'route_vip' : 'route_standard'),
            branchMap: {
              route_vip: 'step_vip_escalate',
              route_standard: 'step_standard_archive',
            },
          },
          {
            id: 'step_standard_archive',
            name: 'Lưu trữ thông thường vào Sheets',
          },
          {
            id: 'step_vip_escalate',
            name: 'Báo cáo VIP cho Ban Giám Đốc và tạo hợp đồng Docs',
          },
        ],
      };

      mockReactLoop.run
        .mockResolvedValueOnce({
          answer: 'Khách hàng: Tập đoàn Alpha Tech, Phân hạng: VIP_PLATINUM, Hợp đồng: 1.5 Tỷ VNĐ',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          answer: 'Đã tạo tài liệu Google Docs báo cáo VIP cho Ban Giám Đốc thành công.',
          toolCalls: [],
        });

      const result = await pipelineEngine.executePipeline(branchingPipeline, baseContext);

      // Nhảy cóc thẳng sang step_vip_escalate, bỏ qua step_standard_archive
      expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
      expect(result.steps).toHaveLength(2);
      expect(result.steps?.[0].agent).toBe('step1_classify_tier');
      expect(result.steps?.[1].agent).toBe('step_vip_escalate');
      expect(result.content).toContain('Đã tạo tài liệu Google Docs báo cáo VIP');
    });

    it('bảo vệ quy trình với Failure Policy SKIP_AND_CONTINUE và RETRY khi tool bị lỗi mạng', async () => {
      const resilientPipeline: PipelineDefinition = {
        id: 'resilient-pipeline',
        name: 'Resilient Pipeline',
        steps: [
          {
            id: 'step_optional_slack_alert',
            name: 'Gửi tin nhắn Slack',
            failurePolicy: EPipelineStepFailurePolicy.SKIP_AND_CONTINUE,
          },
          {
            id: 'step_main_sheets_append',
            name: 'Ghi dữ liệu vào Google Sheets',
            failurePolicy: EPipelineStepFailurePolicy.RETRY,
            maxStepRetries: 2,
          },
        ],
      };

      // Step 1: Lỗi timeout mạng -> bỏ qua
      // Step 2: Lần đầu 503 -> thử lại lần 2 thành công
      mockReactLoop.run
        .mockRejectedValueOnce(new Error('Slack webhook connection timed out'))
        .mockRejectedValueOnce(new Error('Google Sheets API 503 Service Unavailable'))
        .mockResolvedValueOnce({
          answer: 'Đã ghi thành công 100 dòng vào Google Sheets sau khi retry.',
          toolCalls: [],
        });

      const result = await pipelineEngine.executePipeline(resilientPipeline, baseContext);

      expect(mockReactLoop.run).toHaveBeenCalledTimes(3);
      expect(result.steps).toHaveLength(1);
      expect(result.steps?.[0].agent).toBe('step_main_sheets_append');
      expect(result.content).toContain('Đã ghi thành công 100 dòng vào Google Sheets');
    });
  });
});
