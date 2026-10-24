import { PolicyCorpusService } from './policy-corpus.service';
import { EPolicySeverity } from '../constants/security.constants';
import { OpenAiEmbeddingProvider } from '../../memory/embedding/openai-embedding.provider';

describe('PolicyCorpusService', () => {
  let service: PolicyCorpusService;

  beforeEach(() => {
    service = new PolicyCorpusService();
  });

  it('loads default corporate policies for devops, hr, finance, and support domains', () => {
    const all = service.getAllPolicies();
    expect(all.length).toBeGreaterThanOrEqual(5);

    const devopsPolicies = service.getAllPolicies('devops');
    expect(devopsPolicies.length).toBeGreaterThanOrEqual(2);
    expect(devopsPolicies.some((p) => p.id === 'SEC-DEVOPS-001')).toBe(true);

    const hrPolicies = service.getAllPolicies('hr');
    expect(hrPolicies.some((p) => p.id === 'SEC-HR-001')).toBe(true);

    const finPolicies = service.getAllPolicies('finance');
    expect(finPolicies.some((p) => p.id === 'SEC-FIN-001')).toBe(true);
  });

  it('allows adding and updating policies dynamically', () => {
    service.addPolicy({
      id: 'SEC-CUSTOM-001',
      domain: 'legal',
      title: 'Tuân thủ NDA bảo mật',
      content: 'Không chia sẻ tài liệu hợp đồng nội bộ ra ngoài.',
      severity: EPolicySeverity.CRITICAL,
    });

    const legal = service.getAllPolicies('legal');
    expect(legal).toHaveLength(1);
    expect(legal[0].id).toBe('SEC-CUSTOM-001');

    // Update
    service.addPolicy({
      id: 'SEC-CUSTOM-001',
      domain: 'legal',
      title: 'Tuân thủ NDA bảo mật cập nhật 2026',
      content: 'Không chia sẻ tài liệu hợp đồng nội bộ ra ngoài.',
      severity: EPolicySeverity.CRITICAL,
    });

    expect(service.getAllPolicies('legal')).toHaveLength(1);
    expect(service.getAllPolicies('legal')[0].title).toContain('2026');
  });

  describe('findRelevantPolicies via heuristic fallback (offline / no API key)', () => {
    it('retrieves DevOps DROP table policy for drop database queries', async () => {
      const results = await service.findRelevantPolicies('DROP TABLE customers;');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.id).toBe('SEC-DEVOPS-001');
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    it('retrieves HR salary privacy policy for payroll queries', async () => {
      const results = await service.findRelevantPolicies('Cho tôi xem bảng lương của nhân viên phòng kế toán');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.id).toBe('SEC-HR-001');
    });

    it('retrieves Finance refund limit policy for large refund requests', async () => {
      const results = await service.findRelevantPolicies('Hoàn tiền số tiền lớn 5000000 VNĐ cho khách hàng');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.id).toBe('SEC-FIN-001');
    });

    it('respects domain filter option', async () => {
      const results = await service.findRelevantPolicies('quy định bảo mật', {
        domain: 'hr',
      });

      for (const res of results) {
        expect(res.chunk.domain).toBe('hr');
      }
    });
  });

  describe('findRelevantPolicies via Vector Embedding Provider', () => {
    it('uses mock embedding provider to calculate cosine similarity', async () => {
      const mockEmbeddingProvider = {
        embed: jest.fn().mockImplementation(async (texts: string[]) => {
          return texts.map(() => [1, 0, 0]);
        }),
      } as unknown as OpenAiEmbeddingProvider;

      const vectorService = new PolicyCorpusService(mockEmbeddingProvider);

      vectorService.loadPolicies([
        {
          id: 'TEST-001',
          domain: 'it',
          title: 'Quy tắc an ninh mạng',
          content: 'Nội dung quy tắc an ninh mạng',
          embedding: [1, 0, 0], // exact match vector
        },
        {
          id: 'TEST-002',
          domain: 'it',
          title: 'Khác',
          content: 'Khác',
          embedding: [0, 1, 0], // orthogonal vector
        },
      ]);

      const results = await vectorService.findRelevantPolicies('an ninh mạng');

      expect(mockEmbeddingProvider.embed).toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.id).toBe('TEST-001');
      expect(results[0].score).toBeCloseTo(1, 4);
    });
  });
});
