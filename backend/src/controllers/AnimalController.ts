import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const listar = async (req: any, res: Response) => {
  console.log('🔍 [ANIMAL LISTAR] Usuário autenticado:', req.user);
  console.log('🔍 [ANIMAL LISTAR] Headers:', req.headers.authorization ? 'Token presente' : 'SEM TOKEN');

  try {
    const whereClause = req.user?.id 
      ? { userId: req.user.id } 
      : {};

    console.log('🔍 [ANIMAL LISTAR] Where clause aplicado:', whereClause);

    const animais = await prisma.animal.findMany({
      where: whereClause,
      orderBy: { dataCadastro: 'desc' },
      include: {
        especie: true,
        raca: true,
        exercises: true
      }
    });

    console.log(`🔍 [ANIMAL LISTAR] Retornando ${animais.length} animais`);

    res.json(animais);
  } catch (error: any) {
    console.error('❌ Erro no listar:', error);
    res.status(500).json({ error: 'Erro ao listar animais' });
  }
};

const criar = async (req: any, res: Response) => {
  console.log('🔍 [ANIMAL CRIAR] Usuário:', req.user?.id);
  console.log('🔍 [ANIMAL CRIAR] Body:', req.body);

  try {
    const { nome, especieId, racaId, peso, dataNascimento, sexo, exercises = [] } = req.body;

    const animal = await prisma.animal.create({
      data: {
        nome,
        especieId: parseInt(especieId),
        racaId: racaId ? parseInt(racaId) : null,
        peso: parseFloat(peso),
        dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
        sexo,
        userId: req.user?.id
      }
    });

    console.log('✅ Animal criado com ID:', animal.id, 'UserID:', req.user?.id);

    if (exercises && exercises.length > 0) {
      for (const ex of exercises) {
        await prisma.animalExercise.create({
          data: {
            animalId: animal.id,
            tipo: ex.tipo,
            periodicidade: ex.periodicidade
          }
        });
      }
    }

    res.status(201).json(animal);
  } catch (error: any) {
    console.error('❌ Erro no criar:', error);
    res.status(500).json({ error: 'Erro ao criar animal' });
  }
};

export { listar, criar };