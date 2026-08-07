// backend/src/controllers/VeterinarioController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
// Fonte ÚNICA do escopo de listagem de animal (fase 3 do multi-tenancy).
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { aplicarPerfilEmLista: aplicarPerfilProprietarioEmLista } = require('../lib/proprietarioPerfil');
// Critério ÚNICO de "quem é cliente desta empresa" — vem do Cadastro de Clientes.
const {
  whereProprietarioNoEscopo,
  whereEhClienteDaEmpresa,
} = require('./ProprietarioController');

const prisma = new PrismaClient();

// ⚠️ FASE 3 DO MULTI-TENANCY — saíram daqui `gerarToken`/`gerarExpiracao` (o token de
// aprovação de 24h dos e-mails) e `podeReceberSolicitacoes`, que decidia quem podia
// receber pedido de VINCULO/DESVINCULO/TROCA_VET. Não há mais pedido a receber.

// ─── Controller ───────────────────────────────────────────────────────────────

const VeterinarioController = {

  // ── GET /api/veterinarios ─────────────────────────────────────────────────
  listar: async (req, res) => {
    try {
      const { especieId, escopo } = req.query;

      // escopo=equipe: apenas os veterinários da equipe/empresa ATIVA do solicitante
      // (usado no cadastro de animal pelo gestor — não lista todos os vets do S2Vet).
      // Sem contexto de equipe (ex: proprietário), cai no comportamento padrão abaixo.
      if (escopo === 'equipe' && (req.equipeId || req.empresaId)) {
        const membros = await prisma.membroEquipe.findMany({
          where: {
            ...(req.equipeId
              ? { equipeId: Number(req.equipeId) }
              : { equipe: { empresaId: Number(req.empresaId) } }),
            // Só cargos clínicos responsáveis — prestador (cargo FORNECEDOR) da
            // equipe não é vet responsável dela, mesmo com userType VETERINARIO
            cargo: { in: ['GESTOR', 'VETERINARIO'] },
            user:  { userType: 'VETERINARIO', ativo: true },
          },
          include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
        });

        const usuarios = [...new Map(membros.map(m => [m.user.id, m.user])).values()];
        const perfis = usuarios.length > 0
          ? await prisma.vetPerfil.findMany({
              where:   { userId: { in: usuarios.map(u => u.id) } },
              include: { especies: { include: { especie: { select: { id: true, nome: true } } } } },
            })
          : [];
        const perfilPorUser = new Map(perfis.map(p => [p.userId, p]));

        const dados = usuarios
          .map(u => {
            const p = perfilPorUser.get(u.id);
            return {
              vetUserId: u.id,
              crmv:      p?.crmv ?? null,
              bio:       p?.bio  ?? null,
              nome:      u.fullName,
              email:     u.email,
              telefone:  u.phone,
              especies:  (p?.especies ?? []).map(ve => ({ id: ve.especie.id, nome: ve.especie.nome })),
            };
          })
          .sort((a, b) => a.nome.localeCompare(b.nome));

        return res.json({ sucesso: true, dados });
      }

      // Apenas vets sem vínculo de equipe (standalone) ou que sejam gestores da equipe.
      // Vets convidados (membros com cargo != GESTOR) não aparecem para proprietários.
      const where = {
        user: {
          OR: [
            { membrosEquipe: { none: {} } },
            { membrosEquipe: { some: { cargo: 'GESTOR' } } },
          ],
        },
      };
      if (especieId) {
        where.especies = { some: { especieId: Number(especieId) } };
      }

      const perfis = await prisma.vetPerfil.findMany({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, email: true, phone: true },
          },
          especies: {
            include: { especie: { select: { id: true, nome: true } } },
          },
        },
        orderBy: { user: { fullName: 'asc' } },
      });

      const dados = perfis.map(p => ({
        vetUserId: p.userId,
        crmv:      p.crmv,
        bio:       p.bio,
        nome:      p.user.fullName,
        email:     p.user.email,
        telefone:  p.user.phone,
        especies:  p.especies.map(ve => ({ id: ve.especie.id, nome: ve.especie.nome })),
      }));

      res.json({ sucesso: true, dados });
    } catch (error) {
      console.error('[VeterinarioController.listar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/proprietarios ───────────────────────────────────
  listarProprietarios: async (req, res) => {
    try {
      // ISOLAMENTO POR EMPRESA: este endpoint listava `userType: 'PROPRIETARIO'`
      // sem NENHUM filtro de empresa — ou seja, devolvia nome, e-mail e telefone de
      // TODOS os clientes da plataforma para qualquer usuário autenticado (a rota nem
      // tem checkPermission). Agora usa o mesmo par de predicados do Cadastro de
      // Clientes: `whereEhClienteDaEmpresa` ("é cliente") + `whereProprietarioNoEscopo`
      // ("é cliente DAQUI"), para não haver dois critérios de escopo no sistema.
      const isAdmin = req.user?.role === 'ADMIN';

      // Sem empresa no contexto não há como delimitar o tenant: devolve vazio em vez
      // de cair numa consulta global (fail-closed).
      if (!isAdmin && !req.empresaId) {
        return res.json({ sucesso: true, dados: [] });
      }

      const where = { ativo: true, AND: [whereEhClienteDaEmpresa(req.empresaId)] };

      if (!isAdmin) {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        where.AND.push(whereProprietarioNoEscopo(req.empresaId, equipeScope));
      }

      const proprietarios = await prisma.user.findMany({
        where,
        select:  { id: true, fullName: true, email: true, phone: true },
        orderBy: { fullName: 'asc' },
      });

      // Nome/telefone conforme o cadastro DESTA empresa (o `users` só guarda identidade).
      const dados = await aplicarPerfilProprietarioEmLista(proprietarios, req.empresaId);
      res.json({ sucesso: true, dados });
    } catch (error) {
      console.error('[VeterinarioController.listarProprietarios]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── GET /api/veterinarios/perfil ──────────────────────────────────────────
  obterPerfil: async (req, res) => {
    try {
      const userId = req.user.id;

      let perfil = await prisma.vetPerfil.findUnique({
        where:   { userId },
        include: {
          especies: {
            include: { especie: { select: { id: true, nome: true } } },
          },
        },
      });

      if (!perfil) {
        perfil = await prisma.vetPerfil.create({
          data:    { userId },
          include: {
            especies: {
              include: { especie: { select: { id: true, nome: true } } },
            },
          },
        });
      }

      res.json({
        sucesso: true,
        dados: {
          ...perfil,
          especies: perfil.especies.map(ve => ({ id: ve.especie.id, nome: ve.especie.nome })),
        },
      });
    } catch (error) {
      console.error('[VeterinarioController.obterPerfil]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── PUT /api/veterinarios/perfil ──────────────────────────────────────────
  atualizarPerfil: async (req, res) => {
    try {
      const userId = req.user.id;
      const { crmv, bio, especieIds } = req.body;

      let perfil = await prisma.vetPerfil.findUnique({ where: { userId } });
      if (!perfil) {
        perfil = await prisma.vetPerfil.create({ data: { userId } });
      }

      await prisma.vetPerfil.update({
        where: { id: perfil.id },
        data:  { crmv: crmv ?? perfil.crmv, bio: bio ?? perfil.bio },
      });

      if (Array.isArray(especieIds)) {
        await prisma.vetEspecie.deleteMany({ where: { vetPerfilId: perfil.id } });
        if (especieIds.length > 0) {
          await prisma.vetEspecie.createMany({
            data:           especieIds.map(eid => ({ vetPerfilId: perfil.id, especieId: Number(eid) })),
            skipDuplicates: true,
          });
        }
      }

      res.json({ sucesso: true, mensagem: 'Perfil atualizado com sucesso' });
    } catch (error) {
      console.error('[VeterinarioController.atualizarPerfil]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ⚠️ FASE 3 DO MULTI-TENANCY — MÉTODOS DE VÍNCULO REMOVIDOS:
  //   solicitarVinculo / solicitarVinculoVet   (os dois sentidos do pedido)
  //   listarSolicitacoes / listarPendentes     (filas de aprovação)
  //   responderSolicitacao / responderViaEmail (aceite pelo app e pelo link do e-mail)
  // As rotas já haviam saído de routes/veterinarios.js; estes eram os corpos órfãos.
  // Não recriar: o acesso ao paciente vem de ele pertencer à EMPRESA.


  // ── GET /api/veterinarios/meus-animais ────────────────────────────────────
  meusAnimais: async (req, res) => {
    try {
      // ⚠️ FASE 3 DO MULTI-TENANCY — esta rota tinha a SUA PRÓPRIA regra de escopo,
      // cópia da que vivia em `AnimalController.listar`, base × convidado inclusive:
      // para dono/gestor ela acrescentava `{ solicitacoes: { some: { vetUserId, status:
      // 'ACEITO' } } }` FORA do filtro de empresa — ou seja, devolvia animal de OUTRA
      // clínica. É o mesmo vazamento que `lib/animalScope.js` já havia fechado, e que
      // seguia vivo aqui só porque a regra estava escrita duas vezes.
      //
      // Agora usa a FONTE ÚNICA. Regra para rota nova que liste animal: chamar
      // `buildAnimalScopeWhere(req)`, nunca reescrever o `where` à mão.
      const { where } = await buildAnimalScopeWhere(req);

      const animais = await prisma.animal.findMany({
        where:   { ...where, ativo: true },
        include: {
          especie: { select: { id: true, nome: true } },
          raca:    { select: { id: true, nome: true } },
          user:    { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { dataCadastro: 'desc' },
      });

      res.json({ sucesso: true, dados: animais });
    } catch (error) {
      console.error('[VeterinarioController.meusAnimais]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = VeterinarioController;