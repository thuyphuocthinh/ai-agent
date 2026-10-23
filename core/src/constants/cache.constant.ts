const GLOBAL_PREFIX = 'agent';
const GLOBAL_VER = 'v1';

export const TTL = {
  TINY: 60, // 1 phút
  SHORT: 300, // 5 phút
  MEDIUM: 3600, // 1 giờ
  LONG: 86400, // 1 ngày
  WEEK: 604800, // 1 tuần
};

export const CACHE = {
  ORCHESTRATION: {
    _VER: 'v1',
    SETTINGS: {
      TURN_TTL: 900,
    },
    KEYS: {
      TURN_OWNER: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_owner:${messageId}`,
      TURN_CANCEL: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_cancel:${messageId}`,
      STREAM_CHANNEL: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:stream:${messageId}`,
      CANCEL_CHANNEL: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:cancel:${messageId}`,
      WORKSPACE_TRIGGER_COUNT: (workspaceId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:trigger_count:${workspaceId}`,
      CIRCUIT_BREAKER_STATE: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:state:${key}`,
      CIRCUIT_BREAKER_OPENED_AT: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:opened_at:${key}`,
      CIRCUIT_BREAKER_PROBE_LOCK: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:probe_lock:${key}`,
      CIRCUIT_BREAKER_TOTAL: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:total:${key}`,
      CIRCUIT_BREAKER_FAILURES: (key: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:circuit_breaker:failures:${key}`,
    },
  },
  TOOLS: {
    _VER: 'v1',
    KEYS: {
      LIST: (version: number): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tools:v1:list_v${version}`,
      PROVIDER_HEALTH: (provider: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:tools:v1:health:${provider}`,
    },
    TRACKERS: {
      TOOL_LIST_VERSION: `${GLOBAL_PREFIX}:trackers:tools:list_version`,
    },
    TAGS: {
      ROOT: (): string[] => [`${GLOBAL_PREFIX}:tools`],
      PROVIDER: (provider: string): string[] => [
        `${GLOBAL_PREFIX}:tools`,
        provider,
      ],
    },
  },
};
