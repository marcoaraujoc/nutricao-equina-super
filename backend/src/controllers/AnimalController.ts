import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AnimalController {
  // Listar todos os cavalos
  async listar(req: Request, res: Response) {
    const animais = await prisma.animal.findMany({
      orderBy: { dataCadastro: 'desc' }
    });
    res.json(animais);
  }

  // Criar novo cavalo
  async criar(req: Request, res: Response) {
    const { nome, raca, peso, idade, sexo, tipoExercicio } = req.body;

    const animal = await prisma.animal.create({
      data: {
        nome,
        raca,
        peso: parseFloat(peso),
        dataNascimento: idade ? new Date(Date.now() - idade * 365 * 24 * 60 * 60 * 1000) : null,
        sexo,
        tipoExercicio
      }
    });

    res.status(201).json(animal);
  }
}
