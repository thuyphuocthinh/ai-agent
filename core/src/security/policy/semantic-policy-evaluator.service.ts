import { Injectable, Logger } from '@nestjs/common';
import {
  EPolicyVerdict,
  EOrderStatus,
} from '../constants/security.constants';
import type {
  PolicyEvaluationContext,
  SemanticEvaluationResult,
  PolicyChunk,
  SemanticEvaluationOptions,
} from './policy-evaluation.types';
import { PolicyCorpusService } from './policy-corpus.service';
import { extractMonetaryAmount } from './policy-amount-extractor.util';
import { hasForbiddenKeyword } from './policy-text-matcher.util';

const POLICY_JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: [
        EPolicyVerdict.ALLOW,
        EPolicyVerdict.DENY,
        EPolicyVerdict.REQUIRE_APPROVAL,
        EPolicyVerdict.ESCALATE,
      ],
      description: 'Phán quyết tuân thủ chính sách',
    },
    reason: {
      type: 'string',
      description: 'Lý do chi tiết và giải thích kết luận thẩm định',
    },
    citedRuleId: {
      type: 'string',
      description: 'Mã điều khoản vi phạm hoặc căn cứ phán quyết (ví dụ: SEC-DEVOPS-001)',
    },
    citedRuleTitle: {
      type: 'string',
      description: 'Tiêu đề của điều khoản được trích dẫn',
    },
    suggestedAction: {
      type: 'string',
      description: 'Hành động hướng dẫn tiếp theo cho người dùng hoặc hệ thống',
    },
  },
  required: ['verdict', 'reason'],
};

const POLICY_JUDGE_SYSTEM_PROMPT = `Bạn là Chuyên gia Thẩm định Tuân thủ & An ninh Doanh nghiệp (Enterprise Policy & Security Judge).
Nhiệm vụ của bạn là thẩm tra một hành động Tool Call mà Agent dự định thực hiện đối chiếu với các điều khoản quy chế doanh nghiệp được cung cấp.

Quy tắc phán quyết bắt buộc:
1. '${EPolicyVerdict.ALLOW}': Hành động an toàn, tuân thủ hoàn toàn quy định và không vi phạm điều khoản nào.
2. '${EPolicyVerdict.DENY}': Hành động vi phạm chính sách cấm (ví dụ: xóa CSDL production, DROP table, tiết lộ bảng lương nhân viên, hủy đơn hàng đang giao). Bắt buộc chỉ định citedRuleId và citedRuleTitle.
3. '${EPolicyVerdict.REQUIRE_APPROVAL}': Hành động có rủi ro cao hoặc cần xác nhận của con người trước khi thực thi (ví dụ: sửa đổi dữ liệu hàng loạt, hoàn tiền trong hạn mức vừa phải).
4. '${EPolicyVerdict.ESCALATE}': Hành động vượt thẩm quyền của AI (ví dụ: hoàn tiền số tiền lớn vượt trần AI, khiếu nại nhân sự nhạy cảm), cần bàn giao cho nhân viên con người tiếp quản.

Hãy phản hồi theo JSON schema chuẩn xác.`;

/**
 * SemanticPolicyEvaluatorService:
 * Động cơ thẩm định chính sách ngữ nghĩa (LLM-as-a-Judge) kết hợp RAG.
 * Đối soát hành động của Agent với văn bản quy chế tự nhiên, loại bỏ hoàn toàn
 * các chuỗi rẽ nhánh if/else hardcode theo nghiệp vụ bán hàng.
 */
@Injectable()
export class SemanticPolicyEvaluatorService {
  private readonly logger = new Logger(SemanticPolicyEvaluatorService.name);

  constructor(private readonly policyCorpus: PolicyCorpusService) {}

  /**
   * Thẩm định ý định tự nhiên của người dùng ngay từ prompt đầu vào (Intent Policy Evaluation).
   * Dùng cho cửa ngõ ChatService hoặc Supervisor khi chưa có hoặc không cần lệnh gọi tool.
   */
  async evaluatePrompt(
    prompt: string,
    context: { userId?: string; provider?: string } = {},
    options: SemanticEvaluationOptions = {},
  ): Promise<SemanticEvaluationResult> {
    const relevant = await this.policyCorpus.findRelevantPolicies(prompt, {
      limit: 3,
      minScore: 0.15,
    });

    const relevantPolicies = relevant.map((r) => r.chunk);
    if (relevantPolicies.length === 0) {
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Ý định hợp lệ, không phát hiện điều khoản quy chế hạn chế thao tác này.',
      };
    }

