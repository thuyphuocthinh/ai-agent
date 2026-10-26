import { McpToolDto } from './dtos/mcp.dto';
import { ToolCallTraceDto } from './dtos/react-loop.dto';

export const SUB_AGENT_SPAWNER = Symbol.for('SUB_AGENT_SPAWNER');
export const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_subagent';

export const SPAWN_SUBAGENT_TOOL_SCHEMA: McpToolDto = {
  name: SPAWN_SUBAGENT_TOOL_NAME,
  description:
    'Ủy quyền một nhiệm vụ con nặng, phân tích chuyên sâu, tóm tắt tài liệu lớn (>30k ký tự) hoặc tính toán cô lập cho một Sub-Agent tạm thời (ephemeral) để không làm quá tải ngữ cảnh của phiên chat chính.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Mô tả chi tiết và rõ ràng nhiệm vụ mà Sub-Agent cần thực thi độc lập',
      },
      context: {
        type: 'string',
        description: 'Ngữ cảnh hoặc đoạn trích dữ liệu cần thiết cung cấp riêng cho Sub-Agent',
      },
      model: {
        type: 'string',
        description: 'Model tùy chọn chỉ định cho Sub-Agent (ví dụ: gemini-2.0-flash, gpt-4o-mini)',
      },
    },
    required: ['task'],
  },
};

export interface SubAgentSpawnOptions {
  task: string;
  context?: string;
  model?: string;
  provider?: string;
  providers?: string[];
  allowedTools?: string[];
  parentMessageId: string;
  userId: string;
  channelId: string;
  conversationId?: string;
  workspaceId?: string;
  tenantId?: string;
  sessionType?: string;
  signal?: AbortSignal;
}

export interface SubAgentSpawnResult {
  success: boolean;
  result: string;
  toolCalls?: ToolCallTraceDto[];
  error?: string;
}

export interface ISubAgentSpawner {
  spawn(options: SubAgentSpawnOptions): Promise<SubAgentSpawnResult>;
}
