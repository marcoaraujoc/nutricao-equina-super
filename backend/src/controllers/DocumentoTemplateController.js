// backend/src/controllers/DocumentoTemplateController.js
//
// Modelos de documento da Central de Documentos.
//
// 🔴 COPY-ON-WRITE É A REGRA DA CASA AQUI. A tabela é CATÁLOGO MISTO: `empresaId`
// nulo = modelo GLOBAL do sistema (os 12 anexos da Res. CFMV 1.321/2020), que toda
// clínica LÊ e nenhuma ESCREVE. Alterar ou favoritar um global não altera o global:
// cria a cópia daquela empresa (`origemId` aponta para a origem) e a alteração vai
// para a cópia. Sem isso, uma clínica reescreveria o atestado sanitário de todas as
// outras — e o RLS nem deixaria (a policy tem `WITH CHECK empresa_id = tenant`), o
// que apareceria como um erro cru de banco no meio da edição.
//
// A tabela está sob RLS (migration 20260918000000). O `empresaId` gravado é SEMPRE
// `req.empresaId` — nunca o que vier do corpo da requisição.
'use strict';

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');

const CATEGORIAS = new Set([
  'atendimento', 'receituarios', 'laudos', 'reproducao', 'cirurgias', 'sanidade',
  'rebanho', 'transporte', 'consentimentos', 'financeiro', 'personalizados',
]);
const ESPECIES = new Set(['EQUINO', 'BOVINO', 'AMBOS']);
const STATUS   = new Set(['RASCUNHO', 'PUBLICADO', 'ARQUIVADO']);

/** Histórico de versões capado — 30 é o que a tela mostra e o que cabe num JSONB sadio. */
const LIMITE_VERSOES = 30;

const SELECT_LISTA = {
  id: true, empresaId: true, chave: true, nome: true, descricao: true, categoria: true,
  especie: true, tags: true, favorito: true, compartilhado: true, excluido: true,
  status: true, origemId: true, autorNome: true, usos: true, versao: true,
  criadoEm: true, atualizadoEm: true,
};

const SELECT_COMPLETO = { ...SELECT_LISTA, blocos: true, versoes: true };

/** Forma devolvida ao front — espelha `Template` de modules/documentos/types.ts. */
function serializar(t) {
  return {
    id:            String(t.id),
    // O front usa isto para decidir entre "Editar" e "Personalizar": modelo do
    // sistema não se edita no lugar, vira cópia da clínica.
    global:        t.empresaId === null,
    chave:         t.chave ?? null,
    nome:          t.nome,
    descricao:     t.descricao ?? '',
    categoria:     t.categoria,
    especie:       t.especie,
    tags:          t.tags ?? [],
    blocos:        Array.isArray(t.blocos) ? t.blocos : [],
    favorito:      t.favorito,
    compartilhado: t.compartilhado,
    excluido:      t.excluido,
    status:        t.status,
    origemId:      t.origemId != null ? String(t.origemId) : null,
    autor:         t.autorNome ?? '',
    usos:          t.usos,
    criadoEm:      t.criadoEm,
    atualizadoEm:  t.atualizadoEm,
    versao:        t.versao,
    versoes:       Array.isArray(t.versoes) ? t.versoes : [],
  };
}

