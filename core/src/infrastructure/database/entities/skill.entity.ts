import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ECheckpointRiskLevel } from '@agent/core/constants';
import { SkillStep } from '../../../memory/memory.interface';

// Đúc ra lúc runtime từ các checkpoint ĐÃ được duyệt và chạy thành công nhiều
// lần cho cùng 1 việc (xem SkillService.recordSuccessfulRun) — không phải do
// người viết tay trước. approvedRunCount quyết định skill có đủ tin cậy để
// gợi ý hay chưa (ngưỡng khác nhau theo riskLevel, xem SkillRetrievalService).
@Entity('orchestration_skills')
export class SkillEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  @Index()
  tenantId: string;

  // Backward-compatibility alias
  get workspaceId(): string {
    return this.tenantId;
  }
  set workspaceId(value: string) {
    this.tenantId = value;
  }

  // Dùng để embed/so khớp với prompt hiện tại — nên là câu mô tả gốc của lần
  // đầu tiên đúc ra skill, KHÔNG tự đổi theo các lần chạy sau.
  @Column({ type: 'text', name: 'task_description' })
  taskDescription: string;

  // Dạng prose dễ đọc — hiển thị cho user xem hệ thống đã học được gì, không
  // dùng để replay (đó là việc của `steps`).
  @Column({ type: 'text', name: 'summary_markdown' })
  summaryMarkdown: string;

  @Column({ type: 'jsonb' })
  steps: SkillStep[];

  @Column({
    type: 'jsonb',
    name: 'source_checkpoint_ids',
    default: () => "'[]'",
  })
  sourceCheckpointIds: string[];

  @Column({ type: 'int', name: 'approved_run_count', default: 1 })
  approvedRunCount: number;

  @Column({ type: 'varchar', name: 'risk_level', nullable: true })
  riskLevel: ECheckpointRiskLevel | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
