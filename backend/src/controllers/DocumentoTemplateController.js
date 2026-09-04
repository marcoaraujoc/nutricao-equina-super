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
const { storage } = require('../storage');
const { registrarAuditoria } = require('../lib/auditoria');
const logger = require('../lib/logger');
const documentoConversaoService = require('../services/documentoConversaoService');

/**
 * Categorias PADRÃO — as que têm rótulo no catálogo do front (`modules/documentos/
 * catalogo.ts`) e nascem com o sistema.
 *
 * 🔴 NÃO É MAIS UMA LISTA FECHADA (2026-08-30). A clínica cria as suas categorias na
 * tela de emissão, e a categoria nova é gravada aqui mesmo, como TEXTO — não existe
 * tabela de categorias, e criar uma exigiria migration. Consequência aceita e
 * deliberada: **a categoria existe enquanto houver um documento nela.** A tela reúne
 * as categorias varrendo os modelos (padrão + as em uso), então uma categoria sem
 * nenhum documento simplesmente não aparece — que é o comportamento correto para algo
 * que só existe como rótulo de agrupamento.
 *
 * `normalizarCategoria` é o que impede o campo virar lixo: a coluna é VARCHAR(30) e o
 * banco recusaria valor maior — cortar aqui evita 500 numa digitação longa.
 */
const CATEGORIAS_PADRAO = new Set([
  'atendimento', 'receituarios', 'laudos', 'reproducao', 'cirurgias', 'sanidade',
  'rebanho', 'transporte', 'consentimentos', 'financeiro', 'personalizados',
]);

