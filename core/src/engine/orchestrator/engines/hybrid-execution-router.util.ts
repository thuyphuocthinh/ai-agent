/**
 * Hybrid Execution Router
 *
 * Quyết định xem một yêu cầu người dùng nên được điều phối qua:
 * 1. SINGLE_AGENT (Mặc định 85-90%): 1 ReAct session duy nhất tải tools từ tất cả providers kết nối,
 *    không qua 4 bước Supervisor, tiết kiệm 50-70% token, giảm latency và bảo toàn 100% dữ liệu.
 * 2. DYNAMIC_SUPERVISOR (10-15%): Kích hoạt Supervisor phân rã subagent khi gặp 4 tình huống đặc thù:
 *    - (1) Fan-out song song độc lập (quét đồng thời nhiều đích để tối ưu thời gian).
 *    - (2) Sandbox cô lập code (Python compute / Bash script) để lỗi không ảnh hưởng phiên chat chính.
 *    - (3) Context / Payload quá tải (> 30.000 ký tự hoặc file log quá lớn) cần worker tóm tắt rồi hủy.
 *    - (4) Mâu thuẫn chỉ dẫn / Đối kháng (Red-Team vs Blue-Team, phản biện chéo).
 */

import { EExecutionEngineMode } from '../../../contracts/engine/execution-engine.interface';

// Heuristic chỉ chọn 1 trong 2: SINGLE_AGENT hoặc DYNAMIC_SUPERVISOR (dùng chung enum với engine registry).

export interface HybridRoutingDecision {
  mode: EExecutionEngineMode.SINGLE_AGENT | EExecutionEngineMode.DYNAMIC_SUPERVISOR;
  reason: string;
}

export interface HybridRoutingOptions {
  prompt: string;
  forcedMode?: 'single' | 'supervisor' | 'auto';
  contextCharBudgetEstimate?: number;
}

const PARALLEL_FANOUT_REGEX =
  /(quét|kiểm tra|tìm kiếm|tra cứu|so sánh)\s+(đồng thời|cùng lúc|song song)|cùng lúc trên (\d+|nhiều)|fan-out/i;

const PYTHON_SANDBOX_REGEX =
  /(chạy|thực thi)\s+(script|mã|code|lệnh)?\s*(python|bash)|run_python|vẽ đồ thị bằng python|viết và chạy python/i;

const ADVERSARIAL_ROLES_REGEX =
  /đối kháng|red-team|blue-team|phản biện chéo|đóng vai 2 bên tranh luận|đối lập nhau|tranh biện 2 chiều/i;

const OVERFLOW_CHAR_THRESHOLD = 30000;

export function decideExecutionMode(
  options: HybridRoutingOptions,
): HybridRoutingDecision {
  const { prompt, forcedMode = 'auto', contextCharBudgetEstimate = 0 } = options;

  // 0. Ghi đè cưỡng bức (nếu có cấu hình)
  if (forcedMode === 'supervisor') {
    return {
      mode: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      reason: 'Cưỡng bức chạy qua Supervisor theo cấu hình (forcedMode=supervisor)',
    };
  }
  if (forcedMode === 'single') {
    return {
      mode: EExecutionEngineMode.SINGLE_AGENT,
      reason: 'Cưỡng bức chạy qua Single Agent theo cấu hình (forcedMode=single)',
    };
  }

  // 1. Điều kiện 1: Tác vụ song song độc lập (Parallel Fan-out)
  if (PARALLEL_FANOUT_REGEX.test(prompt)) {
    return {
      mode: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      reason: 'Kích hoạt Multi-Agent Supervisor: Yêu cầu chạy song song độc lập (Parallel Fan-out)',
    };
  }

  // 2. Điều kiện 2: Chạy Code trong môi trường Sandbox (Python / Bash)
  if (PYTHON_SANDBOX_REGEX.test(prompt)) {
    return {
      mode: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      reason: 'Kích hoạt Multi-Agent Supervisor: Chạy mã Python/Bash cách ly trong Sandbox compute',
    };
  }

  // 3. Điều kiện 3: Ngữ cảnh hoặc tài liệu quá khổ (Long Document / Payload Overflow)
  if (
    prompt.length > OVERFLOW_CHAR_THRESHOLD ||
    contextCharBudgetEstimate > OVERFLOW_CHAR_THRESHOLD
  ) {
    return {
      mode: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      reason: 'Kích hoạt Multi-Agent Supervisor: Ngữ cảnh vượt ngưỡng an toàn (>30k ký tự), cần Subagent tóm tắt cô lập',
    };
  }

  // 4. Điều kiện 4: Vai trò đối kháng / Mâu thuẫn chỉ dẫn
  if (ADVERSARIAL_ROLES_REGEX.test(prompt)) {
    return {
      mode: EExecutionEngineMode.DYNAMIC_SUPERVISOR,
      reason: 'Kích hoạt Multi-Agent Supervisor: Mâu thuẫn chỉ dẫn hoặc yêu cầu đối kháng (Red-Team vs Blue-Team)',
    };
  }

  // MẶC ĐỊNH (85-90%): Single Agent ReAct đa công cụ
  return {
    mode: EExecutionEngineMode.SINGLE_AGENT,
    reason: 'Định tuyến mặc định: Multi-Provider Single Agent (chung ngữ cảnh, tối ưu độ trễ và token)',
  };
}
