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
      // Event log theo turn (Redis Streams): sống 2h khi đang chạy, 1h sau khi xong
      // (DB mới là nơi lưu bền vững). MAXLEN là ngưỡng an toàn (xấp xỉ), đủ lớn để
      // replay từ đầu không bị cắt với 1 turn bình thường.
      TURN_LOG_ACTIVE_TTL: 7200,
      TURN_LOG_FINISHED_TTL: 3600,
      TURN_LOG_MAXLEN: 100000,
      // Nhịp tim của worker đang chạy turn: hết hạn = worker đã chết, turn không còn tiến triển.
      TURN_HEARTBEAT_TTL: 45,
      TURN_HEARTBEAT_INTERVAL_MS: 15000,
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
      TURN_LOG: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_log:${messageId}`,
      TURN_META: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_meta:${messageId}`,
      TURN_HEARTBEAT: (messageId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_hb:${messageId}`,
      TURN_ACTIVE: (conversationId: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:orchestration:v1:turn_active:${conversationId}`,
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
  AGENTS: {
    _VER: 'v1',
    SETTINGS: {
      AVAILABLE_TTL: TTL.TINY, // 60 giây (tự động cộng Jitter chống Cache Stampede qua CachedService)
    },
    KEYS: {
      AVAILABLE: (userId: string, workspaceId = 'default'): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:agents:v1:available:${userId}:${workspaceId}`,
    },
  },
  SUMMARY: {
    _VER: 'v1',
    SETTINGS: {
      TTL: TTL.MEDIUM, // 1 giờ (3600 giây)
    },
    KEYS: {
      CONVERSATION: (conversationId: string, turnMarker: string): string =>
        `${GLOBAL_PREFIX}:${GLOBAL_VER}:summary:v1:${conversationId}:${turnMarker}`,
    },
  },
};