    const evaluationContext: PolicyEvaluationContext = {
      userId: context.userId ?? 'anonymous',
      provider: context.provider ?? 'general',
      toolName: 'prompt_intent',
      args: {},
      userIntent: prompt,
    };

    if (options.strategy && options.model) {
      try {
        const userPrompt = this.buildJudgePrompt(evaluationContext, relevantPolicies);
        const judgment = await options.strategy.generateStructured<SemanticEvaluationResult>({
          model: options.model,
          systemInstruction: POLICY_JUDGE_SYSTEM_PROMPT,
          prompt: userPrompt,
          schema: POLICY_JUDGE_SCHEMA,
          signal: options.signal,
        });

        if (this.isValidVerdict(judgment.verdict)) {
          this.logger.log(
            `[LLM INTENT JUDGE] Prompt="${prompt.slice(0, 50)}..." Verdict=${judgment.verdict} Rule=${judgment.citedRuleId || 'N/A'}`,
          );
          return judgment;
        }
      } catch (err) {
        this.logger.warn(
          `LLM Intent Judge call thất bại, chuyển sang cơ chế phán quyết deterministic: ${(err as Error)?.message}`,
        );
      }
    }

    return this.evaluateDeterministicFallback(evaluationContext, relevantPolicies);
  }

  /**
   * Thẩm tra tính tuân thủ chính sách của một tool call đối chiếu với kho quy chế.
   */
  async evaluate(
    context: PolicyEvaluationContext,
    options: SemanticEvaluationOptions = {},
  ): Promise<SemanticEvaluationResult> {
    const query = this.buildSearchQuery(context);

    // 1. Truy xuất Top điều khoản liên quan nhất từ Policy Corpus
    let relevant = await this.policyCorpus.findRelevantPolicies(query, {
      domain: context.targetResource?.domain,
      limit: 3,
      minScore: 0.15,
    });

    if (relevant.length === 0 && context.targetResource?.domain) {
      relevant = await this.policyCorpus.findRelevantPolicies(query, {
        limit: 3,
        minScore: 0.15,
      });
    }

    const relevantPolicies = relevant.map((r) => r.chunk);

    // Nếu không có điều khoản nào liên quan đến hành động này -> Mặc định an toàn (ALLOW)
    if (relevantPolicies.length === 0) {
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Hành động hợp lệ, không phát hiện điều khoản quy chế hạn chế thao tác này.',
      };
    }

    // 2. Nếu có LLM Strategy được truyền vào: Gọi LLM-as-a-Judge thẩm định ngữ nghĩa
    if (options.strategy && options.model) {
      try {
        const userPrompt = this.buildJudgePrompt(context, relevantPolicies);
        const judgment = await options.strategy.generateStructured<SemanticEvaluationResult>(
          {
            model: options.model,
            systemInstruction: POLICY_JUDGE_SYSTEM_PROMPT,
            prompt: userPrompt,
            schema: POLICY_JUDGE_SCHEMA,
            signal: options.signal,
          },
        );

        if (this.isValidVerdict(judgment.verdict)) {
          this.logger.log(
            `[LLM JUDGE] Tool=${context.toolName} Verdict=${judgment.verdict} Rule=${judgment.citedRuleId || 'N/A'}`,
          );
          return {
            ...judgment,
            targetResource: context.targetResource,
          };
        }
      } catch (err) {
        this.logger.warn(
          `LLM Judge call thất bại, chuyển sang cơ chế phán quyết deterministic: ${(err as Error)?.message}`,
        );
      }
    }

    // 3. Fallback Deterministic Judge (bảo đảm tính tất định & an toàn khi chạy offline / dev)
    const fallbackResult = this.evaluateDeterministicFallback(
      context,
      relevantPolicies,
    );

    this.logger.log(
      `[DETERMINISTIC JUDGE] Tool=${context.toolName} Verdict=${fallbackResult.verdict} Rule=${fallbackResult.citedRuleId || 'N/A'}`,
    );

    return {
      ...fallbackResult,
      targetResource: context.targetResource,
    };
  }

  private buildSearchQuery(context: PolicyEvaluationContext): string {
    const parts: string[] = [];
    if (context.userIntent) {
      parts.push(context.userIntent);
    }
    parts.push(context.toolName.replace(/_/g, ' '));
    parts.push(context.provider.replace(/_/g, ' '));
    if (typeof context.args.query === 'string') {
      parts.push(context.args.query);
    }
    return parts.join(' ');
  }

  private buildJudgePrompt(
    context: PolicyEvaluationContext,
    policies: PolicyChunk[],
  ): string {
    const policyDocs = policies
      .map(
        (p) =>
          `[Điều khoản: ${p.id}] - ${p.title}\nNội dung: ${p.content}\nMức độ: ${p.severity || 'NORMAL'}`,
      )
      .join('\n\n');

    return `VĂN BẢN QUY CHẾ DOANH NGHIỆP LIÊN QUAN:
${policyDocs}

THÔNG TIN HÀNH ĐỘNG DỰ ĐỊNH THỰC THI:
- Người dùng (User ID): ${context.userId}
- Nhà cung cấp (Provider): ${context.provider}
- Tên công cụ (Tool Name): ${context.toolName}
- Tham số gọi (Arguments): ${JSON.stringify(context.args, null, 2)}
${context.userIntent ? `- Ý định của người dùng: ${context.userIntent}` : ''}
${context.targetResource ? `- Tài nguyên đích: ${context.targetResource.domain}/${context.targetResource.type}#${context.targetResource.id}` : ''}

Hãy đưa ra phán quyết tuân thủ chính sách (${EPolicyVerdict.ALLOW}, ${EPolicyVerdict.DENY}, ${EPolicyVerdict.REQUIRE_APPROVAL}, ${EPolicyVerdict.ESCALATE}) theo định dạng JSON.`;
  }

  private evaluateDeterministicFallback(
    context: PolicyEvaluationContext,
    relevantPolicies: PolicyChunk[],
  ): SemanticEvaluationResult {
    const topPolicy = relevantPolicies[0];
    const queryStr = `${context.toolName} ${JSON.stringify(context.args)} ${context.userIntent || ''}`;

    // 1. DevOps: DROP TABLE / TRUNCATE
    if (topPolicy.id === 'SEC-DEVOPS-001') {
      const forbidden = ['drop table', 'truncate', 'drop database'];
      if (hasForbiddenKeyword(queryStr, forbidden)) {
        return {
          verdict: EPolicyVerdict.DENY,
          reason: `Từ chối thực thi: Thao tác xóa hoặc hủy hoại CSDL bị nghiêm cấm theo quy chế bảo mật.`,
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Không cho phép chạy câu lệnh xóa bảng hoặc CSDL.',
        };
      }
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Hành động DDL/SQL an toàn, không chứa câu lệnh xóa cấu trúc hoặc dữ liệu CSDL.',
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    if (topPolicy.id === 'SEC-DEVOPS-002') {
      const devOpsKeywords = ['ingress', 'network', 'định tuyến', 'cấu hình', 'route', 'traffic', 'routing', 'schema', 'bản ghi'];
      if (hasForbiddenKeyword(queryStr, devOpsKeywords)) {
        return {
          verdict: EPolicyVerdict.REQUIRE_APPROVAL,
          reason: topPolicy.content,
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Yêu cầu quản trị viên hoặc người dùng xác nhận trước khi thay đổi cấu hình mạng/schema.',
        };
      }
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Hành động cấu hình thông thường trong giới hạn an toàn.',
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    // 2. HR: Bảng lương / thu nhập nhân viên
    if (topPolicy.id === 'SEC-HR-001') {
      const salaryKeywords = ['salary', 'compensation', 'payroll', 'bảng lương', 'lương'];
      if (hasForbiddenKeyword(queryStr, salaryKeywords)) {
        return {
          verdict: EPolicyVerdict.DENY,
          reason: `Từ chối thực thi: Bảng lương và thu nhập nhân viên là thông tin mật tuyệt đối.`,
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Không trích xuất hay chia sẻ thông tin thu nhập cá nhân.',
        };
      }
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Tra cứu thông tin nhân sự thông thường, không chứa dữ liệu lương hoặc thu nhập nhạy cảm.',
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    if (topPolicy.id === 'SEC-HR-002') {
      const grievanceKeywords = ['khiếu nại', 'tố cáo', 'tranh chấp', 'quấy rối', 'chèn ép', 'vi phạm nội bộ'];
      if (hasForbiddenKeyword(queryStr, grievanceKeywords)) {
        return {
          verdict: EPolicyVerdict.ESCALATE,
          reason: `Khiếu nại, tranh chấp lao động hoặc tố cáo vi phạm nội bộ cần bàn giao cho nhân sự con người (HR Officer).`,
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Bàn giao cho HR Officer và kích hoạt Human Takeover.',
        };
      }
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Nội dung trao đổi thông thường, không chứa khiếu nại hay tranh chấp nhân sự.',
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    // 3. Finance: Hạn mức hoàn tiền và phân quyền AI
    if (topPolicy.id === 'SEC-FIN-001' || topPolicy.domain === 'finance') {
      const amount = extractMonetaryAmount(context.args, context.userIntent);
      const maxAiLimit = Number(topPolicy.metadata?.maxAiAuthorityLimit ?? 2000000);
      const autoApprovalLimit = Number(
        topPolicy.metadata?.autoApprovalThreshold ?? 200000,
      );

      if (amount >= maxAiLimit) {
        return {
          verdict: EPolicyVerdict.ESCALATE,
          reason: `Số tiền hoàn ${amount.toLocaleString('vi-VN')} VNĐ vượt quá thẩm quyền của AI (${maxAiLimit.toLocaleString('vi-VN')} VNĐ).`,
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Tạo phiếu bàn giao nhân viên hỗ trợ (Human Escalation).',
        };
      }

      if (amount > autoApprovalLimit) {
        return {
          verdict: EPolicyVerdict.REQUIRE_APPROVAL,
          reason: `Yêu cầu hoàn tiền ${amount.toLocaleString('vi-VN')} VNĐ cần người dùng xác nhận thông tin trước khi thực thi.`,
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Yêu cầu người dùng xác nhận qua giao diện HITL.',
        };
      }

      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: `Số tiền hoàn ${amount.toLocaleString('vi-VN')} VNĐ trong hạn mức cho phép tự động xử lý.`,
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    // 4. Support: Hủy đơn hàng đang giao
    if (topPolicy.id === 'SEC-SUPPORT-001' || topPolicy.domain === 'support') {
      const status = String(context.args.status || '').toUpperCase();
      if (
        status === EOrderStatus.SHIPPING ||
        hasForbiddenKeyword(queryStr, ['shipping', 'vận chuyển'])
      ) {
        return {
          verdict: EPolicyVerdict.DENY,
          reason:
            'Từ chối thực thi: Đơn hàng đang trong trạng thái vận chuyển, không được phép hủy trực tiếp.',
          citedRuleId: topPolicy.id,
          citedRuleTitle: topPolicy.title,
          suggestedAction: 'Hướng dẫn khách hàng làm thủ tục hoàn trả sau khi nhận hàng.',
        };
      }
      return {
        verdict: EPolicyVerdict.ALLOW,
        reason: 'Yêu cầu hủy đơn hàng hợp lệ theo chính sách.',
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    // Generic ruleType mapping
    const ruleType = topPolicy.metadata?.ruleType as EPolicyVerdict | undefined;
    if (ruleType && this.isValidVerdict(ruleType)) {
      return {
        verdict: ruleType,
        reason: topPolicy.content,
        citedRuleId: topPolicy.id,
        citedRuleTitle: topPolicy.title,
      };
    }

    return {
      verdict: EPolicyVerdict.ALLOW,
      reason: 'Hành động tuân thủ chính sách doanh nghiệp.',
      citedRuleId: topPolicy.id,
      citedRuleTitle: topPolicy.title,
    };
  }

  private isValidVerdict(val: unknown): val is EPolicyVerdict {
    return (
      val === EPolicyVerdict.ALLOW ||
      val === EPolicyVerdict.DENY ||
      val === EPolicyVerdict.REQUIRE_APPROVAL ||
      val === EPolicyVerdict.ESCALATE
    );
  }
}
