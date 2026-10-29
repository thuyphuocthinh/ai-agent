import { Prisma } from '@prisma/client';
import { isPrismaUniqueViolation } from './prisma-error.util';

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('isPrismaUniqueViolation', () => {
  it('is true for a P2002 known request error', () => {
    expect(isPrismaUniqueViolation(knownError('P2002'))).toBe(true);
  });

  it('is false for other Prisma error codes', () => {
    expect(isPrismaUniqueViolation(knownError('P2025'))).toBe(false);
  });

  it.each([new Error('P2002'), { code: 'P2002' }, null, undefined, 'P2002'])(
    'is false for a non-Prisma value %j',
    (value) => {
      expect(isPrismaUniqueViolation(value)).toBe(false);
    },
  );
});
