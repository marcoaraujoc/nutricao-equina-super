import { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';

export abstract class BaseRepository {
  protected readonly prisma: PrismaClient;

  constructor(client?: PrismaClient) {
    this.prisma = client ?? prisma;
  }
}