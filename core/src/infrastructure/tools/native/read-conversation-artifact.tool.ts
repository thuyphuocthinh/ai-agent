import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import {
  CONV_ARTIFACT_ERROR_CODES,
  CONV_ARTIFACT_READ_TOOL_NAME,
} from '@agent/core/constants';
import { MAX_TOOL_RESULT_CHARS } from '../../../common/text/token-budget.util';
import { CallToolResponseDto, McpToolDto } from '../../../contracts/dtos/mcp.dto';
import {
  CONVERSATION_ARTIFACT_STORE,
  IConversationArtifactStore,
} from '../../../contracts/storage/conversation-artifact.interface';
import { INativeTool, NativeToolExecutionContext } from './native-tool.interface';
import { NativeToolRegistryService } from './native-tool-registry.service';
import { nativeToolError, nativeToolJson } from './native-tool-response.util';

@Injectable()
export class ReadConversationArtifactTool implements INativeTool, OnModuleInit {
  readonly name = CONV_ARTIFACT_READ_TOOL_NAME;
  readonly description =
    'Đọc nội dung file dữ liệu tạm (artifact) đã được lưu trong cuộc hội thoại hiện tại theo filename.';
  readonly inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Tên file artifact trả về từ thông báo saved_to_artifact.',
      },
      offsetChars: {
        type: 'number',
        description: 'Vị trí ký tự bắt đầu đọc (mặc định 0).',
      },
      limitChars: {
        type: 'number',
        description: 'Số ký tự tối đa cần đọc trong một lần.',
      },
    },
    required: ['filename'],
  };

  constructor(
    @Optional()
    @Inject(CONVERSATION_ARTIFACT_STORE)
    private readonly artifactStore?: IConversationArtifactStore,
    @Optional()
    private readonly registry?: NativeToolRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry?.registerTool(this);
  }

  toMcpToolDto(): McpToolDto {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
    };
  }

  async execute(
    args: Record<string, unknown>,
    context?: NativeToolExecutionContext,
  ): Promise<CallToolResponseDto> {
    const conversationId = context?.conversationId?.trim();
    if (!conversationId) {
      return nativeToolError(
        CONV_ARTIFACT_ERROR_CODES.MISSING_CONVERSATION,
        'Thiếu conversationId trong ngữ cảnh thực thi.',
      );
    }
    const filename = typeof args.filename === 'string' ? args.filename.trim() : '';
    if (!filename || !this.artifactStore) {
      return nativeToolError(
        CONV_ARTIFACT_ERROR_CODES.INVALID_ARGUMENTS,
        'Thiếu tham số "filename" hoặc kho artifact chưa khả dụng.',
      );
    }

    try {
      const fullText = await this.artifactStore.read(conversationId, filename);
      const offset =
        typeof args.offsetChars === 'number' && args.offsetChars >= 0
          ? Math.floor(args.offsetChars)
          : 0;
      const limit =
        typeof args.limitChars === 'number' && args.limitChars > 0
          ? Math.min(Math.floor(args.limitChars), MAX_TOOL_RESULT_CHARS)
          : MAX_TOOL_RESULT_CHARS;
      const content = fullText.slice(offset, offset + limit);

      return nativeToolJson({
        filename,
        totalLength: fullText.length,
        offset,
        hasMore: offset + content.length < fullText.length,
        content,
      });
    } catch (error) {
      return nativeToolError(
        CONV_ARTIFACT_ERROR_CODES.READ_FAILED,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
