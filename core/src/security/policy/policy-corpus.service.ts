import { Injectable, Logger, Optional } from '@nestjs/common';
import { OpenAiEmbeddingProvider } from '../../memory/embedding/openai-embedding.provider';
import { cosineSimilarity } from '../../memory/skill-cosine-similarity.util';
import {
  EPolicySeverity,
  EPolicyVerdict,
  EOrderStatus,
} from '../constants/security.constants';
import type {
  PolicyChunk,
  PolicySearchOptions,
  ScoredPolicyChunk,
} from './policy-evaluation.types';
import { calculateTokenOverlapScore } from './policy-text-matcher.util';

export const DEFAULT_ENTERPRISE_POLICIES: Omit<PolicyChunk, 'embedding'>[] = [
  // DevOps & IT Infrastructure Security
  {
    id: 'SEC-DEVOPS-001',
    domain: 'devops',
    title: 'Cấm xóa hoặc hủy hoại CSDL production (DROP / TRUNCATE)',
    content:
      'Tuyệt đối cấm thực thi các câu lệnh DROP TABLE, DROP DATABASE, TRUNCATE TABLE trên bất kỳ môi trường production nào. Mọi thao tác xoá hoặc phá hủy cấu trúc dữ liệu đều bị từ chối ngay lập tức.',
    severity: EPolicySeverity.CRITICAL,
    metadata: {
      ruleType: EPolicyVerdict.DENY,
      forbiddenKeywords: ['DROP TABLE', 'TRUNCATE', 'DROP DATABASE'],
    },
  },
  {
    id: 'SEC-DEVOPS-002',
    domain: 'devops',
    title: 'Thay đổi cấu hình hạ tầng mạng Ingress hoặc sửa đổi schema CSDL diện rộng cần phê duyệt',
    content:
      'Mọi thao tác thay đổi cấu hình hạ tầng mạng, định tuyến Ingress diện rộng, hoặc câu lệnh cập nhật CSDL hàng loạt/sửa đổi schema đều có mức rủi ro cao và bắt buộc phải dừng lại yêu cầu người dùng hoặc quản trị viên phê duyệt trước khi áp dụng.',
    severity: EPolicySeverity.HIGH,
    metadata: {
      ruleType: EPolicyVerdict.REQUIRE_APPROVAL,
      forbiddenKeywords: ['config', 'ingress', 'network', 'schema', 'cấu hình', 'apply_ingress_route', 'định tuyến'],
    },
  },

  // Human Resources & Sensitive Data Privacy
  {
    id: 'SEC-HR-001',
    domain: 'hr',
    title: 'Bảo mật bảng lương và thông tin thu nhập nhân viên',
    content:
      'Bảng lương nhân viên, mức thu nhập cá nhân, phụ cấp và thỏa thuận thưởng là dữ liệu mật tuyệt đối. AI không được phép tiết lộ, đọc trích xuất hoặc gửi bảng lương ra ngoài trong bất kỳ trường hợp nào.',
    severity: EPolicySeverity.CRITICAL,
    metadata: {
      ruleType: EPolicyVerdict.DENY,
      forbiddenKeywords: ['salary', 'compensation', 'payroll', 'bảng lương', 'lương'],
    },
  },
  {
    id: 'SEC-HR-002',
    domain: 'hr',
    title: 'Bàn giao khiếu nại nhân sự và tố cáo cho con người',
    content:
      'Các khiếu nại liên quan đến tranh chấp lao động, tố cáo quấy rối hoặc sai phạm nội bộ phải được bàn giao ngay lập tức cho nhân sự con người (HR Officer) tiếp quản.',
    severity: EPolicySeverity.HIGH,
    metadata: {
      ruleType: EPolicyVerdict.ESCALATE,
      forbiddenKeywords: ['khiếu nại', 'tố cáo', 'tranh chấp'],
    },
  },

  // Finance & Customer Support Policies
  {
    id: 'SEC-FIN-001',
    domain: 'finance',
    title: 'Hạn mức hoàn tiền và phân cấp thẩm quyền AI',
    content:
      'Yêu cầu hoàn tiền từ 2.000.000 VNĐ trở lên vượt quá thẩm quyền của AI, bắt buộc phải tạo phiếu bàn giao (escalation ticket) cho nhân viên kế toán/quản lý giải quyết. Giao dịch từ 200.000 VNĐ đến dưới 2.000.000 VNĐ cần người dùng xác nhận thông tin.',
    severity: EPolicySeverity.HIGH,
    metadata: {
      ruleType: EPolicyVerdict.ESCALATE,
      forbiddenKeywords: ['hoàn tiền', 'refund', 'tiền', 'process_refund'],
      autoApprovalThreshold: 200000,
      maxAiAuthorityLimit: 2000000,
    },
  },
  {
    id: 'SEC-SUPPORT-001',
    domain: 'support',
    title: 'Từ chối hủy đơn hàng đang trong trạng thái vận chuyển',
    content:
      'Không được phép hủy các đơn hàng đang trong trạng thái vận chuyển (SHIPPING). AI cần từ chối và hướng dẫn khách hàng từ chối nhận hàng khi bưu tá giao tới.',
    severity: EPolicySeverity.MEDIUM,
    metadata: {
      ruleType: EPolicyVerdict.DENY,
      forbiddenKeywords: ['hủy đơn', 'cancel_order', 'cancel', 'shipping', 'vận chuyển'],
      forbiddenStatus: EOrderStatus.SHIPPING,
    },
  },
];

