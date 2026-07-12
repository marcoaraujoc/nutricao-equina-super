// backend/src/controllers/AnimalController.js
'use strict';

const crypto           = require('crypto');
const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');
const { storage }      = require('../storage');
const { getEmpresaIdDoVet, getContextoDoVet, getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { resolverLogoPorAnimal } = require('../lib/logoEmpresaUtils');
const { garantirFaturaAberta } = require('../services/FaturaService');
const { registrarAuditoria } = require('../lib/auditoria');

const prisma = require('../lib/prisma').default;

async function notificarGestoresDaEmpresa(empresaId, { animalNome, proprietarioNome, vetNome }) {
  if (!empresaId) return;
  const gestores = await prisma.membroEquipe.findMany({
    where:   { equipe: { empresaId }, cargo: 'GESTOR' },
    include: { user: { select: { email: true, fullName: true } } },
  });
  for (const gestor of gestores) {
    if (gestor.user?.email) {
      emailService.notificarGestoresAutorizacaoConcedida({
        gestorEmail:       gestor.user.email,
        gestorNome:        gestor.user.fullName || 'Gestor',
        animalNome,
        proprietarioNome,
        vetNome,
      }).catch(() => {});
    }
  }
}

const ANIMAL_INCLUDE = {
  especie:     true,
  raca:        true,
  user:        { select: { id: true, fullName: true, email: true, phone: true, cpf: true } },
  localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
  tratador:    { select: { id: true, nome: true, telefone: true } },
  solicitacoes: {
    // DESVINCULO ACEITO é excluído: vet não tem mais acesso, não deve aparecer no form de edição
    where: {
      OR: [
        { status: 'PENDENTE' },
        { tipo: 'VINCULO', status: 'ACEITO' },
      ],
    },
    select: {
      id:              true,
      tipo:            true,
      status:          true,
      vetUserId:       true,
      novoVetUserId:   true,
      solicitanteId:   true,
      veterinario:     { select: { id: true, fullName: true, email: true } },
      novoVeterinario: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
};

const gerarToken     = () => crypto.randomBytes(32).toString('hex');
const gerarExpiracao = (dias = 7) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
};

const obterUserType = async (userId) => {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  return { userType: u?.userType ?? 'PROPRIETARIO', role: u?.role ?? 'USER' };
};

// Cria ou atualiza solicitação PENDENTE + dispara email ao destinatário correto.
// Fluxos:
//   - Sem vet ativo → VINCULO PENDENTE (email ao vet ou ao proprietário dependendo de quem solicitou)
//   - Com vet ACEITO ou TROCA_VET PENDENTE → TROCA_VET PENDENTE (email ao vet atual pedindo aprovação)
//   - solicitanteId === novoVetId → vet solicitou → email ao proprietário
const criarSolicitacaoPendente = async ({
  animalId, novoVetId, animalNome, solicitanteId,
  proprietarioNome, proprietarioEmail, proprietarioPhone = null,
  // permitirTroca=false: fluxo de CADASTRO — o animal pode ter mais de um vet;
  // um vínculo ADICIONAL é criado sem disparar TROCA_VET nem tocar no vet atual.
  // permitirTroca=true (padrão): fluxo de EDIÇÃO — trocar o vet responsável
  // dispara a solicitação TROCA_VET ao vet atual.
  permitirTroca = true,
}) => {
  const novoVetIdNum = novoVetId ? Number(novoVetId) : null;
  if (!novoVetIdNum || isNaN(novoVetIdNum)) throw new Error(`novoVetId inválido: ${novoVetId}`);

  const vet = await prisma.user.findUnique({
    where:  { id: novoVetIdNum },
    select: { id: true, fullName: true, email: true },
  });
  if (!vet) throw new Error(`Veterinário id=${novoVetIdNum} não encontrado`);

  // Permite: dono de empresa, GESTOR/VETERINARIO em ALGUMA equipe, ou vet autônomo
  // (sem equipe). Bloqueia: quem só tem cargos não-clínicos (ESTAGIARIO, FORNECEDOR etc.).
  const empresaDoVet = await prisma.empresa.findFirst({ where: { ownerId: novoVetIdNum } });
  if (!empresaDoVet) {
    const membroDoVet = await prisma.membroEquipe.findFirst({ where: { userId: novoVetIdNum } });
    const membroResponsavel = membroDoVet
      ? await prisma.membroEquipe.findFirst({ where: { userId: novoVetIdNum, cargo: { in: ['GESTOR', 'VETERINARIO'] } } })
      : null;
    if (membroDoVet && !membroResponsavel) {
      const err = new Error('VET_MEMBRO_SEM_RESPONSABILIDADE');
      err.cargo = membroDoVet.cargo;
      err.vetNome = vet.fullName;
      throw err;
    }
  }

  // Detecta vet com acesso ativo ao animal (ACEITO ou TROCA_VET que ainda está pendendo)
  const solAtiva = await prisma.vetAnimalSolicitacao.findFirst({
    where: {
      animalId:  Number(animalId),
      vetUserId: { not: novoVetIdNum },
      OR: [
        { status: 'ACEITO', tipo: 'VINCULO' },
        { tipo: 'TROCA_VET', status: 'PENDENTE' },
      ],
    },
    include: { veterinario: { select: { id: true, fullName: true, email: true } } },
  });

  if (solAtiva && permitirTroca) {
    // ── TROCA_VET: vet atual precisa aprovar antes de trocar ──────────────────
    const token     = gerarToken();
    const expiresAt = gerarExpiracao(1); // 24 horas

    await prisma.vetAnimalSolicitacao.update({
      where: { id: solAtiva.id },
      data: {
        tipo:          'TROCA_VET',
        status:        'PENDENTE',
        novoVetUserId: novoVetIdNum,
        approvalToken: token,
        expiresAt,
        solicitanteId: solicitanteId ? Number(solicitanteId) : null,
        mensagem:      null,
      },
    });

    emailService.enviarSolicitacaoTrocaVet({
      vetEmail:          solAtiva.veterinario.email,
      vetNome:           solAtiva.veterinario.fullName,
      novoVetNome:       vet.fullName,
      animalNome,
      proprietarioNome:  proprietarioNome || 'Proprietário',
      proprietarioEmail: proprietarioEmail || null,
      proprietarioPhone: proprietarioPhone || null,
      token,
    }).catch(err => console.error('[emailService] Falha ao enviar TROCA_VET:', err));

    return vet;
  }

  // ── VINCULO: sem vet ativo → solicitação direta ───────────────────────────
  const token     = gerarToken();
  const expiresAt = gerarExpiracao(7);

  await prisma.vetAnimalSolicitacao.upsert({
    where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: novoVetIdNum } },
    create: {
      animalId:      Number(animalId),
      vetUserId:     novoVetIdNum,
      tipo:          'VINCULO',
      status:        'PENDENTE',
      approvalToken: token,
      expiresAt,
      solicitanteId: solicitanteId ? Number(solicitanteId) : null,
    },
    update: {
      tipo:          'VINCULO',
      status:        'PENDENTE',
      approvalToken: token,
      expiresAt,
      solicitanteId: solicitanteId ? Number(solicitanteId) : null,
      mensagem:      null,
    },
  });

  const solicitanteEOVet = solicitanteId && Number(solicitanteId) === novoVetIdNum;

  if (solicitanteEOVet) {
    if (proprietarioEmail) {
      emailService.enviarSolicitacaoVinculoProprietario({
        proprietarioEmail,
        proprietarioNome: proprietarioNome || 'Proprietário',
        animalNome,
        vetNome:          vet.fullName,
        token,
      })
        .then(() => console.log(`[emailService] Email ao proprietário enviado → ${proprietarioEmail}`))
        .catch(err => console.error('[emailService] FALHA ao enviar para proprietário:', err?.message ?? err));
    } else {
      console.warn('[emailService] Proprietário sem email — notificação não enviada');
    }
  } else {
    emailService.enviarSolicitacaoVinculo({
      vetEmail:         vet.email,
      vetNome:          vet.fullName,
      animalNome,
      proprietarioNome: proprietarioNome || 'Proprietário',
      token,
    })
      .then(() => console.log(`[emailService] Email ao vet enviado → ${vet.email}`))
      .catch(err => console.error('[emailService] FALHA ao enviar para vet:', err?.message ?? err));
  }

  return vet;
};

