export const SKILL_CATALOG_READER = Symbol.for('SKILL_CATALOG_READER');

export interface ISkillPlaybookDetail {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  tags: string[];
  isActive: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface ISkillCatalogReader {
  /**
   * Retrieves full skill playbook details for Level 2 on-demand execution.
   */
  getSkillBySlug(
    slug: string,
    tenantId?: string,
  ): Promise<ISkillPlaybookDetail | null>;

  /**
   * Generates a lightweight Level 1 catalog string (slug, name, description)
   * suitable for inclusion in an agent's system prompt. Skills listed in
   * `excludeSlugs` (e.g. already auto-loaded into the prompt) are left out.
   */
  getCatalogForPrompt(
    tenantId?: string,
    excludeSlugs?: readonly string[],
  ): Promise<string>;
}
