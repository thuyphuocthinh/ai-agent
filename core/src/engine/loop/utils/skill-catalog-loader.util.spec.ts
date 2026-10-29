import { Logger } from '@nestjs/common';
import { loadSkillCatalogSafely } from './skill-catalog-loader.util';

describe('loadSkillCatalogSafely', () => {
  const logger = { warn: jest.fn() } as unknown as Logger;
  const reader = { getCatalogForPrompt: jest.fn(), getSkillBySlug: jest.fn() };

  afterEach(() => jest.resetAllMocks());

  it('returns the catalog of the tenant, passing the excluded slugs', async () => {
    reader.getCatalogForPrompt.mockResolvedValue('CATALOG');

    await expect(
      loadSkillCatalogSafely(reader, logger, 'tenant-a', ['sql-safe-write']),
    ).resolves.toBe('CATALOG');
    expect(reader.getCatalogForPrompt).toHaveBeenCalledWith('tenant-a', [
      'sql-safe-write',
    ]);
  });

  it('excludes nothing by default', async () => {
    reader.getCatalogForPrompt.mockResolvedValue('');

    await loadSkillCatalogSafely(reader, logger, 'tenant-a');

    expect(reader.getCatalogForPrompt).toHaveBeenCalledWith('tenant-a', []);
  });

  it('returns an empty string without touching anything when there is no reader', async () => {
    await expect(loadSkillCatalogSafely(undefined, logger)).resolves.toBe('');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns an empty string and logs one warning when the reader fails', async () => {
    reader.getCatalogForPrompt.mockRejectedValue(new Error('db down'));

    await expect(loadSkillCatalogSafely(reader, logger, 'tenant-a')).resolves.toBe('');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
