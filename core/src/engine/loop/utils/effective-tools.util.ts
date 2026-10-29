import { NATIVE_TOOL_PROVIDER } from '../../../constants/engine-literals.constant';
import { McpToolDto } from '../../../contracts/dtos/mcp.dto';

// allowedTools chỉ giới hạn tool của provider; native tool (VD read_skill, chỉ đọc)
// luôn có sẵn cho mọi engine. Không có allowedTools (hoặc có '*') = giữ nguyên toàn bộ.
export function resolveEffectiveTools(
  mcpTools: readonly McpToolDto[],
  toolToProviderMap: ReadonlyMap<string, string>,
  allowedTools?: readonly string[],
): McpToolDto[] {
  if (!allowedTools || allowedTools.length === 0 || allowedTools.includes('*')) {
    return [...mcpTools];
  }
  return mcpTools.filter(
    (t) =>
      allowedTools.includes(t.name) ||
      toolToProviderMap.get(t.name) === NATIVE_TOOL_PROVIDER,
  );
}
