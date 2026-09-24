// backend/src/controllers/EncaminhamentoController.js
// Encaminhamentos clínicos — destino pode ser um prestador da equipe (User FORNECEDOR)
// ou um profissional externo (texto livre). Encaminhar para prestador da equipe cria/
// reativa uma DesignacaoPrestador, que é o escopo de acesso do prestador ao animal.

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { OR_CARGO_PRESTADOR, membroEhPrestador } = require('../lib/cargosPrestador');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { corteDePropriedade } = require('../lib/animalPropriedadeCorte');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria, registrarAlteracao, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');
const { animalEstaInativo, bloquearSeAnimalInativo } = require('../lib/animalInativo');
const { animalFoiExcluido } = require('../lib/animalAtivacao');
const { garantirEspecialidadeDaEmpresa } = require('../lib/catalogoManual');
const encPrestador = require('../lib/encaminhamentoPrestador');

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
      res.json({ dados: await encPrestador.anexar(prisma, item) });
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

      res.json({ dados: await encPrestador.anexarEmLista(prisma, dados), total });
    } catch (err) {
      console.error('Erro ao listar encaminhamentos:', err);
      res.status(500).json({ error: 'Erro ao listar encaminhamentos' });
    }
  },

  // GET /clinica/encaminhamentos/prestadores/:animalId
  //
  // 🔴 A ABA "PRESTADOR" LISTA O CADASTRO, NÃO A EQUIPE (2026-09-23).
  //
  // Até aqui esta rota varria `MembroEquipe` e devolvia duas coisas misturadas: os
  // prestadores externos COM login e os VETERINÁRIOS da equipe que tivessem alguma
  // especialidade. Duas consequências, as duas relatadas:
  //   • o prestador cadastrado SEM acesso ao sistema (o ferrador, o quiroprata) não
  //     existia no seletor — `MembroEquipe` só nasce quando há login;
  //   • o veterinário da própria equipe aparecia como destino de encaminhamento, que
  //     não é o que a aba se propõe a oferecer. Para ele, o caminho é o destino
  //     EXTERNO (ou assumir o atendimento).
  //
  // Agora a fonte é o CADASTRO — `tb_prestadores` + `tb_fornecedores` —, e a
  // especialidade sai do `tipo_servico` gravado lá, que é o campo que a tela de
  // Cadastro › Prestadores preenche.
  //
  // ⚠️ FORNECEDOR entra junto de propósito: `PRESTADOR` nasceu em 2026-09-09 e NADA foi
  // migrado (CLAUDE.md §4) — quem já estava cadastrado segue em `tb_fornecedores`.
  //
  // ⚠️ `UsuarioEspecialidade`/`FornecedorEspecialidade` SAÍRAM da conta: elas são o
  // catálogo de especialidade do USUÁRIO/do vínculo, e era por elas que o veterinário
  // entrava na lista. A pergunta da tela é "que serviço este prestador presta", e quem
  // responde isso é o cadastro dele.
  //
  // ⚠️ `precisaDesignacao` virou "tem login": designação é ESCOPO DE ACESSO, e sem
  // usuário não há a quem dar acesso. O encaminhamento para prestador sem login é
  // registro clínico e não libera o paciente — a tela avisa antes de salvar.
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

      const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

      // `tb_fornecedores` guarda também quem NÃO é prestador de serviço (a loja, o
      // laboratório, a farmácia que vende o frasco). Encaminhar paciente para eles não
      // faz sentido, então o serviço é descartado — e o cadastro que fica sem NENHUM
      // serviço depois do corte sai da lista inteira.
      const EXCLUIR_SERVICOS = new Set([
        'clinico', 'clinica', 'farmacia', 'loja', 'supermercado', 'laboratorio',
      ]);

      // Escopo: a empresa do CONTEXTO. O filtro é explícito, e não só o RLS, para a
      // resposta ser a mesma com e sem o carimbo de tenant (ADMIN de plataforma).
      const escopoCadastro = { ativo: true, tipoEntrada: 'CLIENTE', empresaId: req.empresaId ?? null };

      const [prestadores, fornecedores] = await Promise.all([
        prisma.prestador.findMany({
          where:  escopoCadastro,
          select: { id: true, nome: true, email: true, telefone: true, tipoServico: true, userId: true },
        }),
        prisma.fornecedor.findMany({
          where:  escopoCadastro,
          select: { id: true, nome: true, email: true, telefone: true, tipoServico: true, userId: true },
        }),
      ]);

      const brutos = [
        ...prestadores.map(p  => ({ ...p, origem: encPrestador.ORIGENS.PRESTADOR  })),
        ...fornecedores.map(f => ({ ...f, origem: encPrestador.ORIGENS.FORNECEDOR })),
      ];

      // Designações ativas DESTE animal — só alcançam quem tem login.
      const userIds = [...new Set(brutos.map(b => b.userId).filter(Boolean).map(Number))];
      const designacoes = userIds.length === 0 ? [] : await prisma.designacaoPrestador.findMany({
        where:  { animalId: Number(animalId), prestadorId: { in: userIds }, ativo: true },
        select: { prestadorId: true },
      });
      const designadoSet = new Set(designacoes.map(d => d.prestadorId));

      const servicosSet = new Set();
      const dados = [];
      for (const b of brutos) {
        const servicos = String(b.tipoServico ?? '')
          .split(',')
          .map(x => x.trim())
          .filter(x => x && !EXCLUIR_SERVICOS.has(normalizar(x)));
        // Fornecedor que só vende (loja, laboratório) some da lista — não é destino de
        // paciente, e mantê-lo aqui obrigaria quem encaminha a filtrá-lo com o olho.
        if (servicos.length === 0) continue;
        for (const x of servicos) servicosSet.add(x);

        const userId    = b.userId != null ? Number(b.userId) : null;
        const temAcesso = userId != null;
        dados.push({
          cadastroId:     b.id,
          cadastroOrigem: b.origem,
          // `userId` segue no payload: é ele que vira `prestadorId` e recebe a
          // designação. `null` = prestador sem acesso ao sistema.
          userId,
          temAcesso,
          fullName:    b.nome,
          email:       b.email,
          phone:       b.telefone,
          tipoServico: servicos.join(', '),
          servicos,
          precisaDesignacao: temAcesso,
          jaDesignado:       temAcesso && designadoSet.has(userId),
        });
      }
      dados.sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' }));

      const servicosDisponiveis = [...servicosSet]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

      res.json({ dados, servicosDisponiveis });
    } catch (err) {
      console.error('Erro ao listar prestadores:', err);
      res.status(500).json({ error: 'Erro ao listar prestadores' });
    }
  },

  // POST /clinica/encaminhamentos
  // body: { animalId, especialidade, motivo, evolucaoId,
  //         prestadorCadastroId? + prestadorCadastroOrigem?, veterinarioDestino?,
  //         clinicaDestino?, urgencia?, observacao?, valor? }
  //
  // 🔴 O DESTINO INTERNO É O CADASTRO DO PRESTADOR (2026-09-23), não mais um usuário.
  // A tela manda o par (origem, id) e é AQUI que se resolve o login dele — quando há.
  // Havendo login, nada muda: `prestadorId` é gravado e a `DesignacaoPrestador` libera
  // o paciente. Sem login, o encaminhamento é registro clínico e não libera acesso
  // nenhum (não há a quem dar).
  //
  // ⚠️ `prestadorId` cru no body CONTINUA aceito, de propósito: é o contrato antigo, e
  // quebrá-lo derrubaria qualquer integração/tela que ainda o use. Quando os dois vêm,
  // o CADASTRO vence — é ele que a tela nova escolhe.
  criar: async (req, res) => {
    try {
      const {
        animalId, especialidade, motivo, evolucaoId,
        prestadorId: prestadorIdBody,
        prestadorCadastroId, prestadorCadastroOrigem,
        veterinarioDestino, clinicaDestino, urgencia = 'NORMAL', observacao, valor,
      } = req.body;

      if (!animalId || !especialidade || !motivo) {
        return res.status(400).json({ error: 'animalId, especialidade e motivo são obrigatórios' });
      }

      // Resolve o cadastro ANTES de qualquer outra coisa: é ele que diz se existe (e
      // quem é) o login do destino, e a validação de "destino informado" logo abaixo
      // depende disso.
      let cadastroDestino = null;
      if (prestadorCadastroId) {
        cadastroDestino = await encPrestador.buscarCadastro(prisma, {
          origem:    prestadorCadastroOrigem,
          id:        prestadorCadastroId,
          empresaId: req.empresaId ?? null,
        });
        if (!cadastroDestino) {
          return res.status(400).json({
            error: 'Prestador não encontrado no cadastro desta clínica',
            code:  'PRESTADOR_CADASTRO_INVALIDO',
          });
        }
      }
      // O login do destino: o do cadastro escolhido, ou o `prestadorId` do contrato
      // antigo. `null` = prestador sem acesso ao sistema (ou destino externo).
      const prestadorId = cadastroDestino ? cadastroDestino.userId : (prestadorIdBody ?? null);

      // Todo encaminhamento tem de dizer PARA QUEM o paciente foi: um prestador do
      // cadastro ou o nome do profissional externo. Sem isso o registro clínico afirma
      // que houve encaminhamento e não permite saber quem recebeu o paciente — a
      // clínica continua opcional (o profissional externo pode ser autônomo).
      // ⚠️ O teste é pelo CADASTRO, não por `prestadorId`: o prestador sem login é um
      // destino perfeitamente informado, e exigir o usuário aqui o recusaria.
      if (!cadastroDestino && !prestadorId && !String(veterinarioDestino || '').trim()) {
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
              ...OR_CARGO_PRESTADOR,
              { cargo: 'VETERINARIO' }, { cargos: { has: 'VETERINARIO' } },
            ],
          },
          select: { equipeId: true, cargo: true, cargos: true },
        });
        // ⚠️ SEM VÍNCULO DE EQUIPE NÃO É ERRO QUANDO O DESTINO VEIO DO CADASTRO.
        // `buscarCadastro` já garantiu que o prestador é DESTA empresa; o que falta é
        // só a equipe em que o animal está, e disso depende a DESIGNAÇÃO — não o
        // registro clínico. Recusar aqui devolveria "não é membro de uma equipe deste
        // animal" para um prestador que a própria tela ofereceu, e o veterinário
        // ficaria sem saída (ele não administra equipe).
        // Para o contrato ANTIGO (`prestadorId` cru, sem cadastro) o 400 fica: ali o
        // id chegou de fora e ninguém conferiu a que empresa ele pertence.
        if (memberships.length === 0) {
          if (!cadastroDestino) {
            return res.status(400).json({ error: 'Destinatário não é membro de uma equipe deste animal' });
          }
          // Segue sem designação: o encaminhamento é gravado e o acesso ao paciente
          // não é liberado. A tela avisa disso antes de salvar.
        }
        // Designação de acesso só para o prestador externo — vet já tem acesso de equipe.
        const fornecedorMemberships = memberships.filter(membroEhPrestador);
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

        // ⚠️ UPDATE por SQL cru, SEMPRE depois do `create` — antes acerta zero linhas
        // em silêncio. Fica fora do `create` porque o client Prisma em execução pode
        // não conhecer as colunas novas (§11, Windows), e passá-las ao `create` tipado
        // derrubaria a criação inteira do encaminhamento, não só o campo novo.
        if (cadastroDestino) {
          await encPrestador.gravarCadastro(tx, enc.id, {
            origem: cadastroDestino.origem,
            id:     cadastroDestino.id,
          });
        }

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
            // O nome do destino na linha da fatura. O CADASTRO vem primeiro: o
            // prestador sem login não tem `enc.prestador`, e cair em `especialidade`
            // faria a cobrança dizer "Fisioterapia — Fisioterapia".
            const destino   = cadastroDestino?.nome
              ?? (prestadorId ? (enc.prestador?.fullName ?? especialidade) : null)
              ?? veterinarioDestino ?? clinicaDestino ?? 'externo';
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

      // A tela pinta o destino a partir do que volta daqui — sem o cadastro anexado, o
      // encaminhamento recém-criado para um prestador SEM login apareceria como
      // "Não informado" até a próxima recarga.
      res.status(201).json({ dados: await encPrestador.anexar(prisma, resultado) });
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
