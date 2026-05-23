import { Prisma } from '@prisma/client';
import { BaseRepository } from './BaseRepository';

export class AnimalRepository extends BaseRepository {
  async findById(id: number) {
    return this.prisma.animal.findUnique({
      where: { id, ativo: true },
      include: {
        especie: true,
        raca:    true,
        user:    { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async findByUserId(userId: number) {
    return this.prisma.animal.findMany({
      where:   { userId, ativo: true },
      include: { especie: true, raca: true },
      orderBy: { nome: 'asc' },
    });
  }

  async findAll(where?: Prisma.AnimalWhereInput) {
    return this.prisma.animal.findMany({
      where:   { ativo: true, ...where },
      include: { especie: true, raca: true, user: { select: { id: true, fullName: true } } },
      orderBy: { nome: 'asc' },
    });
  }

  async create(data: Prisma.AnimalCreateInput) {
    return this.prisma.animal.create({ data });
  }

  async update(id: number, data: Prisma.AnimalUpdateInput) {
    return this.prisma.animal.update({ where: { id }, data });
  }

  async softDelete(id: number) {
    return this.prisma.animal.update({ where: { id }, data: { ativo: false } });
  }

  async updatePhoto(id: number, photoUrl: string) {
    return this.prisma.animal.update({ where: { id }, data: { photoUrl } });
  }
}

export const animalRepository = new AnimalRepository();