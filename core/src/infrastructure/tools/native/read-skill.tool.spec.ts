import { ReadSkillTool } from './read-skill.tool';
import { NativeToolRegistryService } from './native-tool-registry.service';
import { ISkillCatalogReader } from '../../../contracts/skill/skill-catalog-reader.interface';

describe('ReadSkillTool', () => {
  const mockCatalog = {
    getSkillBySlug: jest.fn(),
    getCatalogForPrompt: jest.fn(),
  } satisfies ISkillCatalogReader;

  let registry: NativeToolRegistryService;
  let tool: ReadSkillTool;

  const skill = {
    id: 'skill-1',
    tenantId: 'tenant-a',
    slug: 'hotel-cancellation',
    name: 'Hotel Cancellation',
    description: 'mô tả',
    instructions: '# Playbook\n1. Kiểm tra booking',
    tools: ['cancel_booking'],
    tags: [],
    isActive: true,
  };

  const parse = (res: { content?: Array<{ text?: string }> }) =>
    JSON.parse(res.content?.[0]?.text ?? '{}');

  beforeEach(() => {
    registry = new NativeToolRegistryService();
    tool = new ReadSkillTool(mockCatalog, registry);
  });

  afterEach(() => jest.resetAllMocks());

  it('registers itself into the native registry on module init so agents can list and call it', async () => {
    tool.onModuleInit();

    expect(registry.hasTool('read_skill')).toBe(true);
    expect(registry.getAllTools().map((t) => t.name)).toContain('read_skill');

    mockCatalog.getSkillBySlug.mockResolvedValue(skill);
    const res = await registry.executeTool('read_skill', {
      slug: 'hotel-cancellation',
    });
    expect(res.isError).toBe(false);
  });

  it('declares slug as a required input and is marked read-only', () => {
    const dto = tool.toMcpToolDto();

    expect(dto.name).toBe('read_skill');
    expect(dto.inputSchema).toMatchObject({ required: ['slug'] });
    expect(dto.annotations?.readOnlyHint).toBe(true);
    // Preflight guard chỉ bỏ qua OAuth khi authType là SYSTEM.
    expect(dto.authType).toBe('SYSTEM');
  });

  it('returns the full instructions and the tools list of the skill', async () => {
    mockCatalog.getSkillBySlug.mockResolvedValue(skill);

    const res = await tool.execute({ slug: 'hotel-cancellation' });

    expect(res.isError).toBe(false);
    expect(parse(res)).toEqual({
      slug: 'hotel-cancellation',
      name: 'Hotel Cancellation',
      instructions: '# Playbook\n1. Kiểm tra booking',
      tools: ['cancel_booking'],
    });
  });

  it('resolves the tenant from context.tenantId, falling back to context.workspaceId', async () => {
    mockCatalog.getSkillBySlug.mockResolvedValue(skill);

    await tool.execute({ slug: 'a' }, { tenantId: 'tenant-a', workspaceId: 'ws-1' });
    await tool.execute({ slug: 'a' }, { workspaceId: 'ws-1' });
    await tool.execute({ slug: 'a' });

    expect(mockCatalog.getSkillBySlug).toHaveBeenNthCalledWith(1, 'a', 'tenant-a');
    expect(mockCatalog.getSkillBySlug).toHaveBeenNthCalledWith(2, 'a', 'ws-1');
    expect(mockCatalog.getSkillBySlug).toHaveBeenNthCalledWith(3, 'a', undefined);
  });

  it('returns an explicit SKILL_NOT_FOUND error when the slug is missing or inactive', async () => {
    mockCatalog.getSkillBySlug.mockResolvedValue(null);

    const res = await tool.execute({ slug: 'nope' });

    expect(res.isError).toBe(true);
    expect(parse(res)).toMatchObject({ code: 'SKILL_NOT_FOUND' });
    expect(parse(res).message).toContain('nope');
  });

  it.each([{}, { slug: '' }, { slug: '   ' }, { slug: 123 }])(
    'rejects invalid arguments %j without querying the catalog',
    async (args) => {
      const res = await tool.execute(args as Record<string, unknown>);

      expect(res.isError).toBe(true);
      expect(parse(res)).toMatchObject({ code: 'INVALID_ARGUMENTS' });
      expect(mockCatalog.getSkillBySlug).not.toHaveBeenCalled();
    },
  );
});
