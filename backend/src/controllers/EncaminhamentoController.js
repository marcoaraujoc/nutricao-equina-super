// backend/src/controllers/EncaminhamentoController.js
// Encaminhamentos clínicos — destino pode ser um prestador da equipe (User FORNECEDOR)
// ou um profissional externo (texto livre). Encaminhar para prestador da equipe cria/
// reativa uma DesignacaoPrestador, que é o escopo de acesso do prestador ao animal.

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { corteDePropriedade } = require('../lib/animalPropriedadeCorte');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria, registrarAlteracao, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');
const { animalEstaInativo, bloquearSeAnimalInativo } = require('../lib/animalInativo');
const { animalFoiExcluido } = require('../lib/animalAtivacao');
const { garantirEspecialidadeDaEmpresa } = require('../lib/catalogoManual');

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
  prestador:   { select: { id: true, fullName: true } },
};

const STATUS_VALIDOS = ['PENDENTE', 'CONCLUIDO', 'CANCELADO'];

/**
 * Resolve as equipes do escopo do animal:
 *  - animal.equipeId definido → só ela
 *  - senão, todas as equipes da empresa do animal (legado sem equipeId)
 *  - senão, a equipe do contexto ativo (paciente pessoal do vet)
 */
async function getEquipeIdsDoAnimal(animal, reqEquipeId) {
  if (animal.equipeId) return [animal.equipeId];
  if (animal.empresaId) {
    const equipes = await prisma.equipe.findMany({
      where:  { empresaId: animal.empresaId },
      select: { id: true },
    });
    return equipes.map(e => e.id);
  }
  return reqEquipeId ? [Number(reqEquipeId)] : [];
}

