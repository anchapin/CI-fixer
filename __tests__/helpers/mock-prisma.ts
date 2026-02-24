import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended';

export const prismaMock = mockDeep<PrismaClient>();
export type Context = {
  prisma: DeepMockProxy<PrismaClient>;
};

export const createMockContext = (): Context => {
  return {
    prisma: prismaMock,
  };
};
