import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AgentWorkflowConfig,
  IWorkflowRegistry,
  WorkflowSummaryDto,
  createWorkflow,
} from '../../../contracts';
import { PrismaService } from '../prisma.service';
import { sanitizePrismaError } from '../../../common/errors';
import { Prisma } from '@prisma/client';

/**
 * PrismaWorkflowStore
 * Cung cấp kho lưu trữ cấu hình Workflow động trên PostgreSQL thông qua Prisma.
 * Nạp sẵn và đồng bộ danh mục bot doanh nghiệp từ CSDL kết hợp bộ nhớ RAM đệm (Cache)
 * để đảm bảo tốc độ phản hồi tính bằng micro giây.
 */
@Injectable()
export class PrismaWorkflowStore implements IWorkflowRegistry, OnModuleInit {
  private readonly logger = new Logger(PrismaWorkflowStore.name);
  private readonly cache = new Map<string, AgentWorkflowConfig>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedAndSyncWorkflows();
  }

  /**
   * Đăng ký hoặc cập nhật một cấu hình Agent Workflow vào CSDL và cập nhật cache.
   */
  register(workflow: AgentWorkflowConfig): void {
    const frozen = createWorkflow(workflow);
    this.cache.set(frozen.id, frozen);

    // Bất đồng bộ lưu vào PostgreSQL trong nền
    this.persistWorkflow(frozen).catch((err) => {
      this.logger.error(
        `Không thể lưu workflow "${frozen.id}" vào CSDL: ${(err as Error).message}`,
      );
    });
  }

  private async persistWorkflow(wf: AgentWorkflowConfig): Promise<void> {
    try {
      await this.prisma.workflow.upsert({
        where: { slug: wf.id },
        update: {
          name: wf.name,
          description: wf.description ?? null,
          systemPrompt: wf.systemPrompt,
          model: wf.model ?? 'gpt-4o-mini',
          tools: wf.tools ? [...wf.tools] : [],
          requireApprovalFor: wf.requireHumanApprovalFor ? [...wf.requireHumanApprovalFor] : [],
          maxLoops: wf.maxLoops ?? 5,
          isActive: true,
          metadata: {
            provider: wf.provider,
            securityScopes: wf.securityScopes,
          } as Prisma.InputJsonObject,
        },
        create: {
          slug: wf.id,
          name: wf.name,
          description: wf.description ?? null,
          systemPrompt: wf.systemPrompt,
          model: wf.model ?? 'gpt-4o-mini',
          tools: wf.tools ? [...wf.tools] : [],
          requireApprovalFor: wf.requireHumanApprovalFor ? [...wf.requireHumanApprovalFor] : [],
          maxLoops: wf.maxLoops ?? 5,
          isActive: true,
          metadata: {
            provider: wf.provider,
            securityScopes: wf.securityScopes,
          } as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      throw sanitizePrismaError(error, 'PrismaWorkflowStore.persistWorkflow');
    }
  }

  get(id: string): AgentWorkflowConfig | undefined {
    return this.cache.get(id);
  }

  list(): WorkflowSummaryDto[] {
    const unique = new Map<string, AgentWorkflowConfig>();
    for (const wf of this.cache.values()) {
      unique.set(wf.id, wf);
    }
    return Array.from(unique.values()).map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      tools: wf.tools ? [...wf.tools] : [],
    }));
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  /**
   * Nạp danh mục bot mặc định và đồng bộ với CSDL.
   */
  private async seedAndSyncWorkflows(): Promise<void> {
    const builtInWorkflows: AgentWorkflowConfig[] = [
      {
        id: 'customer-support',
        name: 'Customer Support Bot',
        description:
          'Hỗ trợ khách hàng giải đáp thắc mắc, tra cứu và gửi email thông báo qua Gmail.',
        systemPrompt:
          'Bạn là chuyên viên chăm sóc khách hàng chuyên nghiệp, lịch sự và ân cần. Hãy giải đáp thắc mắc của khách hàng rõ ràng. Khi cần kiểm tra hòm thư hoặc soạn thư phản hồi, hãy sử dụng các công cụ email có sẵn (search_emails, read_email, create_draft, send_email). Chỉ tập trung vào nghiệp vụ chăm sóc khách hàng; nếu người dùng hỏi những câu ngoài phạm vi hoặc vi phạm quy chế bảo mật, hãy lịch sự từ chối.',
        tools: ['search_emails', 'read_email', 'create_draft', 'send_email'],
        provider: 'google_mail',
        requireHumanApprovalFor: ['send_email'],
        maxLoops: 4,
      },
      {
        id: 'hotel-booking',
        name: 'Hotel Booking Assistant',
        description:
          'Trợ lý chuyên hỗ trợ tra cứu phòng trống, thông tin giá và các gói đặt phòng qua cơ sở dữ liệu SQL.',
        systemPrompt:
          'Bạn là trợ lý đặt phòng khách sạn thông minh của Luxury Hotel. Hãy hỏi khách: ngày nhận phòng, ngày trả phòng, số lượng khách và loại phòng mong muốn. Sử dụng table_schema và read_query để kiểm tra phòng trống và bảng giá. Chỉ tập trung vào nghiệp vụ đặt phòng khách sạn; nếu người dùng hỏi các chủ đề ngoài phạm vi hoặc cố tình yêu cầu thao tác phá hoại, hãy lịch sự từ chối.',
        tools: ['table_schema', 'read_query'],
        provider: 'sql_server',
        maxLoops: 5,
      },
      {
        id: 'it-helpdesk',
        name: 'IT Helpdesk Agent',
        description:
          'Hỗ trợ tiếp nhận sự cố kỹ thuật, tra cứu và mở issue/ticket báo lỗi trên GitHub.',
        systemPrompt:
          'Bạn là chuyên viên IT Helpdesk chuyên trách hỗ trợ kỹ thuật và báo lỗi phần mềm. Sử dụng các công cụ GitHub (list_issues, get_issue, create_issue) để tra cứu lỗi và tạo ticket mới. Chỉ tập trung vào các vấn đề kỹ thuật và quản lý sự cố; đối với các yêu cầu ngoài phạm vi hoặc vi phạm an ninh, hãy lịch sự từ chối.',
        tools: ['list_issues', 'get_issue', 'create_issue'],
        provider: 'github',
        requireHumanApprovalFor: ['create_issue'],
        maxLoops: 4,
      },
      {
        id: 'inventory-manager',
        name: 'Inventory & Sales Reporter',
        description:
          'Hỗ trợ tra cứu bảng giá, tồn kho và ghi nhận đơn hàng vào Google Sheets.',
        systemPrompt:
          'Bạn là trợ lý quản lý kho và bán hàng. Sử dụng các công cụ Google Sheets (list_spreadsheets, read_range, append_rows, update_cells) để tra cứu dữ liệu tồn kho, bảng giá và cập nhật thông tin đơn hàng mới. Tuyệt đối bám sát nghiệp vụ kho và bảng tính.',
        tools: ['list_spreadsheets', 'read_range', 'append_rows', 'update_cells'],
        provider: 'google_sheets',
        requireHumanApprovalFor: ['append_rows', 'update_cells'],
        maxLoops: 4,
      },
      {
        id: 'default-two-step-pipeline',
        name: 'Pipeline: Phân Tích & Báo Cáo 2 Bước (SamuraiAI)',
        description:
          'Quy trình cố định 2 bước: Step 1 Bóc tách dữ liệu doanh thu -> Step 2 Định dạng & Báo cáo tổng kết.',
        systemPrompt:
          'Bạn là chuyên viên tài chính trong quy trình Pipeline 2 bước tuần tự SamuraiAI.',
        tools: [],
      },
      {
        id: 'team-announcement',
        name: 'Internal Communications Bot',
        description:
          'Hỗ trợ kiểm tra các kênh thảo luận và đăng thông báo lên kênh Slack nội bộ.',
        systemPrompt:
          'Bạn là trợ lý truyền thông nội bộ của công ty. Hỗ trợ kiểm tra danh sách kênh (list_channels), đọc tin nhắn thảo luận (read_messages) và đăng bài thông báo (post_message) lên các kênh Slack của công ty. Luôn xác nhận kênh và nội dung thông báo trước khi gửi.',
        tools: ['list_channels', 'read_messages', 'post_message'],
        provider: 'slack',
        requireHumanApprovalFor: ['post_message'],
        maxLoops: 4,
      },
    ];

    try {
      // 1. Nạp các workflows mặc định vào cache trước
      for (const wf of builtInWorkflows) {
        this.cache.set(wf.id, createWorkflow(wf));
      }

      // 2. Đồng bộ các workflows mặc định vào CSDL
      for (const wf of builtInWorkflows) {
        await this.persistWorkflow(wf);
      }

      // 3. Đọc lại toàn bộ workflows đang hoạt động từ CSDL
      const dbWorkflows = await this.prisma.workflow.findMany({
        where: { isActive: true },
      });

      for (const record of dbWorkflows) {
        const meta =
          record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
            ? (record.metadata as Record<string, unknown>)
            : {};

        const slug = record.slug || record.id;
        const config: AgentWorkflowConfig = {
          id: slug,
          name: record.name,
          description: record.description ?? undefined,
          systemPrompt: record.systemPrompt,
          model: record.model ?? undefined,
          tools: record.tools,
          requireHumanApprovalFor: record.requireApprovalFor,
          maxLoops: record.maxLoops ?? 5,
          provider: typeof meta.provider === 'string' ? meta.provider : undefined,
          securityScopes: Array.isArray(meta.securityScopes) ? (meta.securityScopes as string[]) : undefined,
        };

        const workflow = createWorkflow(config);
        this.cache.set(slug, workflow);
        if (record.id && record.id !== slug) {
          this.cache.set(record.id, workflow);
        }
      }

      this.logger.log(
        `Đã đồng bộ ${dbWorkflows.length} workflows từ CSDL PostgreSQL vào bộ nhớ`,
      );
    } catch (error) {
      this.logger.warn(
        `Không thể đồng bộ workflows từ DB, sử dụng cache mặc định: ${(error as Error).message}`,
      );
    }
  }
}
