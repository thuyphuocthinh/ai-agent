import * as path from 'path';
import {
  ORCHESTRATION_CONSTANTS,
  DIRECT_TO_DISK_OFFLOAD_NOTE,
} from '../../../constants';
import {
  IArtifactTmpManager,
  SaveToTmpEnvelopeDto,
} from '../../../contracts/storage/artifact-tmp.interface';

/**
 * Xử lý offload dữ liệu lớn trực tiếp ra ổ đĩa tạm an toàn (Direct-to-Disk).
 * Nếu kết quả tool là JSON và vượt ngưỡng `DIRECT_TO_DISK_CHAR_THRESHOLD` (50KB),
 * lưu file raw JSON vào thư mục tạm của turn và trả về JSON Envelope siêu nhẹ (~250 ký tự).
 *
 * @returns JSON chuỗi Envelope nếu offload thành công, hoặc `null` nếu không đủ điều kiện offload.
 */
export async function tryOffloadPayloadToDisk(
  toolName: string,
  rawText: string,
  turnId: string,
  tmpManager?: IArtifactTmpManager,
  thresholdChars: number = ORCHESTRATION_CONSTANTS.DIRECT_TO_DISK_CHAR_THRESHOLD,
): Promise<string | null> {
  if (!tmpManager || rawText.length <= thresholdChars) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText);
    const safeToolSlug = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `source_${safeToolSlug}.json`;

    const savedPath = await tmpManager.saveJsonToFile(turnId, filename, parsed);
    const turnDir =
      typeof tmpManager.getTurnDir === 'function'
        ? tmpManager.getTurnDir(turnId)
        : turnId;
    const sanitizedTurnId = path.basename(turnDir);
    const recordCount = Array.isArray(parsed) ? parsed.length : 1;
    const sample = Array.isArray(parsed) ? parsed.slice(0, 2) : [parsed];

    const envelope: SaveToTmpEnvelopeDto = {
      status: 'saved_to_tmp',
      filename,
      containerPath: `/tmp/artifacts/${sanitizedTurnId}/${filename}`,
      path: savedPath,
      recordCount,
      byteSize: rawText.length,
      sample,
      note: DIRECT_TO_DISK_OFFLOAD_NOTE,
    };

    return JSON.stringify(envelope);
  } catch {
    // Không phải JSON hợp lệ (ví dụ: plain text hoặc log), không offload ra file JSON
    return null;
  }
}
