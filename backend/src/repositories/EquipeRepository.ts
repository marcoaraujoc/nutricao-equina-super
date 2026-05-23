import { Prisma } from '@prisma/client';
import { BaseRepository } from './BaseRepository';

export class EquipeRepository extends BaseRepository {
  async findById(id: number) {
    return this.prisma.equipe.findUnique({
      where: { id },
      include: {
        empresa: true,
        membros: {
          include: { user: { select: { id: true, fullName: true, email: true, userType: true } } },
        },
        convites: { where: { status: 'PENDENTE' } },
      },
    });
  }

  async findByMemberId(userId: number) {
    return this.prisma.equipe.findFirst({
      where: { membros: { some: { userId } } },
      include: {
        empresa: true,
        membros: {
          include: { user: { select: { id: true, fullName: true, email: true, userType: true } } },
        },
        convites: { where: { status: 'PENDENTE' } },
      },
    });
  }

  async create(data: Prisma.EquipeCreateInput) {
    return this.prisma.equipe.create({ data });
  }

  async addMembro(data: Prisma.MembroEquipeCreateInput) {
    return this.prisma.membroEquipe.create({ data });
  }

  async removeMembro(equipeId: number, userId: number) {
    return this.prisma.membroEquipe.deleteMany({
      where: { equipeId, userId },
    });
  }

  async findConviteByToken(token: string) {
    return this.prisma.conviteEquipe.findUnique({ where: { token } });
  }

  async createConvite(data: Prisma.ConviteEquipeCreateInput) {
    return this.prisma.conviteEquipe.create({ data });
  }

  async updateConviteStatus(id: number, status: string) {
    return this.prisma.conviteEquipe.update({ where: { id }, data: { status } });
  }
}

export const equipeRepository = new EquipeRepository();