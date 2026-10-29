/**
 * OpenTelemetry GenAI Semantic Conventions & Enterprise Agent Trace Attributes.
 *
 * Chuẩn hóa các key thuộc tính span theo quy ước OpenTelemetry GenAI và OpenTelemetry Semantic Conventions.
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export const GEN_AI_ATTRIBUTES = {
  // GenAI Standard Conventions
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  OPERATION_NAME: 'gen_ai.operation.name',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
  USAGE_COST_USD: 'gen_ai.usage.cost_usd',

  // Agent Orchestration Core Domain Conventions
  AGENT_USER_ID: 'agent.user_id',
  AGENT_CONVERSATION_ID: 'agent.conversation_id',
  AGENT_MESSAGE_ID: 'agent.message_id',
  AGENT_TURN_ID: 'agent.turn_id',
  AGENT_WORKSPACE_ID: 'agent.workspace_id',
  AGENT_ENGINE_MODE: 'agent.engine_mode',
  AGENT_ROUND_INDEX: 'agent.round_index',
  AGENT_TOOL_NAME: 'agent.tool_name',
  AGENT_TOOL_PROVIDER: 'agent.tool_provider',
  AGENT_ACTION_TYPE: 'agent.action_type',
  AGENT_BEHAVIOR_SIGNAL: 'agent.behavior_signal',
} as const;

export type TGenAiAttributeKey =
  (typeof GEN_AI_ATTRIBUTES)[keyof typeof GEN_AI_ATTRIBUTES];
