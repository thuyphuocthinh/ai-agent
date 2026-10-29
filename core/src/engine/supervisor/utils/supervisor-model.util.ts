import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';

export type SupervisorModelKind = 'plan' | 'evaluate' | 'synthesize';

// Model riêng cho từng việc (rẻ cho evaluate, mạnh cho plan...), rơi về
// SUPERVISOR_MODEL rồi hằng số mặc định. Đọc env lúc gọi (không cache) để đổi cấu
// hình lúc chạy và để test đặt env động.
export function resolveSupervisorModelId(kind: SupervisorModelKind): string {
  const specific =
    kind === 'plan'
      ? process.env.SUPERVISOR_PLANNING_MODEL
      : kind === 'evaluate'
        ? process.env.SUPERVISOR_EVALUATE_MODEL
        : undefined;
  return (
    specific ??
    process.env.SUPERVISOR_MODEL ??
    ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL
  );
}

// Model leo thang khi kế hoạch bị nghi ngờ; không đặt = không leo thang (undefined).
export function resolveEscalationModelId(): string | undefined {
  return process.env.SUPERVISOR_ESCALATION_MODEL;
}