/** Valida e normaliza o que a tela manda. Campo ausente = não mexe. */
function saneia(body = {}) {
  const dados = {};
  if (typeof body.nome === 'string')      dados.nome      = body.nome.trim().slice(0, 160) || 'Novo modelo';
  if (typeof body.descricao === 'string') dados.descricao = body.descricao.trim().slice(0, 400);
  if (typeof body.categoria === 'string' && CATEGORIAS.has(body.categoria)) dados.categoria = body.categoria;
  if (typeof body.especie === 'string'   && ESPECIES.has(body.especie))     dados.especie   = body.especie;
  if (typeof body.status === 'string'    && STATUS.has(body.status))        dados.status    = body.status;
  if (Array.isArray(body.tags))   dados.tags   = body.tags.map(t => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  if (Array.isArray(body.blocos)) dados.blocos = body.blocos;
  if (typeof body.compartilhado === 'boolean') dados.compartilhado = body.compartilhado;
  return dados;
}

/** Nome do autor NESTA empresa — nunca o `users.fullName` global (§36-f). */
async function nomeDoAutor(req) {
  if (!req.user?.id) return '';
  if (req.empresaId) {
    const v = await prisma.usuarioEmpresa.findFirst({
      where: { userId: req.user.id, empresaId: req.empresaId }, select: { fullName: true },
    }).catch(() => null);
    if (v?.fullName) return v.fullName;
  }
  return req.user.fullName ?? '';
}

/**
 * Devolve um template que a EMPRESA pode escrever.
 *
 * Se `base` já é da empresa, é ele mesmo. Se é GLOBAL, cria a cópia da empresa aqui
 * e agora — é o copy-on-write descrito no topo. A cópia nasce com `usos: 0` e sem
 * histórico de versões: os dois são fatos do ORIGINAL, não da cópia.
 */
async function garantirCopiaDaEmpresa(client, base, req) {
  if (base.empresaId !== null) return base;
  const autorNome = await nomeDoAutor(req);
  return client.documentoTemplate.create({
    data: {
      empresaId:     req.empresaId,
      chave:         base.chave,          // preserva a origem normativa
      nome:          base.nome,
      descricao:     base.descricao,
      categoria:     base.categoria,
      especie:       base.especie,
      tags:          base.tags ?? [],
      blocos:        base.blocos ?? [],
      status:        'RASCUNHO',
      origemId:      base.id,
      autorId:       req.user?.id ?? null,
      autorNome,
    },
    select: SELECT_COMPLETO,
  });
}

const DocumentoTemplateController = {

  // GET /api/documentos/templates?incluirExcluidos=1
  // Devolve os GLOBAIS + os da empresa do contexto. O RLS já garante o recorte; o
  // `where` aqui é só para não trazer a lixeira quando ninguém pediu.
  listar: async (req, res) => {
    try {
      const incluirExcluidos = String(req.query.incluirExcluidos ?? '') === '1';
      const templates = await prisma.documentoTemplate.findMany({
        where:   incluirExcluidos ? {} : { excluido: false },
        select:  SELECT_COMPLETO,
        orderBy: [{ atualizadoEm: 'desc' }],
      });
      return res.json({ sucesso: true, dados: templates.map(serializar) });
    } catch (err) {
      console.error('Erro ao listar templates de documento:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao listar modelos' });
    }
  },

  // GET /api/documentos/templates/:id
  obterPorId: async (req, res) => {
    try {
      const t = await prisma.documentoTemplate.findUnique({
        where: { id: Number(req.params.id) }, select: SELECT_COMPLETO,
      });
      if (!t) return res.status(404).json({ sucesso: false, error: 'Modelo não encontrado' });
      return res.json({ sucesso: true, dados: serializar(t) });
    } catch (err) {
      console.error('Erro ao obter template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao obter modelo' });
    }
  },

  // POST /api/documentos/templates
  criar: async (req, res) => {
    try {
      if (!req.empresaId) {
        return res.status(400).json({ sucesso: false, error: 'Selecione a empresa antes de criar um modelo.', code: 'SEM_EMPRESA' });
      }
      const dados = saneia(req.body);
      const t = await prisma.documentoTemplate.create({
        data: {
          // ⚠️ SEMPRE o tenant do contexto. `req.body.empresaId` é ignorado de
          // propósito: tenant vindo do cliente jamais define escopo.
          empresaId:  req.empresaId,
          nome:       dados.nome ?? 'Novo modelo',
          descricao:  dados.descricao ?? '',
          categoria:  dados.categoria ?? 'personalizados',
          especie:    dados.especie ?? 'AMBOS',
          tags:       dados.tags ?? [],
          blocos:     dados.blocos ?? [],
          status:     dados.status ?? 'RASCUNHO',
          autorId:    req.user?.id ?? null,
          autorNome:  await nomeDoAutor(req),
        },
        select: SELECT_COMPLETO,
      });
      return res.status(201).json({ sucesso: true, dados: serializar(t) });
    } catch (err) {
      console.error('Erro ao criar template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao criar modelo' });
    }
  },

  /**
   * PUT /api/documentos/templates/:id
   * body: { ...campos, novaVersao?: boolean }
   *
   * Em modelo GLOBAL isto NÃO altera o global — devolve a cópia da empresa já com a
   * alteração aplicada, e o front troca o id aberto pelo da cópia (`dados.id` muda).
   */
  atualizar: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const base = await prisma.documentoTemplate.findUnique({ where: { id }, select: SELECT_COMPLETO });
      if (!base) return res.status(404).json({ sucesso: false, error: 'Modelo não encontrado' });
      if (base.empresaId === null && !req.empresaId) {
        return res.status(400).json({ sucesso: false, error: 'Selecione a empresa antes de personalizar um modelo do sistema.', code: 'SEM_EMPRESA' });
      }

      const dados = saneia(req.body);
      const novaVersao = req.body?.novaVersao === true;

      const salvo = await prisma.$transaction(async (tx) => {
        const alvo = await garantirCopiaDaEmpresa(tx, base, req);

        const patch = { ...dados };
        if (novaVersao) {
          patch.versao = alvo.versao + 1;
          // A versão guarda os blocos ANTERIORES: é o estado ao qual se volta.
          patch.versoes = [
            {
              versao:   alvo.versao,
              criadoEm: new Date().toISOString(),
              autor:    await nomeDoAutor(req),
              nota:     String(req.body?.nota ?? 'Versão automática').slice(0, 120),
              blocos:   Array.isArray(alvo.blocos) ? alvo.blocos : [],
            },
            ...(Array.isArray(alvo.versoes) ? alvo.versoes : []),
          ].slice(0, LIMITE_VERSOES);
        }

        return tx.documentoTemplate.update({ where: { id: alvo.id }, data: patch, select: SELECT_COMPLETO });
      });

      return res.json({
        sucesso: true,
        dados: serializar(salvo),
        // Sinaliza à tela que ela está agora editando OUTRO registro (a cópia).
        copiado: base.empresaId === null,
      });
    } catch (err) {
      console.error('Erro ao atualizar template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao salvar modelo' });
    }
  },

  // POST /api/documentos/templates/:id/duplicar
  duplicar: async (req, res) => {
    try {
      if (!req.empresaId) return res.status(400).json({ sucesso: false, error: 'Selecione a empresa.', code: 'SEM_EMPRESA' });
      const base = await prisma.documentoTemplate.findUnique({ where: { id: Number(req.params.id) }, select: SELECT_COMPLETO });
      if (!base) return res.status(404).json({ sucesso: false, error: 'Modelo não encontrado' });

      const copia = await prisma.documentoTemplate.create({
        data: {
          empresaId: req.empresaId,
          chave:     base.chave,
          // Modelo do sistema vira "Atestado sanitário" da clínica, sem "(cópia)" —
          // para ela, aquele é O atestado. Duplicar um modelo PRÓPRIO, sim, marca.
          nome:      base.empresaId === null ? base.nome : `${base.nome} (cópia)`.slice(0, 160),
          descricao: base.descricao,
          categoria: base.categoria,
          especie:   base.especie,
          tags:      base.tags ?? [],
          blocos:    base.blocos ?? [],
          status:    'RASCUNHO',
          origemId:  base.id,
          autorId:   req.user?.id ?? null,
          autorNome: await nomeDoAutor(req),
        },
        select: SELECT_COMPLETO,
      });
      return res.status(201).json({ sucesso: true, dados: serializar(copia) });
    } catch (err) {
      console.error('Erro ao duplicar template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao duplicar modelo' });
    }
  },

  // PATCH /api/documentos/templates/:id/favorito
  // Favoritar um GLOBAL também passa pelo copy-on-write: favorito é coluna da linha,
  // e a linha global é de todo mundo — marcá-la marcaria para todas as clínicas.
  alternarFavorito: async (req, res) => {
    try {
      const base = await prisma.documentoTemplate.findUnique({ where: { id: Number(req.params.id) }, select: SELECT_COMPLETO });
      if (!base) return res.status(404).json({ sucesso: false, error: 'Modelo não encontrado' });
      if (base.empresaId === null && !req.empresaId) {
        return res.status(400).json({ sucesso: false, error: 'Selecione a empresa.', code: 'SEM_EMPRESA' });
      }
      const salvo = await prisma.$transaction(async (tx) => {
        const alvo = await garantirCopiaDaEmpresa(tx, base, req);
        return tx.documentoTemplate.update({
          where: { id: alvo.id }, data: { favorito: !alvo.favorito }, select: SELECT_COMPLETO,
        });
      });
      return res.json({ sucesso: true, dados: serializar(salvo), copiado: base.empresaId === null });
    } catch (err) {
      console.error('Erro ao favoritar template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao favoritar' });
    }
  },

  /**
   * DELETE /api/documentos/templates/:id  (body: { motivo })
   * Soft delete — vai para a Lixeira, como todo registro clínico (§33).
   */
  excluir: async (req, res) => {
    try {
      const motivo = String(req.body?.motivo ?? '').trim();
      if (motivo.length < 3) {
        return res.status(400).json({ sucesso: false, error: 'Informe a justificativa da exclusão.', code: 'MOTIVO_OBRIGATORIO' });
      }
      const base = await prisma.documentoTemplate.findUnique({ where: { id: Number(req.params.id) }, select: SELECT_LISTA });
      if (!base) return res.status(404).json({ sucesso: false, error: 'Modelo não encontrado' });
      // Modelo do sistema não vai para a lixeira de ninguém: ele é o catálogo
      // normativo e é compartilhado. Quem não quer usá-lo simplesmente não o usa;
      // quem quer outra redação personaliza (copy-on-write) e usa a cópia.
      if (base.empresaId === null) {
        return res.status(400).json({
          sucesso: false, code: 'MODELO_DO_SISTEMA',
          error: 'Modelo do sistema não pode ser excluído. Personalize-o para ter a versão da sua clínica.',
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.documentoTemplate.update({ where: { id: base.id }, data: { excluido: true } });
        await registrarAuditoria(tx, req, {
          categoria: 'EXCLUSAO', entidade: 'DOCUMENTO_TEMPLATE', entidadeId: base.id,
          motivo, detalhes: `Modelo "${base.nome}" movido para a lixeira`,
        });
      });
      return res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao excluir template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao excluir modelo' });
    }
  },

  // PATCH /api/documentos/templates/:id/restaurar
  restaurar: async (req, res) => {
    try {
      const t = await prisma.documentoTemplate.findUnique({ where: { id: Number(req.params.id) }, select: SELECT_LISTA });
      if (!t) return res.status(404).json({ sucesso: false, error: 'Modelo não encontrado' });
      if (t.empresaId === null) return res.status(400).json({ sucesso: false, error: 'Modelo do sistema não vai para a lixeira.', code: 'MODELO_DO_SISTEMA' });
      const salvo = await prisma.documentoTemplate.update({
        where: { id: t.id }, data: { excluido: false }, select: SELECT_COMPLETO,
      });
      return res.json({ sucesso: true, dados: serializar(salvo) });
    } catch (err) {
      console.error('Erro ao restaurar template:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao restaurar modelo' });
    }
  },
};

module.exports = DocumentoTemplateController;
module.exports.serializar = serializar;
module.exports.SELECT_COMPLETO = SELECT_COMPLETO;
module.exports.garantirCopiaDaEmpresa = garantirCopiaDaEmpresa;