// Vínculo DIRETO (ACEITO) de um vet ao animal — sem fluxo de aprovação por e-mail.
// Usado quando NÃO há troca de vet: cadastro de animal novo com vet indicado e
// edição atribuindo vet a animal que não tinha nenhum. A solicitação por e-mail
// existe apenas na TROCA do vet responsável (criarSolicitacaoPendente/TROCA_VET).
const vincularVetDireto = async ({ animalId, vetId }) => {
  const vetIdNum = Number(vetId);
  const vet = await prisma.user.findUnique({
    where:  { id: vetIdNum },
    select: { id: true, fullName: true },
  });
  if (!vet) throw new Error(`Veterinário id=${vetId} não encontrado`);

  // Mesma regra do fluxo de solicitação: só GESTOR/VETERINARIO em alguma equipe
  // (ou vet autônomo/dono de empresa) pode ser o vet responsável direto
  const empresaDoVet = await prisma.empresa.findFirst({ where: { ownerId: vetIdNum } });
  if (!empresaDoVet) {
    const membroDoVet = await prisma.membroEquipe.findFirst({ where: { userId: vetIdNum } });
    const membroResponsavel = membroDoVet
      ? await prisma.membroEquipe.findFirst({ where: { userId: vetIdNum, cargo: { in: ['GESTOR', 'VETERINARIO'] } } })
      : null;
    if (membroDoVet && !membroResponsavel) {
      const err = new Error('VET_MEMBRO_SEM_RESPONSABILIDADE');
      err.cargo = membroDoVet.cargo;
      err.vetNome = vet.fullName;
      throw err;
    }
  }

  await prisma.vetAnimalSolicitacao.upsert({
    where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: vetIdNum } },
    create: { animalId: Number(animalId), vetUserId: vetIdNum, tipo: 'VINCULO', status: 'ACEITO' },
    update: { tipo: 'VINCULO', status: 'ACEITO', approvalToken: null, expiresAt: null, mensagem: null },
  });

  // Espelha o aceite normal: animal herda empresa/equipe do contexto do vet
  const ctx = await getContextoDoVet(vetIdNum, null, null);
  let clinicaNome = null;
  if (ctx.empresaId) {
    const empresa = await prisma.empresa.findUnique({ where: { id: ctx.empresaId }, select: { nome: true } });
    clinicaNome = empresa?.nome ?? null;
  }
  const animalDados = await prisma.animal.update({
    where: { id: Number(animalId) },
    data:  {
      veterinarioNome:    vet.fullName,
      veterinarioClinica: clinicaNome,
      ...(ctx.empresaId ? { empresaId: ctx.empresaId, equipeId: ctx.equipeId } : {}),
    },
    select: { userId: true },
  });
  if (animalDados?.userId) await garantirFaturaAberta(animalDados.userId);

  return vet;
};

class AnimalController {

  // ── GET /api/animais/buscar-por-nome?nome=X ──────────────────────────────
  // DEVE ser registrado ANTES de /:id nas rotas

  async buscarPorNome(req, res) {
      const { nome } = req.query;
      if (!nome?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome obrigatório' });
      }

      try {
        const vetLogadoId = Number(req.user.id);

        const animais = await prisma.animal.findMany({
          where:   { nome: { contains: nome.trim(), mode: 'insensitive' }, ativo: true },
          include: {
            user:    { select: { id: true, fullName: true, email: true, phone: true } },
            especie: { select: { id: true, nome: true } },
            raca:    { select: { id: true, nome: true } },
            solicitacoes: {
              // Mesmo critério do ANIMAL_INCLUDE: exclui DESVINCULO ACEITO (vet já saiu)
              where: {
                OR: [
                  { status: 'PENDENTE' },
                  { tipo: 'VINCULO', status: 'ACEITO' },
                ],
              },
              select: { status: true, vetUserId: true },
            },
          },
          take: 10,
        });

        if (animais.length === 0) {
          return res.json({ sucesso: true, dados: null });
        }

        const animal = animais.find(
          a => a.nome.toLowerCase() === nome.trim().toLowerCase()
        ) ?? animais[0];

        const solAtiva = animal.solicitacoes.find(
          s => s.status === 'ACEITO' || s.status === 'PENDENTE'
        );
        const temVet   = !!solAtiva;
        const vetDoAnimalId = solAtiva?.vetUserId ?? null;

        // ── Checa se o vet do animal é da mesma equipe ──────────────────────
        let vetDaMinhaEquipe = false;

        if (temVet && vetDoAnimalId && vetDoAnimalId !== vetLogadoId) {
          // Equipes do CONTEXTO ATIVO onde o usuário tem cargo clínico.
          // Vínculo como PRESTADOR (cargo FORNECEDOR) em outra equipe não conta
          // como "minha equipe" — ali ele atende como fornecedor, não como gestor.
          const minhasEquipes = await prisma.membroEquipe.findMany({
            where: {
              userId: vetLogadoId,
              cargo:  { not: 'FORNECEDOR' },
              ...(req.equipeId
                ? { equipeId: Number(req.equipeId) }
                : req.empresaId
                  ? { equipe: { empresaId: Number(req.empresaId) } }
                  : {}),
            },
            select: { equipeId: true },
          });
          const minhasEquipeIds = minhasEquipes.map(e => e.equipeId);

          if (minhasEquipeIds.length > 0) {
            // Verifica se o vet do animal também está em alguma dessas equipes
            const vetDoAnimalNaEquipe = await prisma.membroEquipe.findFirst({
              where: {
                userId:   vetDoAnimalId,
                equipeId: { in: minhasEquipeIds },
              },
            });
            vetDaMinhaEquipe = !!vetDoAnimalNaEquipe;
          }
        }

        // Se o próprio vet logado tem o animal → também é "minha equipe"
        if (vetDoAnimalId === vetLogadoId) {
          vetDaMinhaEquipe = true;
        }

        res.json({
          sucesso: true,
          dados: {
            id:              animal.id,
            nome:            animal.nome,
            photoUrl:        animal.photoUrl        ?? null,
            dataNascimento:  animal.dataNascimento  ?? null,
            idadeAnos:       animal.idadeAnos       ?? null,
            peso:            animal.peso            ?? null,
            sexo:            animal.sexo            ?? null,
            categoriaAnimal: animal.categoriaAnimal ?? null,
            tipoExercicio:   animal.tipoExercicio   ?? null,
            especieId:       animal.especieId       ?? null,
            racaId:          animal.racaId          ?? null,
            especie:         animal.especie         ?? null,
            raca:            animal.raca            ?? null,
            temVet,
            vetDaMinhaEquipe,
            proprietario:    animal.user,
          },
        });
      } catch (error) {
        console.error('[AnimalController.buscarPorNome]', error);
        res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
      }
    }