const EncaminhamentoController = {

  // GET /clinica/encaminhamentos/:id
  obterPorId: async (req, res) => {
    try {
      const item = await prisma.encaminhamentoClinico.findUnique({
        where:   { id: Number(req.params.id) },
        include: INCLUDE,
      });
      if (!item) return res.status(404).json({ error: 'Encaminhamento não encontrado' });
      res.json({ dados: item });
    } catch (err) {
      console.error('Erro ao obter encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao obter encaminhamento' });
    }
  },

  // GET /clinica/encaminhamentos/animal/:animalId
  listarPorAnimal: async (req, res) => {
    try {
      const { animalId } = req.params;
      const { status } = req.query;

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Transferência de Propriedade — o PROPRIETÁRIO atual só vê o que foi
      // encaminhado a partir de `propriedadeDesde`; GESTOR/VET/ADMIN veem tudo.
      const animalCorte = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { propriedadeDesde: true } });
      const corte = corteDePropriedade(req, animalCorte);

      const where = { animalId: Number(animalId), ativo: true, ...(corte ? { dataEncaminhamento: { gte: corte } } : {}) };
      if (status && status !== 'TODOS') where.status = status;
      // Segregação multi-clínica: cada empresa vê só os próprios encaminhamentos
      where.AND = [escopoFilhoEvolucaoWhere(req)];

      const [items, total] = await Promise.all([
        prisma.encaminhamentoClinico.findMany({
          where,
          include: INCLUDE,
          orderBy: { dataEncaminhamento: 'desc' },
        }),
        prisma.encaminhamentoClinico.count({ where }),
      ]);

      // Justificativa do CANCELAMENTO — o registro não tem coluna própria para isso
      // (o `motivo` que ele já tem é o do ENCAMINHAMENTO em si, preenchido na criação);
      // o texto do cancelamento só existe no AuditLog, gravado por `atualizarStatus`.
      // Sem migration: um SELECT pontual, só para os cancelados da página.
      const idsCancelados = items.filter(it => it.status === 'CANCELADO').map(it => it.id);
      let dados = items;
      if (idsCancelados.length > 0) {
        const logs = await prisma.auditLog.findMany({
          where:   { categoria: 'CANCELAMENTO', entidade: 'ENCAMINHAMENTO', entidadeId: { in: idsCancelados } },
          orderBy: { timestamp: 'desc' },
          select:  { entidadeId: true, motivo: true },
        });
        const motivoPorId = new Map();
        for (const log of logs) if (!motivoPorId.has(log.entidadeId)) motivoPorId.set(log.entidadeId, log.motivo);
        dados = items.map(it => it.status === 'CANCELADO'
          ? { ...it, justificativaCancelamento: motivoPorId.get(it.id) ?? null }
          : it);
      }

      res.json({ dados, total });
    } catch (err) {
      console.error('Erro ao listar encaminhamentos:', err);
      res.status(500).json({ error: 'Erro ao listar encaminhamentos' });
    }
  },

  // GET /clinica/encaminhamentos/prestadores/:animalId
  // Especialistas das equipes do escopo do animal para encaminhamento interno:
  //  - FORNECEDOR (prestador externo): especialidade via cadastro Fornecedor + catálogo;
  //    encaminhar cria/reativa DesignacaoPrestador (escopo de acesso ao animal).
  //  - VETERINARIO: especialidade via catálogo (UsuarioEspecialidade); já tem acesso de
  //    equipe, então encaminhar NÃO cria designação (precisaDesignacao=false).
  listarPrestadores: async (req, res) => {
    try {
      const { animalId } = req.params;

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { equipeId: true, empresaId: true },
      });
      if (!animal) return res.status(404).json({ error: 'Animal não encontrado' });

      const equipeIds = await getEquipeIdsDoAnimal(animal, req.equipeId);

      const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

      const [membros, servicosFornecedor] = await Promise.all([
        equipeIds.length === 0
          ? Promise.resolve([])
          : prisma.membroEquipe.findMany({
              where: {
                equipeId: { in: equipeIds },
                OR: [
                  { cargo: 'FORNECEDOR' },  { cargos: { has: 'FORNECEDOR' } },
                  { cargo: 'VETERINARIO' }, { cargos: { has: 'VETERINARIO' } },
                ],
                user: { ativo: true },
              },
              select: {
                equipeId: true,
                cargo:    true,
                cargos:   true,
                user: { select: { id: true, fullName: true, email: true, phone: true } },
              },
            }),
        prisma.fornecedor.findMany({
          where: {
            ativo: true,
            tipoEntrada: 'CLIENTE',
            empresaId: req.empresaId ?? null,
          },
          select: { tipoServico: true },
        }),
      ]);

      const EXCLUIR_SERVICOS = new Set([
        'clinico', 'clinica', 'farmacia', 'loja', 'supermercado', 'laboratorio',
      ]);

      const servicosSet = new Set();
      for (const f of servicosFornecedor) {
        if (!f.tipoServico) continue;
        for (const s of f.tipoServico.split(',')) {
          const nome = s.trim();
          if (nome && !EXCLUIR_SERVICOS.has(normalizar(nome))) servicosSet.add(nome);
        }
      }
      const servicosDisponiveis = [...servicosSet]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

      if (equipeIds.length === 0) return res.json({ dados: [], servicosDisponiveis });

      const userIds = [...new Set(membros.map(m => m.user.id))];

      const [fornecedores, designacoes, userEspecs, fornecedorEspecs] = await Promise.all([
        prisma.fornecedor.findMany({
          where:  { userId: { in: userIds } },
          select: { id: true, userId: true, tipoServico: true },
        }),
        prisma.designacaoPrestador.findMany({
          where:  { animalId: Number(animalId), prestadorId: { in: userIds }, ativo: true },
          select: { prestadorId: true },
        }),
        // Especialidades do catálogo (UsuarioEspecialidade) — membro incluído na equipe
        // com especialidade aparece mesmo sem/além do tipoServico do cadastro Fornecedor.
        // ESCOPADO À EMPRESA: a especialidade é POR EMPRESA (migration 20260807000000) —
        // sem o filtro, o prestador que é ortopedista em OUTRA clínica aparecia aqui como
        // ortopedista. Vínculo legado (empresaId null) continua valendo, senão o cadastro
        // anterior à migration sumiria da tela.
        prisma.usuarioEspecialidade.findMany({
          where: {
            userId: { in: userIds },
            ...(req.empresaId
              // `tb_usuario_especialidades.empresa_id` é NOT NULL desde a fase 5.
              ? { empresaId: Number(req.empresaId) }
              : {}),
          },
          select: { userId: true, especialidade: { select: { nome: true } } },
        }),
        // Especialidades gravadas no CADASTRO de Fornecedor (FornecedorEspecialidade,
        // usado quando o cadastro foi feito por /cadastro/fornecedores) — sem isso, um
        // prestador com 2+ especialidades cadastradas por lá só aparecia com a 1ª (a
        // única que o campo legado Fornecedor.tipoServico armazena).
        prisma.fornecedorEspecialidade.findMany({
          where:  { fornecedor: { userId: { in: userIds } } },
          select: { fornecedor: { select: { userId: true } }, especialidade: { select: { nome: true } } },
        }),
      ]);

      const tipoPorUser  = new Map(fornecedores.map(f => [f.userId, f.tipoServico]));
      const designadoSet = new Set(designacoes.map(d => d.prestadorId));
      const especPorUser = new Map();
      const addEspec = (userId, nome) => {
        nome = nome?.trim();
        if (!userId || !nome) return;
        const arr = especPorUser.get(userId) ?? [];
        arr.push(nome);
        especPorUser.set(userId, arr);
      };
      for (const ue of userEspecs) addEspec(ue.userId, ue.especialidade?.nome);
      for (const fe of fornecedorEspecs) addEspec(fe.fornecedor?.userId, fe.especialidade?.nome);

      const vistos = new Set();
      const dados  = [];
      for (const m of membros) {
        if (vistos.has(m.user.id)) continue;
        vistos.add(m.user.id);
        // Une tipoServico do cadastro Fornecedor (legado, pode ser CSV) com as
        // especialidades do catálogo do usuário — sem duplicar nomes
        const servicos = [...new Set([
          ...String(tipoPorUser.get(m.user.id) ?? '').split(',').map(s => s.trim()).filter(Boolean),
          ...(especPorUser.get(m.user.id) ?? []),
        ])];
        for (const s of servicos) {
          if (!EXCLUIR_SERVICOS.has(normalizar(s))) servicosSet.add(s);
        }
        // FORNECEDOR precisa de designação (escopo de acesso ao animal); VETERINARIO
        // já tem acesso de equipe — encaminhar não altera acesso.
        const precisaDesignacao =
          m.cargo === 'FORNECEDOR' || (m.cargos ?? []).includes('FORNECEDOR');
        // Vet sem nenhuma especialidade não é "especialista" — não entra na lista
        // (fornecedor entra mesmo sem, para não regredir o comportamento anterior).
        if (!precisaDesignacao && servicos.length === 0) continue;
        dados.push({
          userId:      m.user.id,
          fullName:    m.user.fullName,
          email:       m.user.email,
          phone:       m.user.phone,
          tipoServico: servicos.join(', ') || null,
          servicos,
          equipeId:    m.equipeId,
          precisaDesignacao,
          jaDesignado: precisaDesignacao && designadoSet.has(m.user.id),
        });
      }
      dados.sort((a, b) => a.fullName.localeCompare(b.fullName));

      // Recalcula com os serviços dos prestadores incluídos
      const servicosDisponiveisFinal = [...servicosSet]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

      res.json({ dados, servicosDisponiveis: servicosDisponiveisFinal });
    } catch (err) {
      console.error('Erro ao listar prestadores:', err);
      res.status(500).json({ error: 'Erro ao listar prestadores' });
    }
  },

  // POST /clinica/encaminhamentos
  // body: { animalId, especialidade, motivo, evolucaoId, prestadorId?, veterinarioDestino?,
  //         clinicaDestino?, urgencia?, observacao?, valor? }
  // prestadorId presente → cria/reativa DesignacaoPrestador (acesso do prestador ao animal)
  criar: async (req, res) => {
    try {
      const {
        animalId, especialidade, motivo, evolucaoId, prestadorId,
        veterinarioDestino, clinicaDestino, urgencia = 'NORMAL', observacao, valor,
      } = req.body;

      if (!animalId || !especialidade || !motivo) {
        return res.status(400).json({ error: 'animalId, especialidade e motivo são obrigatórios' });
      }
      // Todo encaminhamento tem de dizer PARA QUEM o paciente foi: prestador da equipe
      // (prestadorId) ou o nome do profissional externo. Sem isso o registro clínico
      // afirma que houve encaminhamento e não permite saber quem recebeu o paciente —
      // a clínica continua opcional (o profissional externo pode ser autônomo).
      if (!prestadorId && !String(veterinarioDestino || '').trim()) {
        return res.status(400).json({
          error: 'Informe o profissional de destino',
          code:  'DESTINO_OBRIGATORIO',
        });
      }
      if (!evolucaoId) {
        return res.status(400).json({ error: 'evolucaoId é obrigatório', code: 'EVOLUCAO_REQUIRED' });
      }
      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
      }
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }

      // Valida que a evolução existe e pertence ao animal
      const evolucao = await prisma.evolucaoClinica.findFirst({
        where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
        select: { id: true, numero: true, tipoAtendimento: true, veterinarioId: true },
      });
      if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal', code: 'EVOLUCAO_NOT_FOUND' });

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria: encaminhar dentro do atendimento de outro profissional é operar um
      // documento que não é seu — mesma regra de atualizar/finalizar/excluir, só que
      // aqui é ANTES do registro existir. Quem não conduz a evolução (não criou nem
      // assumiu) só encaminha depois de assumi-la.
      if (!podeOperarRegistro(req, evolucao.veterinarioId)) {
        return res.status(403).json({ error: 'Só é possível encaminhar dentro de uma evolução sua. Assuma o atendimento antes de encaminhar.' });
      }

      // Espécie do paciente — é ela que a especialidade nova recebe no catálogo
      // (`tb_especialidades` é POR ESPÉCIE), e é o que a faz reaparecer nas próximas
      // vezes na lista desta clínica.
      const especieDoPaciente = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { especieId: true },
      });

      let equipeDesignacao = null;
      if (prestadorId) {
        const animal = await prisma.animal.findUnique({
          where:  { id: Number(animalId) },
          select: { equipeId: true, empresaId: true },
        });
        const equipeIds = await getEquipeIdsDoAnimal(animal, req.equipeId);

        // Aceita FORNECEDOR (prestador externo) ou VETERINARIO (especialista interno)
        const memberships = await prisma.membroEquipe.findMany({
          where: {
            userId:   Number(prestadorId),
            equipeId: { in: equipeIds.length ? equipeIds : [-1] },
            OR: [
              { cargo: 'FORNECEDOR' },  { cargos: { has: 'FORNECEDOR' } },
              { cargo: 'VETERINARIO' }, { cargos: { has: 'VETERINARIO' } },
            ],
          },
          select: { equipeId: true, cargo: true, cargos: true },
        });
        if (memberships.length === 0) {
          return res.status(400).json({ error: 'Destinatário não é membro de uma equipe deste animal' });
        }
        // Designação de acesso só para FORNECEDOR — vet já tem acesso de equipe.
        const fornecedorMemberships = memberships.filter(
          m => m.cargo === 'FORNECEDOR' || (m.cargos ?? []).includes('FORNECEDOR'),
        );
        if (fornecedorMemberships.length > 0) {
          // Preferir a equipe do animal quando o prestador pertence a ela
          equipeDesignacao =
            fornecedorMemberships.find(m => m.equipeId === animal.equipeId)?.equipeId
            ?? fornecedorMemberships[0].equipeId;
        }
      }

      const resultado = await prisma.$transaction(async (tx) => {
        // Especialidade que ainda não está no catálogo entra como item DA CLÍNICA
        // (empresa_id setado — nunca global; ver lib/catalogoManual.js). É o que
        // permite encaminhar para uma área que o catálogo do sistema não cobre e,
        // da próxima vez, encontrá-la já na lista. Idempotente por (nome, espécie,
        // empresa): encaminhar duas vezes para "Quiropraxia" não duplica a linha.
        // Dentro da transaction de propósito: encaminhamento que falha não pode
        // deixar a especialidade cadastrada sozinha.
        await garantirEspecialidadeDaEmpresa(
          tx,
          { nome: especialidade, especieId: especieDoPaciente?.especieId },
          req.empresaId,
        );

        const enc = await tx.encaminhamentoClinico.create({
          data: {
            animalId:           Number(animalId),
            veterinarioId:      req.user.id,
            prestadorId:        prestadorId ? Number(prestadorId) : null,
            evolucaoId:         Number(evolucaoId),
            especialidade,
            motivo,
            veterinarioDestino: veterinarioDestino || null,
            clinicaDestino:     clinicaDestino || null,
            urgencia,
            observacao:         observacao || null,
          },
          include: INCLUDE,
        });

        if (prestadorId && equipeDesignacao) {
          await tx.designacaoPrestador.upsert({
            where: {
              animalId_prestadorId_equipeId: {
                animalId:    Number(animalId),
                prestadorId: Number(prestadorId),
                equipeId:    equipeDesignacao,
              },
            },
            update: {
              ativo:            true,
              dataFim:          null,
              encaminhamentoId: enc.id,
              motivo:           especialidade,
              criadoPorId:      req.user.id,
            },
            create: {
              animalId:         Number(animalId),
              prestadorId:      Number(prestadorId),
              equipeId:         equipeDesignacao,
              encaminhamentoId: enc.id,
              motivo:           especialidade,
              criadoPorId:      req.user.id,
            },
          });
        }

        // Lança na fatura se valor fornecido
        if (valor && Number(valor) > 0) {
          const animal = await tx.animal.findUnique({
            where:  { id: Number(animalId) },
            select: { userId: true },
          });
          if (animal?.userId) {
            const atendNum  = formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero);
            const destino   = prestadorId
              ? (enc.prestador?.fullName ?? especialidade)
              : (veterinarioDestino || clinicaDestino || 'externo');
            const descricao = `[${atendNum}] ${especialidade} — ${destino}`;
            // Escopo por empresa: a cobrança entra na fatura DESTA clínica
            const fatura    = await getOrCreateFatura(tx, animal.userId, req.empresaId);
            await adicionarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     Number(animalId),
              tipo:         'ENCAMINHAMENTO',
              descricao,
              valor:        Number(valor),
              quantidade:   1,
              veterinarioId: req.user.id,
              encaminhamentoClinicoId: enc.id,
            });
          }
        }

        return enc;
      });

      res.status(201).json({ dados: resultado });
    } catch (err) {
      console.error('Erro ao criar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao criar encaminhamento' });
    }
  },

  // PATCH /clinica/encaminhamentos/:id/status
  // body: { status: 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO' }
  // CONCLUIDO/CANCELADO inativam a designação criada por este encaminhamento;
  // voltar a PENDENTE reativa.
  atualizarStatus: async (req, res) => {
    try {
      const { id }             = req.params;
      const { status, motivo } = req.body;

      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
      }

      // Cancelamento exige justificativa (auditoria)
      if (status === 'CANCELADO' && !motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
      }

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // alterado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, enc.animalId)) return;

      const atualizado = await prisma.$transaction(async (tx) => {
        const upd = await tx.encaminhamentoClinico.update({
          where:   { id: enc.id },
          data:    { status },
          include: INCLUDE,
        });

        if (enc.prestadorId) {
          const encerrado = status === 'CONCLUIDO' || status === 'CANCELADO';
          await tx.designacaoPrestador.updateMany({
            where: { encaminhamentoId: enc.id },
            data:  encerrado
              ? { ativo: false, dataFim: new Date() }
              : { ativo: true,  dataFim: null },
          });
        }

        if (status === 'CANCELADO') {
          await registrarAuditoria(tx, req, {
            categoria:  'CANCELAMENTO',
            entidade:   'ENCAMINHAMENTO',
            entidadeId: enc.id,
            animalId:   enc.animalId,
            motivo,
            detalhes:   [enc.especialidade, enc.motivo].filter(Boolean).join(' — ') || null,
          });
        }

        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar status do encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar status' });
    }
  },

  // PUT /clinica/encaminhamentos/:id — edita campos textuais (só PENDENTE)
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const { especialidade, motivo, urgencia, observacao, veterinarioDestino, clinicaDestino } = req.body;

      const enc = await prisma.encaminhamentoClinico.findUnique({
        where:   { id: Number(id) },
        include: {
          evolucao:  { select: { numero: true, tipoAtendimento: true } },
          prestador: { select: { fullName: true } },
        },
      });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      if (enc.status !== 'PENDENTE') {
        return res.status(400).json({ error: 'Apenas encaminhamentos pendentes podem ser editados' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // alterado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, enc.animalId)) return;

      // Autoria via RBAC (nível efetivo em atendimento.encaminhamentos.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req, enc.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite editar encaminhamentos criados por você.' });
      }

      const atualizado = await prisma.$transaction(async (tx) => {
        const upd = await tx.encaminhamentoClinico.update({
          where: { id: enc.id },
          data: {
            ...(especialidade      !== undefined && { especialidade }),
            ...(motivo             !== undefined && { motivo }),
            ...(urgencia           !== undefined && { urgencia }),
            ...(observacao         !== undefined && { observacao }),
            ...(veterinarioDestino !== undefined && { veterinarioDestino }),
            ...(clinicaDestino     !== undefined && { clinicaDestino }),
          },
          include: INCLUDE,
        });

        // Especialidade/destino mudaram → sincroniza a descrição do FaturaItem vinculado
        // (se houver). Bloqueia (lança FaturaPagaError) se a fatura já estiver PAGA.
        const descricaoAfetada = especialidade !== undefined || veterinarioDestino !== undefined || clinicaDestino !== undefined;
        if (descricaoAfetada && enc.evolucao) {
          const especialidadeFinal      = especialidade      !== undefined ? especialidade      : enc.especialidade;
          const veterinarioDestinoFinal = veterinarioDestino  !== undefined ? veterinarioDestino  : enc.veterinarioDestino;
          const clinicaDestinoFinal     = clinicaDestino      !== undefined ? clinicaDestino      : enc.clinicaDestino;

          const atendNum = formatAtendimentoNum(enc.evolucao.tipoAtendimento, enc.evolucao.numero);
          const destino  = enc.prestadorId
            ? (enc.prestador?.fullName ?? especialidadeFinal)
            : (veterinarioDestinoFinal || clinicaDestinoFinal || 'externo');
          const descricao = `[${atendNum}] ${especialidadeFinal} — ${destino}`;

          await atualizarFaturaItensDaOrigem(tx, 'encaminhamentoClinicoId', enc.id, { descricao });
        }

        await registrarAlteracao(tx, req, {
          entidade: 'ENCAMINHAMENTO', entidadeId: enc.id, animalId: enc.animalId,
          donoAtualId: enc.veterinarioId,
          campos: {
            especialidade:      { de: enc.especialidade,      para: upd.especialidade },
            motivo:             { de: resumoTexto(enc.motivo), para: resumoTexto(upd.motivo) },
            urgencia:           { de: enc.urgencia,           para: upd.urgencia },
            observacao:         { de: resumoTexto(enc.observacao), para: resumoTexto(upd.observacao) },
            veterinarioDestino: { de: enc.veterinarioDestino, para: upd.veterinarioDestino },
            clinicaDestino:     { de: enc.clinicaDestino,     para: upd.clinicaDestino },
          },
        });

        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao atualizar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar encaminhamento' });
    }
  },

  // PATCH /clinica/encaminhamentos/:id/finalizar — CONCLUIDO com regra de autoria
  // GESTOR: finaliza qualquer encaminhamento (bypass via checkPermission)
  // FORNECEDOR: finaliza apenas os que ele criou (veterinarioId check)
  finalizar: async (req, res) => {
    try {
      const { id } = req.params;

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // finalizado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, enc.animalId)) return;

      // Autoria via RBAC (nível efetivo em atendimento.encaminhamentos.finalizar)
      if (!podeOperarRegistro(req, enc.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar encaminhamentos criados por você.' });
      }

      if (enc.status === 'CONCLUIDO') {
        return res.status(400).json({ error: 'Encaminhamento já está concluído.' });
      }

      const atualizado = await prisma.$transaction(async (tx) => {
        const upd = await tx.encaminhamentoClinico.update({
          where:   { id: enc.id },
          data:    { status: 'CONCLUIDO' },
          include: INCLUDE,
        });
        if (enc.prestadorId) {
          await tx.designacaoPrestador.updateMany({
            where: { encaminhamentoId: enc.id },
            data:  { ativo: false, dataFim: new Date() },
          });
        }
        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao finalizar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao finalizar encaminhamento' });
    }
  },

  // DELETE /clinica/encaminhamentos/:id — soft delete + inativa designação vinculada
  excluir: async (req, res) => {
    try {
      const { id }     = req.params;
      const { motivo } = req.body ?? {};

      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // cancelado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, enc.animalId)) return;

      // Autoria via RBAC (nível efetivo em atendimento.encaminhamentos.deletar)
      if (!podeOperarRegistro(req, enc.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite excluir encaminhamentos criados por você.' });
      }

      await prisma.$transaction(async (tx) => {
        // Remove o FaturaItem vinculado, se houver. Bloqueia (lança FaturaPagaError)
        // se a fatura de destino já estiver PAGA.
        await removerFaturaItensDaOrigem(tx, 'encaminhamentoClinicoId', enc.id);
        await tx.encaminhamentoClinico.update({ where: { id: enc.id }, data: { ativo: false } });
        await tx.designacaoPrestador.updateMany({
          where: { encaminhamentoId: enc.id, ativo: true },
          data:  { ativo: false, dataFim: new Date() },
        });

        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'ENCAMINHAMENTO',
          entidadeId: enc.id,
          animalId:   enc.animalId,
          motivo,
          detalhes:   [enc.especialidade, enc.motivo].filter(Boolean).join(' — ') || null,
        });
      });

      res.json({ dados: { id: enc.id, excluido: true } });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao excluir encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao excluir encaminhamento' });
    }
  },
};

module.exports = EncaminhamentoController;
