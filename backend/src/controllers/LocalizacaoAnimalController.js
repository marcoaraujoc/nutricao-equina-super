// backend/src/controllers/LocalizacaoAnimalController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { podeAlterarRegistroEscopado } = require('../lib/cadastroScopeAccess');
const { registrarAuditoria, registrarAlteracao } = require('../lib/auditoria');

// Mapeamento estático: tipoLocalizacao → espécies atendidas (null = TODOS)
const TIPO_ESPECIES = {
  CANIL:               ['Canino'],
  CENTRO_REPRODUCAO:   ['Equino', 'Canino', 'Felino', 'Bovino'],
  CENTRO_TREINAMENTO:  ['Equino', 'Canino', 'Felino', 'Bovino'],
  CLINICA:             null,
  CLUBE:               null,
  CLUBE_HIPICO:        ['Equino'],
  CRIADOR:             null,
  FAZENDA:             null,
  GATIL:               ['Felino'],
  HARAS:               ['Equino'],
  HOSPITAL:            null,
  HOTEL_ANIMAL:        ['Canino', 'Felino', 'Réptil'],
  ONG:                 null,
  OUTRO:               null,
  PETSHOP:             ['Canino', 'Felino', 'Réptil'],
  PROPRIETARIO:        null,
};

const TIPOS_VALIDOS = Object.keys(TIPO_ESPECIES);

const normalizarTexto = v => (v ?? '').trim().toLowerCase();

// ─── Helper: verifica duplicidade por nome, escopado por empresa ──────────────
// Escopo: mesma visibilidade da listagem (empresaId null = global/SYSTEM, OU empresa alvo)
// excludeId: ignora o próprio registro (usado no update)
async function verificarDuplicidade({ nome, empresaId, excludeId = null }) {
  const nomeNorm = normalizarTexto(nome);
  if (!nomeNorm) return null;

  const candidatos = await prisma.localizacaoAnimal.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ empresaId: null }, { empresaId: empresaId ?? -1 }],
    },
  });

  const dup = candidatos.find(c => normalizarTexto(c.nome) === nomeNorm);
  return !!dup;
}

