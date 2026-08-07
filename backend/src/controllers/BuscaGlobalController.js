// backend/src/controllers/BuscaGlobalController.js
// Busca global do header — pacientes, atendimentos (evoluções) e agendamentos.
//
// ESCOPO: SEMPRE a empresa do contexto ativo. Nunca "todos os vínculos do usuário":
// o mesmo profissional atende em várias clínicas e a busca do header não pode
// devolver paciente/atendimento de OUTRA empresa (vazamento entre tenants). Por isso
// o escopo de animal do contexto (`buildAnimalScopeWhere`, que na base própria inclui
// vínculos de qualquer empresa) é INTERSECTADO com `req.empresaId` aqui.
//
// PERMISSÃO: a rota não pode ser gateada por um slug único (atravessa 3 módulos), então
// o gate é POR GRUPO — cada bloco só entra no resultado se o usuário tiver o `*.ler`
// correspondente, resolvido em runtime por getNivelEfetivo.
'use strict';

const prisma = require('../lib/prisma').default;
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { escopoEvolucaoWhere, semEscopoDeEmpresa } = require('../lib/clinicalScope');
const { ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { getNivelEfetivo, NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { formatAtendimentoNum } = require('../lib/faturaUtils');

// Abaixo disso a busca casa com quase tudo e o custo não se paga
const MIN_TERMO        = 2;
const LIMITE_POR_GRUPO = 5;
const LIMITE_MAXIMO    = 10;

const podeLer = (nivel) => (NIVEL_ORDINAL[nivel] ?? 0) >= NIVEL_ORDINAL.LEITURA;

const VAZIO = { pacientes: [], atendimentos: [], agendamentos: [] };

const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : null);

const BuscaGlobalController = {

  // GET /api/busca?q=termo&limit=5
  buscar: async (req, res) => {
    try {
      const termo = (req.query.q ?? '').toString().trim();
      if (termo.length < MIN_TERMO) return res.json({ dados: VAZIO, total: 0 });

      const limite = Math.min(Number(req.query.limit) || LIMITE_POR_GRUPO, LIMITE_MAXIMO);
      const like   = { contains: termo, mode: 'insensitive' };
      const userId = Number(req.user.id);

      const [nivelAnimais, nivelEvolucoes, nivelAgendamentos] = await Promise.all([
        getNivelEfetivo(req, 'animais.ler'),
        getNivelEfetivo(req, 'atendimento.evolucoes.ler'),
        getNivelEfetivo(req, 'atendimento.agendamentos.ler'),
      ]);

      const verPacientes    = podeLer(nivelAnimais);
      const verAtendimentos = podeLer(nivelEvolucoes);
      const verAgendamentos = podeLer(nivelAgendamentos);
      if (!verPacientes && !verAtendimentos && !verAgendamentos) {
        return res.json({ dados: VAZIO, total: 0 });
      }

      // Escopo de animal do contexto ∩ empresa ativa (ver cabeçalho)
      //
      // FAIL-CLOSED: sem `req.empresaId` o spread sumia e sobrava só o `escopoAnimal`,
      // que na BASE PRÓPRIA inclui vínculos de QUALQUER empresa (regra §5) — a busca do
      // header passava a achar paciente de outra clínica. Os três blocos (pacientes,
      // atendimentos, agenda) dependem deste mesmo `animalNoEscopo`, então é aqui que
      // o tenant precisa ser inegociável. `-1` não casa com empresa alguma.
      const ehAdminPlataforma = req.user?.role === 'ADMIN' || req.user?.userType === 'ADMIN';
      const { where: escopoAnimal } = await buildAnimalScopeWhere(req);
      const animalNoEscopo = {
        AND: [
          escopoAnimal,
          // EXCLUSÃO LÓGICA (lib/visibilidade.js): `{ ativo: true, user: { ativo: true } }`.
          // O `ativo` do animal já estava aqui; faltava o do CLIENTE. Como os TRÊS grupos
          // da busca (pacientes, atendimentos, agenda) partem deste mesmo objeto, o
          // paciente inativado — ou o do cliente inativado — some dos três de uma vez.
          ANIMAL_VISIVEL,
          ...(ehAdminPlataforma && !req.empresaId
            ? []
            : [{ empresaId: req.empresaId ? Number(req.empresaId) : -1 }]),
        ],
      };

      // AgendamentoClinico tem empresaId/veterinarioId próprios, como a evolução —
      // mesmo critério do escopo clínico (empresa do contexto + os próprios registros).
      // Mesma correção de lib/clinicalScope: o bypass do GESTOR vale para AUTORIA,
      // não para TENANT — ele vê o que qualquer membro agendou, dentro da empresa dele.
      const escopoAgenda = semEscopoDeEmpresa(req)
        ? {}
        : req.empresaId
          ? (req.membroCargo === 'GESTOR'
              // `tb_agendamentos_clinicos.empresa_id` é NOT NULL desde a fase 5.
              ? { empresaId: Number(req.empresaId) }
              : { OR: [{ empresaId: Number(req.empresaId) }, { veterinarioId: userId }] })
          : { veterinarioId: userId };

      const [animais, evolucoes, agendamentos] = await Promise.all([
        verPacientes
          ? prisma.animal.findMany({
              where: {
                ...animalNoEscopo,
                OR: [{ nome: like }, { baia: like }, { registroPassaporte: like }],
              },
              select: {
                id: true, nome: true, baia: true, photoUrl: true,
                especie:     { select: { nome: true } },
                raca:        { select: { nome: true } },
                localizacao: { select: { nome: true } },
                local:       true,
              },
              orderBy: { nome: 'asc' },
              take: limite,
            })
          : [],

        verAtendimentos
          ? prisma.evolucaoClinica.findMany({
              where: {
                ativo:  true,
                animal: animalNoEscopo,
                AND:    [escopoEvolucaoWhere(req)],
                OR:     [{ titulo: like }, { texto: like }, { especialidade: like }],
              },
              select: {
                id: true, titulo: true, especialidade: true, status: true,
                dataInicio: true, numero: true, tipoAtendimento: true, animalId: true,
                animal: { select: { nome: true } },
              },
              orderBy: { dataInicio: 'desc' },
              take: limite,
            })
          : [],

        verAgendamentos
          ? prisma.agendamentoClinico.findMany({
              where: {
                ativo:  true,
                animal: animalNoEscopo,
                AND:    [escopoAgenda],
                OR:     [{ titulo: like }, { observacao: like }],
              },
              select: {
                id: true, titulo: true, tipo: true, status: true,
                dataHora: true, animalId: true,
                animal: { select: { nome: true } },
              },
              orderBy: { dataHora: 'desc' },
              take: limite,
            })
          : [],
      ]);

      // `rota` vem pronta do backend: o front só navega, sem replicar regra de rota.
      const dados = {
        pacientes: animais.map((a) => ({
          id:        a.id,
          titulo:    a.nome,
          subtitulo: [
            a.especie?.nome,
            a.raca?.nome,
            a.baia ? `Baia ${a.baia}` : null,
            a.localizacao?.nome ?? a.local,
          ].filter(Boolean).join(' · '),
          photoUrl:  a.photoUrl,
          rota:      `/animal/${a.id}`,
        })),

        atendimentos: evolucoes.map((e) => ({
          id:        e.id,
          titulo:    e.titulo?.trim() || e.especialidade || 'Evolução clínica',
          subtitulo: [
            formatAtendimentoNum(e.tipoAtendimento, e.numero),
            e.animal?.nome,
            dataBR(e.dataInicio),
          ].filter(Boolean).join(' · '),
          status:    e.status,
          rota:      `/clinica/evolucao/${e.animalId}`,
        })),

        agendamentos: agendamentos.map((g) => ({
          id:        g.id,
          titulo:    g.titulo,
          subtitulo: [
            g.animal?.nome,
            g.dataHora ? new Date(g.dataHora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null,
          ].filter(Boolean).join(' · '),
          status:    g.status,
          rota:      `/animal/${g.animalId}`,
        })),
      };

      const total = dados.pacientes.length + dados.atendimentos.length + dados.agendamentos.length;
      res.json({ dados, total });
    } catch (err) {
      console.error('Erro na busca global:', err);
      res.status(500).json({ error: 'Erro ao buscar' });
    }
  },
};

module.exports = BuscaGlobalController;
