export const PORT_TCP = {
  AUTH_TCP_PORT: 3001,
  USER_TCP_PORT: 3002,
  WORKSPACE_TCP_PORT: 3003,
  CHANNEL_TCP_PORT: 3004,
  MESSAGE_TCP_PORT: 3005,
  TASK_TCP_PORT: 3006,
  NOTIFICATION_TCP_PORT: 3007,
  VIDEO_CALL_TCP_PORT: 3009,
  BILLING_TCP_PORT: 3010,
  INTEGRATIONS_TCP_PORT: 3011,
  CANVAS_TCP_PORT: 3012,
  CALENDAR_TCP_PORT: 3013,
  ORCHESTRATION_TCP_PORT: 3014,
  // 3015 bị EDGE_RELAY_PORT (orchestration, apps/orchestration/src/main.ts)
  // chiếm — 2 process PM2 riêng nhưng chung 1 container/network namespace nên
  // đụng cổng thật (EADDRINUSE), không phải lý thuyết.
  NOTE_TCP_PORT: 3016,
};

export const NAME_SERVICE_TCP = {
  AUTH_SERVICE: 'AUTH_SERVICE',
  USER_SERVICE: 'USER_SERVICE',
  WORKSPACE_SERVICE: 'WORKSPACE_SERVICE',
  CHANNEL_SERVICE: 'CHANNEL_SERVICE',
  MESSAGE_SERVICE: 'MESSAGE_SERVICE',
  TASK_SERVICE: 'TASK_SERVICE',
  NOTIFICATION_SERVICE: 'NOTIFICATION_SERVICE',
  VIDEO_CALL_SERVICE: 'VIDEO_CALL_SERVICE',
  BILLING_SERVICE: 'BILLING_SERVICE',
  INTEGRATIONS_SERVICE: 'INTEGRATIONS_SERVICE',
  CANVAS_SERVICE: 'CANVAS_SERVICE',
  CALENDAR_SERVICE: 'CALENDAR_SERVICE',
  ORCHESTRATION_SERVICE: 'ORCHESTRATION_SERVICE',
  NOTE_SERVICE: 'NOTE_SERVICE',
};

export const MESSAGE_MESSAGE_PATTERNS = {
  CREATE: 'message.create',
  GET_MESSAGES: 'message.get_messages',
  GET_BY_ID: 'message.get_by_id',
  UPDATE: 'message.update',
  DELETE: 'message.delete',
  TOGGLE_REACTION: 'message.toggle_reaction',
  TOGGLE_FEEDBACK: 'message.toggle_feedback',
  TOGGLE_PIN: 'message.toggle_pin',
  SEARCH: 'message.search',
  GET_THREADS: 'message.get_threads',
  GET_PINNED_MESSAGES: 'message.get_pinned_messages',
  GET_SURROUNDING_MESSAGES: 'message.get_surrounding_messages',
  GET_FULL_THREAD: 'message.get_full_thread',
  GET_ATTACHMENTS: 'message.get_attachments',
} as const;