const LocalizacaoAnimalController = {

  // GET /api/cadastro/localizacoes?busca=X&ativo=true|false|all&especie=Equino&limit=10
  listar: async (req, res) => {
    try {
      const { busca, ativo, especie, limit } = req.query;
      // Catálogo grande (dezenas de milhares após importação): com `limit`, faz busca
      // server-side e devolve só os primeiros N — evita varrer/enviar tudo (autocomplete).
      const limitNum = limit ? Math.max(1, Math.min(Number(limit) || 0, 100)) : null;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      if (busca?.trim()) {
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { nome:              { contains: busca.trim(), mode: 'insensitive' } },
              { pessoaResponsavel: { contains: busca.trim(), mode: 'insensitive' } },
              { endereco:          { contains: busca.trim(), mode: 'insensitive' } },
              { cnpj:              { contains: busca.trim(), mode: 'insensitive' } },
            ],
          },
        ];
      }

      if (especie) {
        const tiposCompativeis = TIPOS_VALIDOS.filter(tipo => {
          const especies = TIPO_ESPECIES[tipo];
          return especies === null || especies.includes(especie);
        });
        where.tipoLocalizacao = { in: tiposCompativeis };
      }

      // Localização é CORPORATIVA (cross entre todas as empresas): não há escopo por
      // empresa/equipe na listagem — todos os usuários veem todas as localizações
      // (SYSTEM + CLIENTE de qualquer empresa), como um catálogo compartilhado.

      const localizacoes = await prisma.localizacaoAnimal.findMany({
        where,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
        // Busca uma folga (dedup pode reduzir) mas nunca varre a tabela inteira.
        ...(limitNum ? { take: Math.min(limitNum * 5, 300) } : {}),
      });

      // Catálogo corporativo: podem existir linhas duplicadas (mesmo nome+tipo)
      // criadas por empresas diferentes antes da unificação. Mostra apenas UMA por
      // nome+tipo, preferindo a linha que o usuário atual consegue gerenciar
      // (a da própria empresa), depois SYSTEM (global), depois o menor id.
      const prefScore = (l) => {
        if (req.empresaId && l.empresaId === req.empresaId) return 3; // própria empresa (editável)
        if (l.empresaId == null) return 2;                            // SYSTEM global
        return 1;
      };
      const melhorPorChave = new Map();
      for (const l of localizacoes) {
        const chave = `${normalizarTexto(l.nome)}|${l.tipoLocalizacao}`;
        const atual = melhorPorChave.get(chave);
        if (!atual
          || prefScore(l) > prefScore(atual)
          || (prefScore(l) === prefScore(atual) && l.id < atual.id)) {
          melhorPorChave.set(chave, l);
        }
      }
      const deduped = [...melhorPorChave.values()].sort((a, b) =>
        a.ativo === b.ativo ? a.nome.localeCompare(b.nome) : (a.ativo ? -1 : 1));

      res.json({ sucesso: true, dados: limitNum ? deduped.slice(0, limitNum) : deduped });
    } catch (err) {
      console.error('Erro ao listar localizações:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar localizações' });
    }
  },

  // GET /api/cadastro/localizacoes/tipos
  listarTipos: async (_req, res) => {
    const tipos = TIPOS_VALIDOS.map(tipo => ({
      value:   tipo,
      label:   tipo.replace(/_/g, ' '),
      especies: TIPO_ESPECIES[tipo] ?? ['TODOS'],
    }));
    res.json({ sucesso: true, dados: tipos });
  },

  // GET /api/cadastro/localizacoes/:id
  obterPorId: async (req, res) => {
    try {
      const loc = await prisma.localizacaoAnimal.findUnique({
        where: { id: Number(req.params.id) },
      });
      if (!loc) return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });
      res.json({ sucesso: true, dados: loc });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar localização' });
    }
  },

  // POST /api/cadastro/localizacoes
  // ADMIN cria com tipoEntrada=SYSTEM; demais criam com tipoEntrada=CLIENTE, escopado à empresa/equipe ativa
  criar: async (req, res) => {
    const { nome, cnpj, cep, endereco, pessoaResponsavel, telefone, tipoLocalizacao } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!tipoLocalizacao || !TIPOS_VALIDOS.includes(tipoLocalizacao))
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de localização inválido' });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';
    const empresaAlvo = tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null;
    const equipeAlvo  = tipoEntrada === 'CLIENTE' ? (req.equipeId ?? null)  : null;

    try {
      const duplicado = await verificarDuplicidade({ nome, empresaId: empresaAlvo });
      if (duplicado)
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma localização com esse nome' });

      const loc = await prisma.localizacaoAnimal.create({
        data: {
          nome:              nome.trim(),
          cnpj:              cnpj?.replace(/\D/g, '') || null,
          cep:               cep?.replace(/\D/g, '')  || null,
          endereco:          endereco?.trim()          || null,
          pessoaResponsavel: pessoaResponsavel?.trim() || null,
          telefone:          telefone?.trim()          || null,
          tipoLocalizacao,
          tipoEntrada,
          empresaId:         empresaAlvo,
          equipeId:          equipeAlvo,
        },
      });
      await registrarAuditoria(prisma, req, {
        categoria:  'CRIACAO',
        entidade:   'LOCALIZACAO',
        entidadeId: loc.id,
        detalhes:   `${loc.nome} — ${loc.tipoLocalizacao.replace(/_/g, ' ')}`,
      });
      res.status(201).json({ sucesso: true, dados: loc });
    } catch (err) {
      console.error('Erro ao criar localização:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar localização' });
    }
  },

  // PUT /api/cadastro/localizacoes/:id — ALTERAÇÃO EXCLUSIVA DO ADMIN
  atualizar: async (req, res) => {
    if (req.user?.role !== 'ADMIN' && req.user?.userType !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas o ADMIN pode alterar localizações.' });

    const { id } = req.params;
    const { nome, cnpj, cep, endereco, pessoaResponsavel, telefone, tipoLocalizacao } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (tipoLocalizacao && !TIPOS_VALIDOS.includes(tipoLocalizacao))
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de localização inválido' });

    try {
      const existe = await prisma.localizacaoAnimal.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar esta localização.' });

      const duplicado = await verificarDuplicidade({ nome, empresaId: existe.empresaId, excludeId: Number(id) });
      if (duplicado)
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma localização com esse nome' });

      const loc = await prisma.localizacaoAnimal.update({
        where: { id: Number(id) },
        data: {
          nome:              nome.trim(),
          cnpj:              cnpj?.replace(/\D/g, '') || null,
          cep:               cep?.replace(/\D/g, '')  || null,
          endereco:          endereco?.trim()          || null,
          pessoaResponsavel: pessoaResponsavel?.trim() || null,
          telefone:          telefone?.trim()          || null,
          ...(tipoLocalizacao && { tipoLocalizacao }),
        },
      });

      await registrarAlteracao(prisma, req, {
        entidade:   'LOCALIZACAO',
        entidadeId: Number(id),
        campos: {
          'nome':               { de: existe.nome,              para: loc.nome },
          'CNPJ':               { de: existe.cnpj,              para: loc.cnpj },
          'CEP':                { de: existe.cep,               para: loc.cep },
          'endereço':           { de: existe.endereco,          para: loc.endereco },
          'pessoa responsável': { de: existe.pessoaResponsavel, para: loc.pessoaResponsavel },
          'telefone':           { de: existe.telefone,          para: loc.telefone },
          'tipo':               { de: existe.tipoLocalizacao,   para: loc.tipoLocalizacao },
        },
      });

      res.json({ sucesso: true, dados: loc });
    } catch (err) {
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });
      console.error('Erro ao atualizar localização:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar localização' });
    }
  },

  // PATCH /api/cadastro/localizacoes/:id/toggle — ATIVAR/INATIVAR EXCLUSIVO DO ADMIN
  toggleAtivo: async (req, res) => {
    if (req.user?.role !== 'ADMIN' && req.user?.userType !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas o ADMIN pode ativar/inativar localizações.' });

    const { id } = req.params;
    try {
      const existe = await prisma.localizacaoAnimal.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Localização não encontrada' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar esta localização.' });

      const loc = await prisma.localizacaoAnimal.update({
        where: { id: Number(id) },
        data: { ativo: !existe.ativo },
      });
      await registrarAuditoria(prisma, req, {
        categoria:  'ALTERACAO',
        entidade:   'LOCALIZACAO',
        entidadeId: loc.id,
        detalhes:   `${req.user.fullName ?? req.user.email} ${loc.ativo ? 'ativou' : 'inativou'} a localização ${loc.nome}`,
      });
      res.json({
        sucesso: true,
        dados: loc,
        mensagem: `Localização ${loc.ativo ? 'ativada' : 'inativada'} com sucesso`,
      });
    } catch (err) {
      console.error('Erro ao alternar status da localização:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = LocalizacaoAnimalController;
module.exports.TIPO_ESPECIES = TIPO_ESPECIES;
module.exports.TIPOS_VALIDOS = TIPOS_VALIDOS;
