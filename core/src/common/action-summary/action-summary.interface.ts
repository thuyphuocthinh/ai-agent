export interface ActionSummaryContext {
  provider: string;
  toolName: string;
  args?: Record<string, unknown>;
  toolDescription?: string;
}

export interface ActionSummaryAdapter {
  /**
   * Độ ưu tiên của adapter. Số càng lớn thì chạy càng sớm trong pipeline.
   * - SqlSummaryAdapter: 100 (xử lý chuyên biệt cho SQL)
   * - PolicySummaryAdapter: 50 (xử lý quy tắc template cấu hình)
   * - MetadataSummaryAdapter: 10 (tận dụng tool description trong schema)
   * - FallbackSummaryAdapter: 0 (fallback an toàn cuối cùng)
   */
  readonly priority: number;

  supports(context: ActionSummaryContext): boolean;
  format(context: ActionSummaryContext): string;
}