/**
 * PolicyCorpusService:
 * Kho tri thức quy chế doanh nghiệp đa lĩnh vực (DevOps, HR, Finance, Support, Legal).
 * Hỗ trợ tìm kiếm ngữ nghĩa (Semantic Vector Search) qua OpenAI Embedding Provider,
 * kèm cơ chế Fallback Heuristic Token Overlap qua pure utility khi chạy offline / dev mock.
 */
@Injectable()
export class PolicyCorpusService {
  private readonly logger = new Logger(PolicyCorpusService.name);
  private chunks: PolicyChunk[] = [];

  constructor(
    @Optional()
    private readonly embeddingProvider?: OpenAiEmbeddingProvider,
  ) {
    this.loadDefaultPolicies();
  }

  /**
   * Nạp tập chính sách doanh nghiệp mẫu đa lĩnh vực.
   */
  private loadDefaultPolicies(): void {
    this.chunks = DEFAULT_ENTERPRISE_POLICIES.map((p) => ({ ...p }));
    this.logger.log(
      `Đã khởi tạo Policy Corpus với ${this.chunks.length} điều khoản quy chế doanh nghiệp.`,
    );
  }

  /**
   * Thêm một điều khoản chính sách mới vào kho tri thức.
   */
  addPolicy(chunk: PolicyChunk): void {
    const existingIndex = this.chunks.findIndex((c) => c.id === chunk.id);
    if (existingIndex >= 0) {
      this.chunks[existingIndex] = chunk;
    } else {
      this.chunks.push(chunk);
    }
  }

  /**
   * Nạp danh sách các điều khoản chính sách thay thế hoặc bổ sung.
   */
  loadPolicies(chunks: PolicyChunk[], append = false): void {
    if (append) {
      for (const chunk of chunks) {
        this.addPolicy(chunk);
      }
    } else {
      this.chunks = [...chunks];
    }
  }

  /**
   * Lấy toàn bộ danh sách điều khoản chính sách trong kho.
   */
  getAllPolicies(domain?: string): PolicyChunk[] {
    if (!domain) return [...this.chunks];
    const normalizedDomain = domain.toLowerCase();
    return this.chunks.filter((c) => c.domain.toLowerCase() === normalizedDomain);
  }

  /**
   * Tìm kiếm các điều khoản quy chế liên quan nhất tới ý định/câu lệnh qua Vector Embedding
   * hoặc Heuristic Search.
   */
  async findRelevantPolicies(
    query: string,
    options: PolicySearchOptions = {},
  ): Promise<ScoredPolicyChunk[]> {
    const { domain, limit = 3, minScore = 0.15 } = options;
    const candidates = this.getAllPolicies(domain);
    if (candidates.length === 0) return [];

    // 1. Thử nghiệm tìm kiếm bằng Vector Embedding nếu có provider
    if (this.embeddingProvider) {
      try {
        const queryVectors = await this.embeddingProvider.embed([query]);
        const queryVec = queryVectors[0];

        // Đảm bảo tất cả candidate đều có embedding vector
        const missingEmbeddingChunks = candidates.filter(
          (c) => !c.embedding || c.embedding.length === 0,
        );

        if (missingEmbeddingChunks.length > 0) {
          const textsToEmbed = missingEmbeddingChunks.map(
            (c) => `${c.title}. ${c.content}`,
          );
          const chunkVectors = await this.embeddingProvider.embed(textsToEmbed);
          for (let i = 0; i < missingEmbeddingChunks.length; i++) {
            missingEmbeddingChunks[i].embedding = chunkVectors[i];
          }
        }

        const scored = candidates
          .map((chunk) => {
            const score = chunk.embedding
              ? cosineSimilarity(queryVec, chunk.embedding)
              : 0;
            return { chunk, score };
          })
          .filter((item) => item.score >= minScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (scored.length > 0) {
          return scored;
        }
      } catch (err) {
        this.logger.warn(
          `Embedding search thất bại, fallback sang heuristic token match: ${(err as Error)?.message}`,
        );
      }
    }

    // 2. Fallback: Heuristic Token Overlap & Keyword Matching qua Pure Util
    return this.heuristicSearch(query, candidates, limit, minScore);
  }

  private heuristicSearch(
    query: string,
    candidates: PolicyChunk[],
    limit: number,
    minScore: number,
  ): ScoredPolicyChunk[] {
    const scored: ScoredPolicyChunk[] = candidates.map((chunk) => {
      const forbiddenKeywords =
        (chunk.metadata?.forbiddenKeywords as string[]) || [];

      const score = calculateTokenOverlapScore(
        query,
        chunk.title,
        chunk.content,
        forbiddenKeywords,
      );

      return { chunk, score };
    });

    return scored
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
