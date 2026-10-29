import {
  AvailableAgentDto,
  DelegationDto,
} from '../../../../contracts/dtos/supervisor.dto';

// Supervisor có thể ghi agent bằng label/biến thể chính tả thay vì provider: đưa về provider thật.
// MUTATE tại chỗ `step.agent` (nơi gọi dùng lại chính mảng steps); agent không khớp giữ nguyên.
export function normalizePlanStepAgents(
  steps: DelegationDto[],
  agents: readonly AvailableAgentDto[],
): void {
  steps.forEach((s) => {
    const safeAgent = s.agent || '';
    const matchedAgent = agents.find(
      (a) =>
        a.provider === safeAgent ||
        a.label.toLowerCase() === safeAgent.toLowerCase() ||
        a.label.toLowerCase().replace(/[^a-z0-9]/g, '') ===
          safeAgent.toLowerCase().replace(/[^a-z0-9]/g, ''),
    );
    if (matchedAgent && matchedAgent.provider !== s.agent) {
      s.agent = matchedAgent.provider;
    }
  });
}
