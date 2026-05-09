const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AnimalController {
  async listar(req, res) {
    console.log('🔍 [LISTAR] === INÍCIO DA REQUISIÇÃO ===');
    console.log('🔍 [LISTAR] req.user.id:', req.user?.id);

    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const animais = await prisma.animal.findMany({
        where: { userId: Number(userId) },
        include: { 
          especie: true, 
          raca: true,
          user: { select: { fullName: true, email: true } }
        }
      });

      console.log(`✅ [LISTAR] Retornando ${animais.length} animais`);
      res.json(animais);
    } catch (error) {
      console.error('❌ Erro no listar animais:', error);
      res.status(500).json({ error: 'Erro ao listar animais', details: error.message });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const animal = await prisma.animal.findUnique({
        where: { id: Number(id) },
        include: { 
          especie: true, 
          raca: true,
          user: { select: { fullName: true, email: true } }
        }
      });

      if (!animal) return res.status(404).json({ error: 'Animal não encontrado' });
      
      res.json(animal);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar animal' });
    }
  }

async criar(req, res) {
  const { 
    nome, 
    especieId, 
    racaId, 
    peso, 
    dataNascimento, 
    sexo, 
    exercise 
  } = req.body;

  if (!racaId || isNaN(Number(racaId))) {
    return res.status(400).json({ error: 'Raça é obrigatória' });
  }
  if (!especieId) {
    return res.status(400).json({ error: 'Espécie é obrigatória' });
  }

  // ✅ NOVA VALIDAÇÃO CONDICIONAL
  if (!especieId) {
    return res.status(400).json({ error: 'Espécie é obrigatória' });
  }

  // Verifica se é equino
  const especie = await prisma.especie.findUnique({
    where: { id: Number(especieId) }
  });

  const isEquino = especie && 
    (especie.nome.toLowerCase().includes('equino') || 
     especie.nome.toLowerCase().includes('animal'));

  // Só exige exercise se for equino
  if (isEquino && (!exercise || exercise.trim() === '')) {
    return res.status(400).json({ error: 'Nível de exercício é obrigatório para equinos' });
  }

  try {
    let photoUrl = null;
    if (req.file) {
      photoUrl = `/uploads/${req.file.filename}`;
    }

    const animal = await prisma.animal.create({
      data: {
        nome,
        peso: parseFloat(peso) || 0,
        dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
        sexo,
        exercise: isEquino ? exercise : null,   // ← Salva null para outras espécies
        photoUrl,
        especieId: Number(especieId),
        racaId: Number(racaId),
        userId: req.user?.id
      }
    });

    console.log('✅ Animal criado com sucesso ID:', animal.id);
    res.status(201).json(animal);
  } catch (error) {
    console.error('❌ Erro ao criar animal:', error);
    res.status(500).json({ error: 'Erro ao criar animal', details: error.message });
  }
}

async atualizar(req, res) {
  const { id } = req.params;
  const { 
    nome, 
    especieId, 
    racaId, 
    peso, 
    dataNascimento, 
    sexo, 
    exercise 
  } = req.body;

  // ✅ Validações
  if (!nome?.trim()) {
    return res.status(400).json({ error: 'Nome do animal é obrigatório' });
  }
  if (!racaId || isNaN(Number(racaId))) {
    return res.status(400).json({ error: 'Raça é obrigatória' });
  }
  if (!especieId) {
    return res.status(400).json({ error: 'Espécie é obrigatória' });
  }

  // Validação condicional de exercise (equino)
  const especie = await prisma.especie.findUnique({
    where: { id: Number(especieId) }
  });

  const isEquino = especie && 
    (especie.nome.toLowerCase().includes('equino') || 
     especie.nome.toLowerCase().includes('animal'));

  if (isEquino && (!exercise || exercise.trim() === '')) {
    return res.status(400).json({ error: 'Nível de exercício é obrigatório para equinos' });
  }

  try {
    let photoUrl = undefined;
    if (req.file) {
      photoUrl = `/uploads/${req.file.filename}`;
    }

    const animal = await prisma.animal.update({
      where: { id: Number(id) },
      data: {
        nome: nome.trim(),
        peso: parseFloat(peso) || 0,
        dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
        sexo,
        exercise: isEquino ? exercise : null,
        especieId: Number(especieId),
        racaId: Number(racaId),
        ...(photoUrl && { photoUrl })
      }
    });

    console.log('✅ Animal atualizado com sucesso ID:', animal.id);
    res.json(animal);
  } catch (error) {
    console.error('❌ Erro ao atualizar animal:', error);
    res.status(500).json({ error: 'Erro ao atualizar animal', details: error.message });
  }
}

  async excluir(req, res) {
    const { id } = req.params;
    try {
      // Removemos a deleção de AnimalExercise pois a tabela não existe mais
      await prisma.dieta.deleteMany({ where: { animalId: Number(id) } });
      await prisma.animal.delete({ where: { id: Number(id) } });

      console.log(`✅ Animal ID ${id} excluído com sucesso`);
      res.json({ message: 'Animal excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir animal:', error);
      res.status(500).json({ 
        error: 'Erro ao excluir animal', 
        details: error.message 
      });
    }
  }
}

module.exports = new AnimalController();