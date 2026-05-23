import { Prisma } from '@prisma/client';
import { BaseRepository } from './BaseRepository';

export class UserRepository extends BaseRepository {
  async findById(id: number) {
    return this.prisma.user.findUnique({
      where: { id, ativo: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findAll(where?: Prisma.UserWhereInput) {
    return this.prisma.user.findMany({
      where:   { ativo: true, ...where },
      select: {
        id: true, fullName: true, email: true, phone: true,
        role: true, userType: true, createdAt: true, ativo: true,
        mustChangePassword: true,
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  async update(id: number, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }

  async softDelete(id: number) {
    return this.prisma.user.update({ where: { id }, data: { ativo: false } });
  }

  async findByResetToken(token: string) {
    return this.prisma.user.findUnique({
      where: { resetPasswordToken: token },
    });
  }
}

export const userRepository = new UserRepository();