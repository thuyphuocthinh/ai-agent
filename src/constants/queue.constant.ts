export enum EQueueName {
  NOTIFICATION_QUEUE = 'notification',
  EMAIL_QUEUE = 'email',
  WORKSPACE_QUEUE = 'workspace',
  MESSAGE_QUEUE = 'message',
  CHANNEL_QUEUE = 'channel',
  AUDIT_QUEUE = 'audit',
  SOCKET_QUEUE = 'socket',
  TASK_QUEUE = 'task',
  RESOURCE_QUEUE = 'resource',
  OUTBOUND_WEBHOOK_QUEUE = 'outbound_webhook',
  INCOMING_WEBHOOK_QUEUE = 'incoming_webhook',
  LINK_PREVIEW_QUEUE = 'link_preview',
  CALENDAR_QUEUE = 'calendar',
  INTEGRATION_SYNC_QUEUE = 'integration_sync',
  AI_ORCHESTRATION_QUEUE = 'ai_orchestration',
  DYNAMIC_PROVIDER_QUEUE = 'dynamic_provider',
  EDGE_RELAY_QUEUE = 'edge_relay',
}

export enum EJobName {
  PROCESS_AI_TRIGGER = 'process_ai_trigger',
  PROCESS_APPROVAL = 'process_approval',
  UPDATE_DYNAMIC_PROVIDER_TOKEN = 'update_dynamic_provider_token',
  EDGE_DISPATCH_MESSAGE = 'edge_dispatch_message',
  EDGE_NOTIFY_MESSAGE = 'edge_notify_message',
  EMIT_EVENT = 'emit_event',
  EMIT_TO_USERS = 'emit_to_users',
}