function normalizarCategoria(valor) {
  // Espaços colapsados: "Exames   de  compra" e "Exames de compra" são a MESMA
  // categoria, e sem isso virariam dois grupos idênticos na tela.
  const limpo = String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!limpo) return null;
  // A padrão volta no slug canônico (minúsculo), venha como vier do cliente.
  const baixo = limpo.toLowerCase();
  return CATEGORIAS_PADRAO.has(baixo) ? baixo : limpo;
}
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
  if (typeof body.categoria === 'string') {
    const c = normalizarCategoria(body.categoria);
    // Só grava categoria não-vazia: string em branco no corpo NÃO apaga a que o
    // modelo já tem — apagar aqui tiraria o modelo do grupo sem ninguém ter pedido.
    if (c) dados.categoria = c;
  }
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

  /**
   * POST /api/documentos/templates/upload   (multipart, campo `arquivo`)
   *
   * Guarda a IMAGEM de um documento enviado pela clínica e devolve a URL, que a tela
   * transforma num bloco `imagem` do modelo. É o que permite subir um formulário que
   * a clínica já usa em papel e emiti-lo pelo sistema como qualquer outro documento.
   *
   * 🔴 SÓ IMAGEM chega aqui. PDF é convertido em imagem NO NAVEGADOR, uma por página,
   * antes de subir (ver `modules/documentos/upload.ts`) — é o que faz o documento
   * enviado seguir EXATAMENTE o mesmo caminho dos outros: preview A4, impressão, PDF
   * do WhatsApp/e-mail e snapshot do emitido. Guardar o PDF cru obrigaria cada um
   * desses caminhos a ter um desvio próprio.
   *
   * MULTI-TENANT: o contexto de dono vai no `storage.upload` (§8) — `empresaId` do
   * CONTEXTO (nunca do corpo) e o autor. É ele que faz `GET /api/midia/:chave` exigir
   * a mesma empresa para devolver o byte; sem contexto o arquivo nasceria sem dono e
   * só o ADMIN o alcançaria.
   */
  enviarArquivo: async (req, res) => {
    try {
      if (!req.empresaId) {
        return res.status(400).json({ sucesso: false, error: 'Selecione a empresa antes de enviar o arquivo.', code: 'SEM_EMPRESA' });
      }
      if (!req.file) {
        return res.status(400).json({ sucesso: false, error: 'Envie o arquivo do documento.', code: 'ARQUIVO_OBRIGATORIO' });
      }
      const url = await storage.upload(req.file, 'documentos', {
        empresaId:   req.empresaId,
        criadoPorId: req.user?.id ?? null,
      });
      return res.status(201).json({ sucesso: true, dados: { url } });
    } catch (err) {
      if (err?.code === 'ARQUIVO_GRANDE_DEMAIS') {
        return res.status(413).json({ sucesso: false, error: 'Arquivo grande demais.', code: err.code });
      }
      console.error('Erro ao enviar arquivo do modelo:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao enviar o arquivo' });
    }
  },

  /**
   * POST /api/documentos/templates/converter
   *
   * As PÁGINAS de um documento enviado pela clínica → os BLOCOS de um modelo, com as
   * variáveis e as lacunas já identificadas pela IA. NÃO cria nem grava nada: devolve
   * a proposta, e quem cria o modelo é o `POST /templates` de sempre, com o corpo que
   * a tela montar. Separar assim é o que deixa a tela mostrar o resultado antes de
   * comprometer o acervo — e o que faz a falha da IA não deixar modelo pela metade.
   *
   * ⚠️ FALHA NÃO INTERROMPE O ENVIO. Quando a conversão não produz blocos (arquivo que
   * não é documento, JSON inválido, IA fora do ar), a resposta é 200 com
   * `ehDocumento: false` e o front cai no envio como IMAGEM — o comportamento que
   * sempre existiu e que nunca falha. O único caminho que responde erro é a QUOTA
   * estourada, que é decisão do plano do cliente e precisa ser dita.
   *
   * 🔴 MAS FALHA SEMPRE DIZ O MOTIVO. A primeira versão devolvia `ehDocumento: false`
   * pelado, e a tela mostrava "não deu para identificar os campos" para TUDO — sem
   * empresa, sem permissão, arquivo recusado pelo multer, IA fora do ar e "isto não é
   * um documento" ficavam indistinguíveis, inclusive para quem fosse depurar. O
   * `motivo` viaja junto e a tela o exibe: cair no caminho da imagem é aceitável;
   * cair sem saber por quê, não.
   */
  converter: async (req, res, next) => {
    try {
      if (!req.empresaId) {
        return res.json({
          sucesso: true,
          dados: { ehDocumento: false, titulo: null, categoria: null, blocos: [],
                   motivo: 'Nenhuma empresa selecionada no contexto.' },
        });
      }
      const paginas = Array.isArray(req.files) ? req.files : [];
      if (paginas.length === 0) {
        // Sem arquivo aqui quase nunca é "esqueceram de anexar": o `fileFilter` do
        // multer DESCARTA em silêncio o que não for jpg/png/webp, então a lista chega
        // vazia quando o tipo foi recusado. Dizer isso poupa a caçada.
        return res.json({
          sucesso: true,
          dados: { ehDocumento: false, titulo: null, categoria: null, blocos: [],
                   motivo: 'O servidor não recebeu nenhuma página em formato de imagem.' },
        });
      }

      const dados = await documentoConversaoService.converter(req, {
        paginas: paginas.map(f => ({ buffer: f.buffer, mimetype: f.mimetype })),
        texto:   typeof req.body?.texto === 'string' ? req.body.texto : '',
        nome:    typeof req.body?.nome  === 'string' ? req.body.nome  : '',
      });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      // 429 do teto de IA do cliente — o error handler global traduz (§7).
      if (err?.code === 'IA_QUOTA_EXCEDIDA') return next(err);
      logger.error(`[documentos] conversão falhou: ${err?.message}`, { stack: err?.stack });
      // Ver a nota acima: a tela cai no caminho da imagem, mas mostrando o motivo.
      return res.json({
        sucesso: true,
        dados: { ehDocumento: false, titulo: null, categoria: null, blocos: [],
                 motivo: err?.message ? String(err.message).slice(0, 200) : 'Falha na leitura do documento.' },
      });
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
module.exports.normalizarCategoria = normalizarCategoria;
module.exports.CATEGORIAS_PADRAO = CATEGORIAS_PADRAO;
