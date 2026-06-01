// backend/src/controllers/PrescricaoController.js

const prisma = require('../lib/prisma').default;

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
};

const INTERVALOS_H = {
  '1xDia':    24,
  '12em12h':  12,
  '8em8h':    8,
  '6em6h':    6,
  '4em4h':    4,
  '1em1h':    1,
  '1x2dias':  48,
  '1x3dias':  72,
  '1xSemana': 168,
  '1x21dias': 504,
  '1x30dias': 720,
  '1x90dias': 2160,
};

function gerarHorarios(horaInicio, frequencia, duracaoDias, dataInicio) {
  const intervalH = INTERVALOS_H[frequencia];
  if (!intervalH) return [];

  const [h, m] = horaInicio.split(':').map(Number);
  const start   = new Date(dataInicio);
  start.setHours(h, m, 0, 0);

  const totalMs    = duracaoDias * 24 * 3600 * 1000;
  const intervalMs = intervalH * 3600 * 1000;
  const horarios   = [];
  let cur          = new Date(start);

  while (cur - start < totalMs) {
    horarios.push(cur.toISOString());
    cur = new Date(cur.getTime() + intervalMs);
  }
  return horarios;
}

const PrescricaoController = {

  // GET /clinica/prescricoes/animal/:animalId
  listarPorAnimal: async (req, res) => {
    try {
      const { animalId } = req.params;
      const { page = 1, limit = 10, tipo, status, busca } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const where = { animalId: Number(animalId), ativo: true };
      if (tipo && tipo !== 'TODOS') where.tipo = tipo;
      if (status) where.status = status;
      if (busca) where.medicamento = { contains: busca };

      const [items, total, rascunhos] = await Promise.all([
        prisma.prescricao.findMany({
          where,
          include: INCLUDE,
          orderBy: { dataInicio: 'desc' },
          skip,
          take: Number(limit),
        }),
        prisma.prescricao.count({ where }),
        prisma.prescricao.count({
          where: { animalId: Number(animalId), ativo: true, status: 'RASCUNHO' },
        }),
      ]);

      res.json({ dados: items, total, rascunhos });
    } catch (err) {
      console.error('Erro ao listar prescrições:', err);
      res.status(500).json({ error: 'Erro ao listar prescrições' });
    }
  },

  // POST /clinica/prescricoes
  criar: async (req, res) => {
    try {
      const vet = req.user;
      const {
        animalId, tipo = 'MEDICAMENTO', medicamento, dosagem, unidade,
        via = 'Oral', frequencia, horaInicio, duracaoDias = 1,
        diasAplicacaoInicio = 1, diasAplicacaoFim, observacao, dataInicio,
      } = req.body;

      if (!animalId || !medicamento || !frequencia) {
        return res.status(400).json({ error: 'animalId, medicamento e frequencia são obrigatórios' });
      }

      const inicio    = dataInicio ? new Date(dataInicio) : new Date();
      const fim       = new Date(inicio.getTime() + Number(duracaoDias) * 86400000);
      const horarios  = horaInicio
        ? gerarHorarios(horaInicio, frequencia, Number(duracaoDias), inicio)
        : [];

      const item = await prisma.prescricao.create({
        data: {
          animalId:            Number(animalId),
          veterinarioId:       vet.id,
          tipo,
          medicamento,
          dose:                dosagem ? `${dosagem}${unidade ? ' ' + unidade : ''}` : '',
          dosagem:             dosagem ? String(dosagem) : null,
          unidade:             unidade || null,
          via,
          frequencia,
          duracao:             `${duracaoDias} dias`,
          duracaoDias:         Number(duracaoDias),
          diasAplicacaoInicio: Number(diasAplicacaoInicio),
          diasAplicacaoFim:    diasAplicacaoFim ? Number(diasAplicacaoFim) : null,
          horaInicio:          horaInicio || null,
          observacao:          observacao || null,
          status:              'RASCUNHO',
          dataInicio:          inicio,
          dataFim:             fim,
          horariosGerados:     horarios.length > 0 ? horarios : undefined,
        },
        include: INCLUDE,
      });

      res.json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar prescrição:', err);
      res.status(500).json({ error: 'Erro ao criar prescrição' });
    }
  },

  // PUT /clinica/prescricoes/:id
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        tipo, medicamento, dosagem, unidade, via, frequencia,
        horaInicio, duracaoDias, diasAplicacaoInicio, diasAplicacaoFim,
        observacao, dataInicio,
      } = req.body;

      const inicio   = dataInicio ? new Date(dataInicio) : undefined;
      const fim      = inicio && duracaoDias
        ? new Date(inicio.getTime() + Number(duracaoDias) * 86400000)
        : undefined;
      const horarios = horaInicio && frequencia && duracaoDias && inicio
        ? gerarHorarios(horaInicio, frequencia, Number(duracaoDias), inicio)
        : undefined;

      const data = {};
      if (tipo              !== undefined) data.tipo                 = tipo;
      if (medicamento       !== undefined) data.medicamento          = medicamento;
      if (dosagem           !== undefined) { data.dosagem = String(dosagem); data.dose = `${dosagem}${unidade ? ' ' + unidade : ''}`; }
      if (unidade           !== undefined) data.unidade              = unidade;
      if (via               !== undefined) data.via                  = via;
      if (frequencia        !== undefined) data.frequencia           = frequencia;
      if (duracaoDias       !== undefined) { data.duracaoDias = Number(duracaoDias); data.duracao = `${duracaoDias} dias`; }
      if (diasAplicacaoInicio !== undefined) data.diasAplicacaoInicio = Number(diasAplicacaoInicio);
      if (diasAplicacaoFim  !== undefined) data.diasAplicacaoFim    = diasAplicacaoFim ? Number(diasAplicacaoFim) : null;
      if (horaInicio        !== undefined) data.horaInicio           = horaInicio;
      if (observacao        !== undefined) data.observacao           = observacao;
      if (inicio            !== undefined) data.dataInicio           = inicio;
      if (fim               !== undefined) data.dataFim              = fim;
      if (horarios          !== undefined) data.horariosGerados      = horarios;

      const item = await prisma.prescricao.update({
        where: { id: Number(id) },
        data,
        include: INCLUDE,
      });
      res.json({ dados: item });
    } catch (err) {
      console.error('Erro ao atualizar prescrição:', err);
      res.status(500).json({ error: 'Erro ao atualizar prescrição' });
    }
  },

  // DELETE /clinica/prescricoes/:id
  excluir: async (req, res) => {
    try {
      await prisma.prescricao.update({
        where: { id: Number(req.params.id) },
        data:  { ativo: false },
      });
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao excluir prescrição:', err);
      res.status(500).json({ error: 'Erro ao excluir prescrição' });
    }
  },

  // POST /clinica/prescricoes/finalizar-uma/:id
  finalizarUma: async (req, res) => {
    try {
      const { id } = req.params;
      const vet = req.user;

      const prescricao = await prisma.prescricao.findFirst({
        where: { id: Number(id), ativo: true },
      });

      if (!prescricao) return res.status(404).json({ error: 'Prescrição não encontrada' });
      if (prescricao.status !== 'RASCUNHO') {
        return res.status(400).json({ error: 'Apenas rascunhos podem ser finalizados' });
      }

      await prisma.prescricao.update({ where: { id: Number(id) }, data: { status: 'ATIVA' } });

      // Busca o proprietário do animal para criar fatura por proprietário
      const animal = await prisma.animal.findUnique({
        where:  { id: prescricao.animalId },
        select: { userId: true },
      });
      const proprietarioId = animal?.userId;
      const mesRef = new Date().toISOString().slice(0, 7);

      let fatura = proprietarioId
        ? await prisma.fatura.findFirst({ where: { proprietarioId, status: 'ABERTA' }, orderBy: { criadoEm: 'desc' } })
        : await prisma.fatura.findFirst({ where: { animalId: prescricao.animalId, status: 'ABERTA' }, orderBy: { criadoEm: 'desc' } });

      if (!fatura) {
        fatura = await prisma.fatura.create({
          data: proprietarioId
            ? { proprietarioId, mesReferencia: mesRef, total: 0, status: 'ABERTA' }
            : { animalId: prescricao.animalId, total: 0, status: 'ABERTA' },
        });
      }

      const descricao = prescricao.tipo === 'MEDICAMENTO'
        ? [prescricao.medicamento, prescricao.dosagem ? `${prescricao.dosagem}${prescricao.unidade || ''}` : null, prescricao.via ? `(${prescricao.via})` : null]
            .filter(Boolean).join(' ')
        : `Procedimento: ${prescricao.medicamento}`;

      await prisma.faturaItem.create({
        data: { faturaId: fatura.id, animalId: prescricao.animalId, tipo: prescricao.tipo, descricao, valor: 0, quantidade: 1, veterinarioId: vet.id },
      });

      const itens = await prisma.faturaItem.findMany({ where: { faturaId: fatura.id } });
      const total = itens.reduce((sum, i) => sum + i.valor * i.quantidade, 0);
      await prisma.fatura.update({ where: { id: fatura.id }, data: { total } });

      res.json({ dados: { finalizado: 1 } });
    } catch (err) {
      console.error('Erro ao finalizar prescrição:', err);
      res.status(500).json({ error: 'Erro ao finalizar prescrição' });
    }
  },

  // POST /clinica/prescricoes/finalizar/:animalId
  finalizarTodas: async (req, res) => {
    try {
      const { animalId } = req.params;
      const vet = req.user;

      const rascunhos = await prisma.prescricao.findMany({
        where: { animalId: Number(animalId), ativo: true, status: 'RASCUNHO' },
      });

      if (rascunhos.length === 0) {
        return res.status(400).json({ error: 'Nenhum rascunho para finalizar' });
      }

      await prisma.prescricao.updateMany({
        where: { id: { in: rascunhos.map(r => r.id) } },
        data:  { status: 'ATIVA' },
      });

      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { userId: true },
      });
      const proprietarioId = animal?.userId;
      const mesRef = new Date().toISOString().slice(0, 7);

      let fatura = proprietarioId
        ? await prisma.fatura.findFirst({ where: { proprietarioId, status: 'ABERTA' }, orderBy: { criadoEm: 'desc' } })
        : await prisma.fatura.findFirst({ where: { animalId: Number(animalId), status: 'ABERTA' }, orderBy: { criadoEm: 'desc' } });

      if (!fatura) {
        fatura = await prisma.fatura.create({
          data: proprietarioId
            ? { proprietarioId, mesReferencia: mesRef, total: 0, status: 'ABERTA' }
            : { animalId: Number(animalId), total: 0, status: 'ABERTA' },
        });
      }

      for (const r of rascunhos) {
        const descricao = r.tipo === 'MEDICAMENTO'
          ? [r.medicamento, r.dosagem ? `${r.dosagem}${r.unidade || ''}` : null, r.via ? `(${r.via})` : null]
              .filter(Boolean).join(' ')
          : `Procedimento: ${r.medicamento}`;

        await prisma.faturaItem.create({
          data: {
            faturaId:      fatura.id,
            animalId:      Number(animalId),
            tipo:          r.tipo,
            descricao,
            valor:         0,
            quantidade:    1,
            veterinarioId: vet.id,
          },
        });
      }

      const itens = await prisma.faturaItem.findMany({ where: { faturaId: fatura.id } });
      const total = itens.reduce((sum, i) => sum + i.valor * i.quantidade, 0);
      await prisma.fatura.update({ where: { id: fatura.id }, data: { total } });

      res.json({ dados: { finalizado: rascunhos.length } });
    } catch (err) {
      console.error('Erro ao finalizar prescrições:', err);
      res.status(500).json({ error: 'Erro ao finalizar prescrições' });
    }
  },
};

module.exports = PrescricaoController;