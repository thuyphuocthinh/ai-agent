/**
 * Dữ liệu đầu vào để tạo mới một Skill (tenantId mặc định là skill dùng chung).
 */
export interface CreateSkillInput {
  tenantId?: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  tags?: string[];
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Dữ liệu cập nhật một phần Skill; field nào bỏ trống thì giữ nguyên.
 */
export type UpdateSkillInput = Partial<Omit<CreateSkillInput, 'tenantId'>>;

/**
 * Bản ghi Skill (playbook nghiệp vụ) dùng trong runtime.
 */
export interface SkillRecord {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  tags: string[];
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