  // ── POST /api/animais/proprietario/aprovar ───────────────────────────────
  // Rota pública — proprietário aprova ou recusa vínculo pelo link do email

  async proprietarioAprovar(req, res) {
    const { token, acao } = req.body;

    if (!token || !acao) {
      return res.status(400).json({ sucesso: false, mensagem: 'Token e ação são obrigatórios' });
    }
    if (!['aceitar', 'recusar'].includes(acao)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Ação inválida' });
    }

    try {
      const solicitacao = await prisma.vetAnimalSolicitacao.findFirst({
        where: { approvalToken: token, status: 'PENDENTE' },
        include: {
          animal:      { select: { nome: true, userId: true } },
          veterinario: { select: { fullName: true, email: true } },
        },
      });

      if (!solicitacao) {
        return res.status(404).json({
          sucesso:  false,
          mensagem: 'Token inválido ou solicitação não encontrada',
        });
      }

      if (solicitacao.expiresAt && new Date() > solicitacao.expiresAt) {
        return res.status(410).json({
          sucesso:  false,
          mensagem: 'Este link expirou. Solicite um novo vínculo.',
        });
      }

      if (solicitacao.tipo === 'DESVINCULO') {
        // Vet-iniciado: proprietário decide se aceita a remoção do vet
        if (acao === 'aceitar') {
          // Proprietário aceita → vet perde acesso, animal desvinculado da empresa
          await prisma.vetAnimalSolicitacao.update({
            where: { id: solicitacao.id },
            data:  { status: 'ACEITO', approvalToken: null },
          });
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  { veterinarioNome: null, veterinarioClinica: null, empresaId: null, equipeId: null },
          });
        } else {
          // Proprietário recusa → vet mantém acesso (restaura VINCULO ACEITO)
          await prisma.vetAnimalSolicitacao.update({
            where: { id: solicitacao.id },
            data:  { tipo: 'VINCULO', status: 'ACEITO', approvalToken: null, mensagem: null },
          });
        }
      } else {
        // VINCULO: comportamento original
        const novoStatus = acao === 'aceitar' ? 'ACEITO' : 'RECUSADO';

        await prisma.vetAnimalSolicitacao.update({
          where: { id: solicitacao.id },
          data:  { status: novoStatus, approvalToken: null },
        });

        if (acao === 'aceitar') {
          const ctx = await getContextoDoVet(solicitacao.vetUserId);
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  {
              bloqueado:      false,
              bloqueioTipo:   null,
              bloqueioExpira: null,
              ...(ctx.empresaId ? { empresaId: ctx.empresaId, equipeId: ctx.equipeId } : {}),
            },
          });
          await garantirFaturaAberta(solicitacao.animal.userId);
        } else {
          // Recusa: limpa o vet responsável do animal
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  { veterinarioNome: null, veterinarioClinica: null },
          });
        }
      }

      // Busca nome do proprietário para o email de confirmação ao vet
      const proprietario = await prisma.user.findUnique({
        where:  { id: solicitacao.animal.userId },
        select: { fullName: true },
      });

      if (acao === 'aceitar' && solicitacao.tipo !== 'DESVINCULO') {
        const empId = await getEmpresaIdDoVet(solicitacao.vetUserId);
        if (empId) {
          notificarGestoresDaEmpresa(empId, {
            animalNome:       solicitacao.animal.nome,
            proprietarioNome: proprietario?.fullName || 'Proprietário',
            vetNome:          solicitacao.veterinario.fullName,
          }).catch(() => {});
        }
      }

      try {
        await emailService.enviarConfirmacaoVinculo({
          proprietarioEmail: solicitacao.veterinario.email,
          proprietarioNome:  solicitacao.veterinario.fullName,
          animalNome:        solicitacao.animal.nome,
          vetNome:           proprietario?.fullName || 'Proprietário',
          aceito:            acao === 'aceitar',
        });
      } catch (err) {
        console.error('[emailService] Falha ao notificar vet sobre decisão:', err?.message);
      }

      res.json({
        sucesso:  true,
        aceito:   acao === 'aceitar',
        mensagem: acao === 'aceitar'
          ? `Vínculo com Dr(a). ${solicitacao.veterinario.fullName} autorizado com sucesso!`
          : 'Vínculo recusado. O veterinário foi notificado.',
      });
    } catch (error) {
      console.error('[AnimalController.proprietarioAprovar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── GET /api/animais/minhas-solicitacoes ─────────────────────────────────
  // Retorna todas as solicitações de vínculo dos animais do proprietário autenticado.
  // Usado pelo hook de polling para notificar quando vet aceita/recusa.

  async minhasSolicitacoes(req, res) {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado' });

    try {
      const solicitacoes = await prisma.vetAnimalSolicitacao.findMany({
        where:   { animal: { userId } },
        select: {
          id:              true,
          tipo:            true,
          status:          true,
          updatedAt:       true,
          vetUserId:       true,
          novoVetUserId:   true,
          solicitanteId:   true,
          animal:          { select: { id: true, nome: true, bloqueioTipo: true } },
          veterinario:     { select: { fullName: true } },
          novoVeterinario: { select: { fullName: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ sucesso: true, dados: solicitacoes });
    } catch (error) {
      console.error('[AnimalController.minhasSolicitacoes]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar solicitações' });
    }
  }

  // ── GET /api/animais ─────────────────────────────────────────────────────

  async listar(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado' });

      const { userType, role } = await obterUserType(userId);
      // PROPRIETARIO sempre vê apenas seus próprios animais, independente do role.
      // Somente usuários sem userType proprietário e com role ADMIN têm acesso global.
      const isAdmin = role === 'ADMIN' && userType !== 'PROPRIETARIO';

      // Multicargo: PROPRIETARIO com cargo VETERINARIO/ESTAGIARIO/GESTOR numa equipe
      // deve ver também os animais da equipe além dos próprios.
      // req.membroCargo é setado pelo checkPermission com o cargo real da equipe.
      const CARGOS_EQUIPE = ['VETERINARIO', 'ESTAGIARIO', 'GESTOR'];
      const isProprietarioMulticargo = userType === 'PROPRIETARIO'
        && req.membroCargo
        && CARGOS_EQUIPE.includes(req.membroCargo);

      // FORNECEDOR que atua como GESTOR no contexto ativo (assinante com empresa
      // própria): recebe o escopo de equipe normal. Fora desse contexto, mantém
      // o deny-by-default por designação. req.membroCargo vem do checkPermission.
      const isFornecedorGestorContexto = userType === 'FORNECEDOR' && req.membroCargo === 'GESTOR';

      // Espelho: VETERINARIO que atua como PRESTADOR no contexto ativo (cargo
      // FORNECEDOR na equipe ativa — ex: vet gestora da própria empresa que presta
      // serviço em outra equipe): mantém o deny-by-default do prestador ali.
      const isVetPrestadorContexto = userType === 'VETERINARIO' && req.membroCargo === 'FORNECEDOR';

      const designacoesWhere = { designacoes: { some: {
        prestadorId: Number(userId),
        ativo:       true,
        OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
      } } };

      const isMembroEquipe = !!req.empresaId && !isAdmin;

      const vetSolicitacoesWhere = { solicitacoes: { some: { vetUserId: Number(userId), OR: [
        { tipo: 'VINCULO',    status: 'ACEITO'   },
        { tipo: 'DESVINCULO', status: 'PENDENTE' },
        { tipo: 'TROCA_VET',  status: 'PENDENTE' },
      ] } } };

      // Escopo por equipe dentro da empresa ativa: contexto x-equipe-id > equipes do
      // usuário na empresa > null (dono sem MembroEquipe → empresa inteira).
      // Animais legados sem equipeId continuam visíveis para toda a empresa.
      const equipeScope = isMembroEquipe
        ? await getEquipeScopeDoUsuario(userId, req.empresaId, req.equipeId)
        : null;
      const scopeOR = equipeScope
        ? [
            { equipeId: { in: equipeScope } },
            { empresaId: req.empresaId, equipeId: null },
          ]
        : [{ empresaId: req.empresaId }];

      // Pacientes pessoais do vet FORA da empresa ativa (vínculo direto) — animais
      // da mesma empresa em OUTRA equipe ficam fora da listagem (segregação)
      const vetVinculoForaDaEmpresa = {
        AND: [
          vetSolicitacoesWhere,
          { OR: [{ empresaId: null }, { NOT: { empresaId: req.empresaId } }] },
        ],
      };

      const where = isAdmin
        ? {}
        // PROPRIETARIO: sempre inclui seus próprios animais.
        // Multicargo (também é VET/ESTAGIARIO/GESTOR numa equipe): adiciona escopo da equipe.
        : userType === 'PROPRIETARIO'
          ? isProprietarioMulticargo
            ? { OR: [{ userId: Number(userId) }, ...scopeOR] }
            : { userId: Number(userId) }
          // FORNECEDOR (prestador): NUNCA herda escopo de equipe — só animais com
          // designação ativa (DesignacaoPrestador) e dentro da validade.
          // Exceção: cargo GESTOR no contexto ativo → escopo de equipe (empresa própria).
          : userType === 'FORNECEDOR'
            ? isFornecedorGestorContexto
              ? { OR: scopeOR }
              : designacoesWhere
            : userType === 'VETERINARIO'
              // Vet atuando como PRESTADOR no contexto ativo: designações + pacientes próprios
              ? isVetPrestadorContexto
                ? { OR: [designacoesWhere, vetVinculoForaDaEmpresa] }
                // Vet com empresa: escopo de equipe + pacientes pessoais fora da empresa
                : isMembroEquipe
                  ? { OR: [...scopeOR, vetVinculoForaDaEmpresa] }
                  : vetSolicitacoesWhere
              // ESTAGIARIO: vê os animais da(s) sua(s) equipe(s) na empresa
              : isMembroEquipe
                ? { OR: scopeOR }
                : {};

      const animais = await prisma.animal.findMany({
        where: { ...where, ativo: true },
        include:  ANIMAL_INCLUDE,
        orderBy:  { dataCadastro: 'desc' },
      });

      res.json({ sucesso: true, dados: animais });
    } catch (error) {
      console.error('[AnimalController.listar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar animais' });
    }
  }

  // ── GET /api/animais/:id ─────────────────────────────────────────────────

  async obterPorId(req, res) {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ sucesso: false, mensagem: 'ID inválido' });
    }
    try {
      const animal = await prisma.animal.findUnique({
        where:   { id },
        include: ANIMAL_INCLUDE,
      });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });

      // Controle de acesso centralizado — cobre PROPRIETARIO, empresa (gestores), e vínculo direto
      if (req.user?.id) {
        const acesso = await verificarAcessoAnimal({ animalId: id, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
        if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
        if (!acesso)        return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });
      }

      res.json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.obterPorId]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar animal' });
    }
  }

  // ── GET /api/animais/:id/logo-empresa ────────────────────────────────────
  // Logo da empresa/equipe do animal — usado nos relatórios/impressões (dieta,
  // evolução, prescrição, exame etc.) em vez da marca S2Vet. Acesso liberado para
  // qualquer perfil com acesso ao animal (não só GESTOR — diferente de
  // /equipes/configuracoes, que é gestor-only).
  async obterLogoEmpresa(req, res) {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ sucesso: false, mensagem: 'ID inválido' });
    }
    try {
      const acesso = await verificarAcessoAnimal({ animalId: id, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)        return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const logoUrl = await resolverLogoPorAnimal(id);
      res.json({ dados: { logoUrl } });
    } catch (error) {
      console.error('[AnimalController.obterLogoEmpresa]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar logo' });
    }
  }

  // ── POST /api/animais ────────────────────────────────────────────────────

  async criar(req, res) {
    const {
      nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      proprietarioId, veterinarioUserId, local, baia, localizacaoId, tratadorId,
      pelagem, altura, registroPassaporte, finalidade, seguradora,
    } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const { userType, role } = await obterUserType(req.user.id);
      const isVet             = userType === 'VETERINARIO';
      const isAdminCriando    = role === 'ADMIN' && userType !== 'PROPRIETARIO';

      // Busca nome completo do vet no banco (não está no JWT)
      const vetLogado = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: { fullName: true },
      });
      const vetNomeCompleto = vetLogado?.fullName || 'Veterinário';
      // Obtido aqui para estar disponível em todos os caminhos do vet (nao_encontrado, sem_vet, etc.)
      const vetCtx = isVet
        ? await getContextoDoVet(req.user.id, req.empresaId, req.equipeId)
        : { empresaId: null, equipeId: null };
      const vetEmpresaId = vetCtx.empresaId;
      const vetEquipeId  = vetCtx.equipeId;

      // ── Vet vinculando animal já existente sem vet ──────────────────────
      if (isVet && req.body.animalExistenteId) {
        const existenteId = Number(req.body.animalExistenteId);
        const animalExistente = await prisma.animal.findUnique({
          where:  { id: existenteId },
          select: {
            id:     true,
            nome:   true,
            userId: true,
            user: { select: { fullName: true, email: true } },
            solicitacoes: {
              where: {
                OR: [
                  { status: 'PENDENTE' },
                  { tipo: 'VINCULO', status: 'ACEITO' },
                ],
              },
              select: { status: true },
            },
          },
        });

        if (!animalExistente) {
          return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
        }

        // Um animal pode ter MAIS DE UM veterinário (ex: vet responsável + fornecedor
        // de outra equipe, como quiropraxista). Animal já atrelado a outro vet NÃO
        // bloqueia o cadastro: o vet cadastrante é adicionado como vínculo ADICIONAL,
        // sem disparar TROCA_VET e sem mexer no vet/equipe atuais. A solicitação de
        // troca só acontece na EDIÇÃO, quando o vet responsável é efetivamente trocado.
        const jaTemVet = animalExistente.solicitacoes.length > 0;

        const pedirAutorizacao = req.body.pedirAutorizacao === true
          || req.body.pedirAutorizacao === 'true';

        if (pedirAutorizacao) {
          // Solicita autorização ao proprietário — VINCULO PENDENTE para o novo vet
          // (nunca TROCA_VET no cadastro; o vet atual, se houver, permanece intacto)
          await criarSolicitacaoPendente({
            animalId:          animalExistente.id,
            novoVetId:         req.user.id,
            animalNome:        animalExistente.nome,
            solicitanteId:     req.user.id,
            proprietarioNome:  animalExistente.user?.fullName,
            proprietarioEmail: animalExistente.user?.email,
            permitirTroca:     false,
          });

          if (!jaTemVet) {
            // Só bloqueia o animal quando ele ainda não tem vet ativo — com outro vet
            // atendendo, o bloqueio interromperia o atendimento da equipe atual
            await prisma.animal.update({
              where: { id: animalExistente.id },
              data:  {
                bloqueado:    true,
                bloqueioTipo: 'AGUARDANDO_APROVACAO',
                bloqueioExpira: null,
                ...(vetEmpresaId ? { empresaId: vetEmpresaId, equipeId: vetEquipeId } : {}),
              },
            });
          }

          return res.status(201).json({
            sucesso:  true,
            dados:    { id: animalExistente.id },
            mensagem: 'Solicitação enviada ao proprietário. O vínculo será efetivado após o aceite.',
          });
        }

        // Vínculo direto (ACEITO) — sem bloqueio; e-mail informativo ao proprietário
        const empId = vetEmpresaId;
        let clinicaNome = null;
        if (empId) {
          const empresa = await prisma.empresa.findUnique({ where: { id: empId }, select: { nome: true } });
          clinicaNome = empresa?.nome ?? null;
        }

        await prisma.vetAnimalSolicitacao.upsert({
          where:  { animalId_vetUserId: { animalId: animalExistente.id, vetUserId: Number(req.user.id) } },
          create: { animalId: animalExistente.id, vetUserId: Number(req.user.id), tipo: 'VINCULO', status: 'ACEITO', solicitanteId: Number(req.user.id) },
          update: { tipo: 'VINCULO', status: 'ACEITO', approvalToken: null, expiresAt: null, mensagem: null, solicitanteId: Number(req.user.id) },
        });

        await prisma.animal.update({
          where: { id: animalExistente.id },
          data:  {
            bloqueado:          false,
            bloqueioTipo:       null,
            bloqueioExpira:     null,
            // Com outro vet já ativo: vínculo ADICIONAL — não sobrescreve o vet
            // responsável exibido nem move o animal de empresa/equipe
            ...(jaTemVet ? {} : {
              veterinarioNome:    vetNomeCompleto,
              veterinarioClinica: clinicaNome,
              ...(empId ? { empresaId: empId, equipeId: vetEquipeId } : {}),
            }),
          },
        });

        if (animalExistente.userId) {
          await garantirFaturaAberta(animalExistente.userId);
        }

        // E-mail meramente informativo ao proprietário (sem link de aprovação)
        if (animalExistente.user?.email) {
          emailService.enviarVinculoInformativo({
            proprietarioEmail: animalExistente.user.email,
            proprietarioNome:  animalExistente.user.fullName || 'Proprietário',
            animalNome:        animalExistente.nome,
            vetNome:           vetNomeCompleto,
          })
            .then(() => console.log(`[emailService] Email informativo enviado → ${animalExistente.user.email}`))
            .catch(err => console.error('[emailService] FALHA ao enviar informativo:', err?.message ?? err));
        }

        return res.status(201).json({
          sucesso:  true,
          dados:    { id: animalExistente.id },
          mensagem: 'Vínculo estabelecido com sucesso!',
        });
      }

      // ── Criação de novo animal ──────────────────────────────────────────

      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );
      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let targetUserId              = req.user.id;
      let proprietarioNomeParaEmail = 'Proprietário';
      let proprietarioEmailParaEmail = null;
      let isNewProprietario = false;

            // Somente ADMIN pode redirecionar a criação para outro proprietário
            if (proprietarioId && isAdminCriando) {
              targetUserId = Number(proprietarioId);
              const prop = await prisma.user.findUnique({
                where:  { id: Number(proprietarioId) },
                select: { fullName: true, email: true },
              });
              proprietarioNomeParaEmail  = prop?.fullName || 'Proprietário';
              proprietarioEmailParaEmail = prop?.email    || null;

            } else if (req.body.proprietario) {
              const propData = typeof req.body.proprietario === 'string'
                ? JSON.parse(req.body.proprietario)
                : req.body.proprietario;

              if (propData?.email) {
                let prop = await prisma.user.findUnique({ where: { email: propData.email } });
                if (!prop) {
                  prop = await prisma.user.create({
                    data: {
                      fullName:           propData.fullName || 'Proprietário',
                      email:              propData.email,
                      phone:              propData.phone  || null,
                      phone2:             propData.phone2 || null,
                      passwordHash:       await bcrypt.hash('Inicial#001', 10),
                      role:               'USER',
                      userType:           'PROPRIETARIO',
                      mustChangePassword: true,
                      empresaId:          vetEmpresaId || null,
                      equipeId:           vetEquipeId  || null,
                    },
                  });
                  isNewProprietario = true;
                }
                targetUserId               = prop.id;
                proprietarioNomeParaEmail  = prop.fullName;
                proprietarioEmailParaEmail = prop.email;
              }
            } else {
              const prop = await prisma.user.findUnique({
                where:  { id: Number(targetUserId) },
                select: { fullName: true, email: true },
              });
              proprietarioNomeParaEmail  = prop?.fullName || 'Proprietário';
              proprietarioEmailParaEmail = prop?.email    || null;
            }

      const photoUrl = req.file ? await storage.upload(req.file, '') : null;

      const criadoParaSiMesmo = isVet && Number(targetUserId) === Number(req.user.id);

      // Validação de baia: única por (local + empresa/proprietário).
      // Mesmo número de baia é permitido em locais distintos.
      if (baia?.trim()) {
        const scopeBaia  = vetEmpresaId
          ? { empresaId: vetEmpresaId }
          : { userId: Number(targetUserId) };
        const localNorm  = local?.trim() || null;
        const baiaOcupada = await prisma.animal.findFirst({
          where: {
            baia:  { equals: baia.trim(), mode: 'insensitive' },
            local: localNorm ? { equals: localNorm, mode: 'insensitive' } : null,
            ativo: true,
            ...scopeBaia,
          },
          select: { nome: true },
        });
        if (baiaOcupada) {
          const localLabel = localNorm ? ` (${localNorm})` : '';
          return res.status(409).json({ sucesso: false, mensagem: `A baia "${baia.trim()}"${localLabel} já está ocupada por ${baiaOcupada.nome}` });
        }
      }

      const animal = await prisma.animal.create({
        data: {
          nome:            nome.trim(),
          peso:            parseFloat(peso) || 0,
          dataNascimento:  dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:       dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          local:          local?.trim() || null,
          baia:           baia?.trim()  || null,
          localizacaoId:  localizacaoId ? Number(localizacaoId) : null,
          tratadorId:     tratadorId    ? Number(tratadorId)    : null,
          pelagem:            pelagem?.trim()            || null,
          altura:             altura?.trim()             || null,
          registroPassaporte: registroPassaporte?.trim() || null,
          finalidade:         finalidade?.trim()         || null,
          seguradora:         seguradora?.trim()         || null,
          photoUrl,
          especieId:  Number(especieId),
          racaId:     Number(racaId),
          userId:     Number(targetUserId),
          empresaId:  vetEmpresaId ?? undefined,
          equipeId:   vetEquipeId  ?? undefined,
        },
      });

      if (isVet) {
        if (criadoParaSiMesmo) {
          // Vet criando animal para si mesmo → ACEITO direto (empresaId já incluído no create)
          await prisma.vetAnimalSolicitacao.create({
            data: { animalId: animal.id, vetUserId: Number(req.user.id), tipo: 'VINCULO', status: 'ACEITO' },
          });
          await garantirFaturaAberta(Number(targetUserId));
        } else {
          const pedirAutorizacaoNovo = req.body.pedirAutorizacao === true
            || req.body.pedirAutorizacao === 'true';

          if (pedirAutorizacaoNovo) {
            // Solicita autorização ao proprietário — animal fica bloqueado até aprovação
            const tokenVinculo     = gerarToken();
            const expiresAtVinculo = gerarExpiracao(7);

            await prisma.vetAnimalSolicitacao.create({
              data: {
                animalId:      animal.id,
                vetUserId:     Number(req.user.id),
                status:        'PENDENTE',
                approvalToken: tokenVinculo,
                expiresAt:     expiresAtVinculo,
                solicitanteId: Number(req.user.id),
              },
            });

            await prisma.animal.update({
              where: { id: animal.id },
              data:  {
                bloqueado:    true,
                bloqueioTipo: 'AGUARDANDO_APROVACAO',
                bloqueioExpira: null,
                ...(vetEmpresaId ? { empresaId: vetEmpresaId, equipeId: vetEquipeId } : {}),
              },
            });

            if (proprietarioEmailParaEmail) {
              emailService.enviarSolicitacaoVinculoProprietario({
                proprietarioEmail: proprietarioEmailParaEmail,
                proprietarioNome:  proprietarioNomeParaEmail,
                animalNome:        animal.nome,
                vetNome:           vetNomeCompleto,
                token:             tokenVinculo,
                isNewUser:         isNewProprietario,
                senhaInicial:      isNewProprietario ? 'Inicial#001' : undefined,
              })
                .then(() => console.log(`[emailService] Email ao proprietário enviado → ${proprietarioEmailParaEmail}`))
                .catch(err => console.error('[emailService] FALHA ao enviar para proprietário:', err?.message ?? err));
            } else {
              console.warn('[emailService] Proprietário sem email — notificação não enviada');
            }
          } else {
            // Vínculo direto (ACEITO) — sem bloqueio; e-mail informativo ao proprietário
            const empIdNovo = vetEmpresaId;
            let clinicaNomeNovo = null;
            if (empIdNovo) {
              const empresaNova = await prisma.empresa.findUnique({ where: { id: empIdNovo }, select: { nome: true } });
              clinicaNomeNovo = empresaNova?.nome ?? null;
            }

            await prisma.vetAnimalSolicitacao.create({
              data: {
                animalId:      animal.id,
                vetUserId:     Number(req.user.id),
                tipo:          'VINCULO',
                status:        'ACEITO',
                solicitanteId: Number(req.user.id),
              },
            });

            await prisma.animal.update({
              where: { id: animal.id },
              data:  {
                bloqueado:          false,
                bloqueioTipo:       null,
                bloqueioExpira:     null,
                veterinarioNome:    vetNomeCompleto,
                veterinarioClinica: clinicaNomeNovo,
                ...(empIdNovo ? { empresaId: empIdNovo, equipeId: vetEquipeId } : {}),
              },
            });

            await garantirFaturaAberta(Number(targetUserId));

            // E-mail meramente informativo ao proprietário (sem link de aprovação)
            if (proprietarioEmailParaEmail) {
              emailService.enviarVinculoInformativo({
                proprietarioEmail: proprietarioEmailParaEmail,
                proprietarioNome:  proprietarioNomeParaEmail,
                animalNome:        animal.nome,
                vetNome:           vetNomeCompleto,
                isNewUser:         isNewProprietario,
                senhaInicial:      isNewProprietario ? 'Inicial#001' : undefined,
              })
                .then(() => console.log(`[emailService] Email informativo enviado → ${proprietarioEmailParaEmail}`))
                .catch(err => console.error('[emailService] FALHA ao enviar informativo:', err?.message ?? err));
            } else {
              console.warn('[emailService] Proprietário sem email — notificação informativa não enviada');
            }
          }
        }
      }

      // Vet responsável indicado no cadastro → vínculo DIRETO (ACEITO).
      // Animal novo não tem vet sendo trocado — o cadastro segue normalmente,
      // sem solicitação por e-mail (solicitação existe apenas na TROCA, na edição).
      // Normaliza o valor: FormData com campo duplicado chega como array ['5','5']
      const vetIdRaw = Array.isArray(veterinarioUserId) ? veterinarioUserId[0] : veterinarioUserId;
      const vetIdParaSolicitar = vetIdRaw ? Number(vetIdRaw) : null;
      if (!isVet && vetIdParaSolicitar && !isNaN(vetIdParaSolicitar)) {
        await vincularVetDireto({ animalId: animal.id, vetId: vetIdParaSolicitar });
      }

      res.status(201).json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.criar]', error);
      if (error.message === 'VET_MEMBRO_SEM_RESPONSABILIDADE') {
        return res.status(400).json({
          sucesso: false,
          mensagem: `O veterinário "${error.vetNome}" tem cargo ${error.cargo} na equipe e não pode ser vinculado diretamente como responsável. Selecione um veterinário GESTOR ou o proprietário da clínica.`,
        });
      }
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao criar animal' });
    }
  }

  // ── PUT /api/animais/:id ─────────────────────────────────────────────────

  async atualizar(req, res) {
    const animalId = Number(req.params.id);
    const {
      nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      veterinarioUserId, local, baia, localizacaoId, tratadorId,
      pelagem, altura, registroPassaporte, finalidade, seguradora,
    } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const acessoAtu = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acessoAtu === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acessoAtu)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );
      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      const solicitacaoAtual = await prisma.vetAnimalSolicitacao.findFirst({
        where:   { animalId, status: 'ACEITO', tipo: 'VINCULO' },
        select:  { vetUserId: true, veterinario: { select: { fullName: true, email: true } } },
      });
      const vetAtualId = solicitacaoAtual?.vetUserId ?? null;
      // Normaliza: FormData com campo duplicado pode chegar como array
      const vetIdRawUpd = Array.isArray(veterinarioUserId) ? veterinarioUserId[0] : veterinarioUserId;
      const novoVetId   = vetIdRawUpd ? Number(vetIdRawUpd) : null;
      const vetMudou    = novoVetId !== null && !isNaN(novoVetId) && novoVetId !== vetAtualId;
      const vetRemovido = (novoVetId === null || isNaN(novoVetId)) && vetAtualId !== null;

      const animalAtual = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { userId: true, empresaId: true, user: { select: { fullName: true, email: true, phone: true } } },
      });

      if (baia?.trim()) {
        const scopeBaia   = animalAtual?.empresaId
          ? { empresaId: animalAtual.empresaId }
          : { userId: animalAtual?.userId };
        const localNorm   = local?.trim() || null;
        const baiaOcupada = await prisma.animal.findFirst({
          where: {
            baia:  { equals: baia.trim(), mode: 'insensitive' },
            local: localNorm ? { equals: localNorm, mode: 'insensitive' } : null,
            ativo: true,
            id:    { not: animalId },
            ...scopeBaia,
          },
          select: { nome: true },
        });
        if (baiaOcupada) {
          const localLabel = localNorm ? ` (${localNorm})` : '';
          return res.status(409).json({ sucesso: false, mensagem: `A baia "${baia.trim()}"${localLabel} já está ocupada por ${baiaOcupada.nome}` });
        }
      }

      const photoUrl = req.file ? await storage.upload(req.file, '') : undefined;

      const animal = await prisma.animal.update({
        where: { id: animalId },
        data: {
          nome:            nome.trim(),
          peso:            parseFloat(peso) || 0,
          dataNascimento:  dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:       dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          local:          local?.trim() || null,
          baia:           baia?.trim()  || null,
          localizacaoId:  localizacaoId !== undefined ? (localizacaoId ? Number(localizacaoId) : null) : undefined,
          tratadorId:     tratadorId    !== undefined ? (tratadorId    ? Number(tratadorId)    : null) : undefined,
          pelagem:            pelagem?.trim()            ?? null,
          altura:             altura?.trim()             ?? null,
          registroPassaporte: registroPassaporte?.trim() ?? null,
          finalidade:         finalidade?.trim()         ?? null,
          seguradora:         seguradora?.trim()         ?? null,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          ...(photoUrl && { photoUrl }),
        },
      });

      if (vetMudou) {
        if (vetAtualId) {
          // TROCA do vet responsável → único caso que dispara solicitação (TROCA_VET)
          await criarSolicitacaoPendente({
            animalId,
            novoVetId,
            animalNome:        animal.nome,
            solicitanteId:     req.user.id,
            proprietarioNome:  animalAtual?.user?.fullName || 'Proprietário',
            proprietarioEmail: animalAtual?.user?.email    || null,
            proprietarioPhone: animalAtual?.user?.phone    || null,
          });
        } else {
          // Animal sem vet → atribuição direta, sem solicitação
          await vincularVetDireto({ animalId, vetId: novoVetId });
        }
      }

      if (vetRemovido && vetAtualId) {
        // Cria solicitação PENDENTE de DESVINCULO (mesma lógica do vínculo, mas ao contrário)
        const token     = gerarToken();
        const expiresAt = gerarExpiracao(1); // 24 horas
        await prisma.vetAnimalSolicitacao.update({
          where: { animalId_vetUserId: { animalId, vetUserId: vetAtualId } },
          data:  {
            tipo:          'DESVINCULO',
            status:        'PENDENTE',
            mensagem:      'Proprietário quer remover o seu acesso ao animal',
            approvalToken: token,
            expiresAt,
          },
        });
        if (solicitacaoAtual?.veterinario?.email) {
          emailService.enviarSolicitacaoDesvinculo({
            vetEmail:         solicitacaoAtual.veterinario.email,
            vetNome:          solicitacaoAtual.veterinario.fullName,
            animalNome:       animal.nome,
            proprietarioNome: animalAtual?.user?.fullName || 'Proprietário',
            token,
          }).catch(err => console.error('[emailService] Falha ao enviar desvinculo:', err));
        }
      }

      const animalAtualizado = await prisma.animal.findUnique({
        where:   { id: animalId },
        include: ANIMAL_INCLUDE,
      });
      res.json({ sucesso: true, dados: animalAtualizado });
    } catch (error) {
      console.error('[AnimalController.atualizar]', error);
      if (error.message === 'VET_MEMBRO_SEM_RESPONSABILIDADE') {
        return res.status(400).json({
          sucesso: false,
          mensagem: `O veterinário "${error.vetNome}" tem cargo ${error.cargo} na equipe e não pode ser vinculado diretamente como responsável. Selecione um veterinário GESTOR ou o proprietário da clínica.`,
        });
      }
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao atualizar animal' });
    }
  }

  // ── DELETE /api/animais/:id — soft delete (ativo=false), preserva histórico ─

  async excluir(req, res) {
    const animalId = Number(req.params.id);
    const { motivo } = req.body ?? {};
    try {
      if (!motivo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da exclusão' });
      }

      const acessoExc = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acessoExc === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acessoExc)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { nome: true, especie: { select: { nome: true } } },
      });

      await prisma.$transaction(async (tx) => {
        await tx.animal.update({ where: { id: animalId }, data: { ativo: false } });
        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'ANIMAL',
          entidadeId: animalId,
          animalId,
          motivo,
          detalhes:   `${animal?.nome ?? 'Animal'}${animal?.especie?.nome ? ` (${animal.especie.nome})` : ''}`,
        });
      });

      res.json({ sucesso: true, mensagem: 'Animal inativado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.excluir]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir animal' });
    }
  }

  // ── POST /api/animais/vincular-vet ───────────────────────────────────────
  // Uso restrito: vínculo direto ACEITO (apenas quando vet cria animal para si mesmo)

  async vincularVet(req, res) {
    const { animalId, vetUserId } = req.body;
    if (!animalId || !vetUserId) {
      return res.status(400).json({ sucesso: false, mensagem: 'animalId e vetUserId são obrigatórios' });
    }
    try {
      await prisma.vetAnimalSolicitacao.upsert({
        where:  { animalId_vetUserId: { animalId: Number(animalId), vetUserId: Number(vetUserId) } },
        create: { animalId: Number(animalId), vetUserId: Number(vetUserId), tipo: 'VINCULO', status: 'ACEITO' },
        update: { tipo: 'VINCULO', status: 'ACEITO', approvalToken: null, expiresAt: null },
      });
      const animalDados = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { userId: true } });
      await garantirFaturaAberta(animalDados?.userId);
      res.json({ sucesso: true, mensagem: 'Vínculo criado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.vincularVet]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── DELETE /api/animais/:id/cancelar-solicitacao ────────────────────────
  // Proprietário cancela uma solicitação pendente e desfaz o estado.
  // VINCULO    PENDENTE → CANCELADO
  // DESVINCULO PENDENTE → restaura VINCULO ACEITO (vet mantém acesso)
  // TROCA_VET  PENDENTE → restaura VINCULO ACEITO (sem novoVet)
  // TROCA_VET  ACEITO   + VINCULO PENDENTE (step 2) → cancela step 2 e restaura vet anterior

  async cancelarSolicitacao(req, res) {
    const animalId = Number(req.params.id);
    const userId   = Number(req.user?.id);

    if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado' });

    try {
      const animal = await prisma.animal.findFirst({
        where:  { id: animalId, userId },
        select: { id: true, nome: true },
      });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado ou sem permissão' });

      // Solicitações PENDENTE para este animal
      const pendentes = await prisma.vetAnimalSolicitacao.findMany({
        where: { animalId, status: 'PENDENTE' },
      });

      if (pendentes.length === 0) {
        // Verifica step 2 de TROCA_VET (old vet aceitou, new vet ainda pendente)
        const trocaAceita = await prisma.vetAnimalSolicitacao.findFirst({
          where: { animalId, tipo: 'TROCA_VET', status: 'ACEITO', novoVetUserId: { not: null } },
        });
        if (trocaAceita) {
          await prisma.$transaction([
            // Cancela VINCULO PENDENTE do novo vet
            prisma.vetAnimalSolicitacao.updateMany({
              where: { animalId, vetUserId: trocaAceita.novoVetUserId, status: 'PENDENTE' },
              data:  { status: 'CANCELADO', approvalToken: null, expiresAt: null },
            }),
            // Restaura acesso do vet original
            prisma.vetAnimalSolicitacao.update({
              where: { id: trocaAceita.id },
              data:  { tipo: 'VINCULO', status: 'ACEITO', novoVetUserId: null, approvalToken: null, expiresAt: null, mensagem: null },
            }),
          ]);
          return res.json({ sucesso: true, mensagem: 'Troca cancelada. Veterinário anterior restaurado.' });
        }
        return res.status(404).json({ sucesso: false, mensagem: 'Nenhuma solicitação pendente encontrada' });
      }

      // Processa cada PENDENTE por tipo
      const ops = pendentes.map(sol => {
        if (sol.tipo === 'VINCULO') {
          return prisma.vetAnimalSolicitacao.update({
            where: { id: sol.id },
            data:  { status: 'CANCELADO', approvalToken: null, expiresAt: null },
          });
        }
        if (sol.tipo === 'DESVINCULO') {
          // Restaura vínculo: vet mantém acesso
          return prisma.vetAnimalSolicitacao.update({
            where: { id: sol.id },
            data:  { tipo: 'VINCULO', status: 'ACEITO', approvalToken: null, expiresAt: null, mensagem: null },
          });
        }
        if (sol.tipo === 'TROCA_VET') {
          // Restaura vínculo: vet atual mantém acesso, novo vet descartado
          return prisma.vetAnimalSolicitacao.update({
            where: { id: sol.id },
            data:  { tipo: 'VINCULO', status: 'ACEITO', novoVetUserId: null, approvalToken: null, expiresAt: null, mensagem: null },
          });
        }
        return null;
      }).filter(Boolean);

      await prisma.$transaction(ops);
      res.json({ sucesso: true, mensagem: 'Solicitação cancelada com sucesso.' });
    } catch (error) {
      console.error('[AnimalController.cancelarSolicitacao]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── PATCH /api/animais/solicitacoes/:id/responder ───────────────────────
  // Proprietário responde (pela plataforma) a um convite iniciado pelo veterinário.

  async responderSolicitacaoVet(req, res) {
    const solId          = Number(req.params.id);
    const proprietarioId = Number(req.user?.id);
    const { status }     = req.body;

    if (!['ACEITO', 'RECUSADO'].includes(status)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Status inválido. Use ACEITO ou RECUSADO' });
    }

    try {
      const solicitacao = await prisma.vetAnimalSolicitacao.findFirst({
        where: {
          id:     solId,
          status: 'PENDENTE',
          animal: { userId: proprietarioId },
        },
        include: {
          animal:      { select: { id: true, nome: true } },
          veterinario: { select: { fullName: true, email: true } },
        },
      });

      if (!solicitacao) {
        return res.status(404).json({ sucesso: false, mensagem: 'Solicitação não encontrada ou sem permissão' });
      }

      if (solicitacao.tipo === 'DESVINCULO') {
        // Vet-iniciado: proprietário decide se aceita a remoção do vet
        if (status === 'ACEITO') {
          // Proprietário aceita → vet perde acesso, animal desvinculado da empresa/equipe
          await prisma.vetAnimalSolicitacao.update({
            where: { id: solId },
            data:  { status: 'ACEITO', approvalToken: null, expiresAt: null },
          });
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  { veterinarioNome: null, veterinarioClinica: null, empresaId: null, equipeId: null },
          });
        } else {
          // Proprietário recusa → restaura VINCULO ACEITO
          await prisma.vetAnimalSolicitacao.update({
            where: { id: solId },
            data:  { tipo: 'VINCULO', status: 'ACEITO', approvalToken: null, expiresAt: null, mensagem: null },
          });
        }
      } else {
        // VINCULO: comportamento original
        await prisma.vetAnimalSolicitacao.update({
          where: { id: solId },
          data:  { status, approvalToken: null, expiresAt: null },
        });

        if (status === 'ACEITO') {
          const ctx = await getContextoDoVet(solicitacao.vetUserId);
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  {
              bloqueado:      false,
              bloqueioTipo:   null,
              bloqueioExpira: null,
              ...(ctx.empresaId ? { empresaId: ctx.empresaId, equipeId: ctx.equipeId } : {}),
            },
          });
          await garantirFaturaAberta(proprietarioId);
        } else {
          await prisma.animal.update({
            where: { id: solicitacao.animalId },
            data:  { veterinarioNome: null, veterinarioClinica: null },
          });
        }
      }

      const proprietario = await prisma.user.findUnique({
        where:  { id: proprietarioId },
        select: { fullName: true },
      });

      if (status === 'ACEITO' && solicitacao.tipo !== 'DESVINCULO') {
        const empId = await getEmpresaIdDoVet(solicitacao.vetUserId);
        if (empId) {
          notificarGestoresDaEmpresa(empId, {
            animalNome:       solicitacao.animal.nome,
            proprietarioNome: proprietario?.fullName || 'Proprietário',
            vetNome:          solicitacao.veterinario.fullName,
          }).catch(() => {});
        }
      }

      emailService.enviarConfirmacaoVinculo({
        proprietarioEmail: solicitacao.veterinario.email,
        proprietarioNome:  solicitacao.veterinario.fullName,
        animalNome:        solicitacao.animal.nome,
        vetNome:           proprietario?.fullName || 'Proprietário',
        aceito:            status === 'ACEITO',
      }).catch(err => console.error('[emailService] Falha ao notificar vet:', err?.message));

      const isDesvinculo = solicitacao.tipo === 'DESVINCULO';
      res.json({
        sucesso:  true,
        aceito:   status === 'ACEITO',
        mensagem: isDesvinculo
          ? (status === 'ACEITO'
              ? `Remoção de Dr(a). ${solicitacao.veterinario.fullName} confirmada.`
              : `Vínculo mantido. Dr(a). ${solicitacao.veterinario.fullName} continua responsável.`)
          : (status === 'ACEITO'
              ? `Vínculo com Dr(a). ${solicitacao.veterinario.fullName} autorizado!`
              : 'Vínculo recusado. O veterinário foi notificado.'),
      });
    } catch (error) {
      console.error('[AnimalController.responderSolicitacaoVet]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── DELETE /api/animais/:id/desvincular-vet ─────────────────────────────
  // Cria DESVINCULO PENDENTE aguardando aprovação do proprietário (24h → auto-aceite via cron)

  async desvincularVet(req, res) {
    const animalId  = Number(req.params.id);
    const vetUserId = Number(req.user.id);

    try {
      const animal = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { nome: true, user: { select: { fullName: true, email: true } } },
      });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });

      const solAtiva = await prisma.vetAnimalSolicitacao.findFirst({
        where: {
          animalId, vetUserId,
          OR: [
            { tipo: 'VINCULO',    status: 'ACEITO'   },
            { tipo: 'DESVINCULO', status: 'PENDENTE' },
          ],
        },
      });

      if (!solAtiva) {
        return res.status(404).json({ sucesso: false, mensagem: 'Vínculo ativo não encontrado' });
      }

      // Já existe solicitação pendente — evita duplicata
      if (solAtiva.tipo === 'DESVINCULO' && solAtiva.status === 'PENDENTE') {
        return res.status(409).json({
          sucesso:  false,
          mensagem: 'Já existe uma solicitação de desvinculação aguardando aprovação do proprietário',
        });
      }

      const token     = gerarToken();
      const expiresAt = gerarExpiracao(1); // 24 horas

      await prisma.vetAnimalSolicitacao.update({
        where: { id: solAtiva.id },
        data: {
          tipo:          'DESVINCULO',
          status:        'PENDENTE',
          solicitanteId: vetUserId,
          approvalToken: token,
          expiresAt,
          mensagem:      'Veterinário solicitou a remoção do próprio acesso ao animal',
        },
      });

      // Email ao proprietário com links de aprovar/recusar
      if (animal.user?.email) {
        const vet = await prisma.user.findUnique({
          where:  { id: vetUserId },
          select: { fullName: true },
        });
        emailService.enviarSolicitacaoDesvinculoProprietario({
          proprietarioEmail: animal.user.email,
          proprietarioNome:  animal.user.fullName,
          animalNome:        animal.nome,
          vetNome:           vet?.fullName || 'Veterinário',
          token,
        }).catch(err => console.error('[emailService] Falha ao enviar desvinculo ao proprietário:', err));
      }

      res.json({
        sucesso:  true,
        mensagem: 'Solicitação de desvinculação enviada ao proprietário. O acesso será removido após aprovação ou em 24 horas.',
      });
    } catch (error) {
      console.error('[AnimalController.desvincularVet]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }
}

module.exports = new AnimalController();