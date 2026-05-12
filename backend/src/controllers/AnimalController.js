const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AnimalController {
  async listar(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ sucesso: false, mensagem: 'Usuário não autenticado' });
      }

      const animais = await prisma.animal.findMany({
        where: { userId: Number(userId) },
        include: {
          especie: true,
          raca: true,
          user: { select: { fullName: true, email: true } },
        },
        orderBy: { dataCadastro: 'desc' },
      });

      res.json({ sucesso: true, dados: animais });
    } catch (error) {
      console.error('Erro ao listar animais:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar animais' });
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
          user: { select: { fullName: true, email: true } },
        },
      });

      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('Erro ao buscar animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar animal' });
    }
  }

  async criar(req, res) {
    const {
      nome,
      especieId,
      racaId,
      peso,
      dataNascimento,
      idadeAnos,
      sexo,
      categoriaAnimal,
      tipoExercicio,
      veterinarioNome,
      veterinarioClinica,
    } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    }
    if (!especieId) {
      return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    }
    if (!racaId || isNaN(Number(racaId))) {
      return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    }
    if (!dataNascimento && !idadeAnos) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Informe a data de nascimento ou a idade do animal',
      });
    }

    try {
      const especie = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino =
        especie &&
        (especie.nome.toLowerCase().includes('equino') ||
          especie.nome.toLowerCase().includes('cavalo'));

      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso: false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let photoUrl = null;
      if (req.file) photoUrl = `/uploads/${req.file.filename}`;

      const animal = await prisma.animal.create({
        data: {
          nome: nome.trim(),
          peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos: dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          photoUrl,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          userId:    req.user?.id,
        },
      });

      res.status(201).json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('Erro ao criar animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao criar animal' });
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
      idadeAnos,
      sexo,
      categoriaAnimal,
      tipoExercicio,
      veterinarioNome,
      veterinarioClinica,
    } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    }
    if (!especieId) {
      return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    }
    if (!racaId || isNaN(Number(racaId))) {
      return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    }
    if (!dataNascimento && !idadeAnos) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Informe a data de nascimento ou a idade do animal',
      });
    }

    try {
      const especie = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino =
        especie &&
        (especie.nome.toLowerCase().includes('equino') ||
          especie.nome.toLowerCase().includes('cavalo'));

      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso: false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let photoUrl = undefined;
      if (req.file) photoUrl = `/uploads/${req.file.filename}`;

      const animal = await prisma.animal.update({
        where: { id: Number(id) },
        data: {
          nome: nome.trim(),
          peso: parseFloat(peso) || 0,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos: dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          ...(photoUrl && { photoUrl }),
        },
      });

      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('Erro ao atualizar animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao atualizar animal' });
    }
  }

  async excluir(req, res) {
    const { id } = req.params;
    try {
      await prisma.dieta.deleteMany({ where: { animalId: Number(id) } });
      await prisma.animal.delete({ where: { id: Number(id) } });
      res.json({ sucesso: true, mensagem: 'Animal excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir animal:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir animal' });
    }
  }
}

module.exports = new AnimalController();