import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  ISkillCatalogReader,
  SKILL_CATALOG_READER,
} from '../../../contracts/skill/skill-catalog-reader.interface';
import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';
import { INativeTool, NativeToolExecutionContext } from './native-tool.interface';
import { NativeToolRegistryService } from './native-tool-registry.service';

// Tên tool dùng chung: engine chỉ nối catalog vào prompt khi agent thực sự có tool này.
export const READ_SKILL_TOOL_NAME = 'read_skill';

function errorResponse(code: string, message: string): CallToolResponseDto {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: true, retryable: false, code, message }),
      },
    ],
  };
}

// Level 2 của Progressive Disclosure: agent thấy catalog (slug + mô tả) trong
// prompt, cần playbook nào thì gọi read_skill({ slug }) để đọc nội dung đầy đủ.
// Chỉ phụ thuộc contract ISkillCatalogReader — implementation do module bind.
@Injectable()
export class ReadSkillTool implements INativeTool, OnModuleInit {
  readonly name = READ_SKILL_TOOL_NAME;
  readonly description =
    'Đọc hướng dẫn chi tiết (playbook) của một skill trong catalog theo slug. Gọi khi yêu cầu của người dùng khớp một skill đã liệt kê, TRƯỚC khi bắt đầu thực hiện.';
  readonly inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'Slug của skill trong catalog, ví dụ "hotel-cancellation"',
      },
    },
    required: ['slug'],
  };

  constructor(
    @Inject(SKILL_CATALOG_READER)
    private readonly catalog: ISkillCatalogReader,
    private readonly registry: NativeToolRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.registerTool(this);
  }

  toMcpToolDto(): McpToolDto {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      annotations: { readOnlyHint: true },
      // Dịch vụ nội bộ, không cần người dùng kết nối OAuth (= EProviderAuthType.SYSTEM;
      // infrastructure không được import security nên dùng đúng giá trị chuỗi).
      authType: 'SYSTEM',
    };
  }

  async execute(
    args: Record<string, unknown>,
    context?: NativeToolExecutionContext,
  ): Promise<CallToolResponseDto> {
    const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
    if (!slug) {
      return errorResponse(
        'INVALID_ARGUMENTS',
        'Thiếu tham số "slug" (chuỗi, không rỗng)',
      );
    }

    // Engine truyền tenant qua workspaceId (cùng một định danh), tenantId ưu tiên.
    const tenantId = context?.tenantId ?? context?.workspaceId;
    const skill = await this.catalog.getSkillBySlug(slug, tenantId);
    if (!skill) {
      return errorResponse(
        'SKILL_NOT_FOUND',
        `Không tìm thấy skill "${slug}" hoặc skill đã bị tắt`,
      );
    }

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            slug: skill.slug,
            name: skill.name,
            instructions: skill.instructions,
            tools: skill.tools,
          }),
        },
      ],
    };
  }
}
