// backend/src/controllers/DocumentoEmitidoController.js
//
// Emissão de documento para um PACIENTE.
//
// 🔴 O EMITIDO É SNAPSHOT. Grava os blocos com as variáveis JÁ RESOLVIDAS pelo
// backend (`lib/documentoVariaveis.js`), não uma referência ao template. Editar o
// modelo depois NÃO pode reescrever o papel que o cliente já recebeu — é o que
// permite reimprimir daqui a dois anos exatamente o que foi entregue. Mesma premissa
// da `FaturaItem.descricao` gravada e do `DocumentoEmitido.blocos` do protótipo.
//
// 🔴 A RESOLUÇÃO É SEMPRE AQUI, NUNCA NO NAVEGADOR. O front tem um modo de
// pré-visualização que resolve as mesmas variáveis para o vet ver a folha, mas o que
// é GRAVADO sai do banco: confiar no cliente para dizer qual é o CRMV de quem assina,
// num documento com valor legal, seria entregar a caneta a quem quiser pegá-la.
//
// Correlação com o prontuário: o documento entra no Histórico do paciente e na
// Memória Clínica (origem `DOCUMENTO`, ref `documento-<id>`) — ver
// `HistoricoController` e `services/resumoAtendimentoService.js`.
'use strict';

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { montarContexto, aplicarEmBlocos, coletarCampos, chaveDaLacuna } = require('../lib/documentoVariaveis');
const { registrarAuditoria } = require('../lib/auditoria');

const SELECT = {
  id: true, empresaId: true, animalId: true, templateId: true, templateNome: true,
  numero: true, titulo: true, blocos: true, contexto: true, evolucaoId: true,
  veterinarioId: true, animalNome: true, clienteNome: true, emitidoEm: true,
  ativo: true, canceladoMotivo: true,
  veterinario: { select: { id: true, fullName: true } },
};

const formatNumero = (n) => (n == null ? null : `DOC-${String(n).padStart(4, '0')}`);

function serializar(d) {
  return {
    id:           String(d.id),
    templateId:   d.templateId != null ? String(d.templateId) : null,
    templateNome: d.templateNome,
    numero:       d.numero ?? null,
    numeroFmt:    formatNumero(d.numero),
    titulo:       d.titulo ?? '',
    animalId:     d.animalId,
    animalNome:   d.animalNome,
    clienteNome:  d.clienteNome,
    evolucaoId:   d.evolucaoId ?? null,
    emitidoEm:    d.emitidoEm,
    emitidoPor:   d.veterinario?.fullName ?? '',
    ativo:        d.ativo,
    canceladoMotivo: d.canceladoMotivo ?? null,
    blocos:       Array.isArray(d.blocos) ? d.blocos : [],
    contexto:     d.contexto ?? {},
  };
}

/** Sequência POR EMPRESA, resolvida dentro da transaction da emissão. */
async function proximoNumero(tx, empresaId) {
  const ultimo = await tx.documentoEmitido.findFirst({
    where: { empresaId }, orderBy: { numero: 'desc' }, select: { numero: true },
  });
  return (ultimo?.numero ?? 0) + 1;
}

/** Título legível: o do bloco `titulo`, senão o nome do modelo. */
function tituloDosBlocos(blocos, fallback) {
  const t = (Array.isArray(blocos) ? blocos : []).find(b => b?.tipo === 'titulo' && b?.conteudo?.texto);
  return String(t?.conteudo?.texto ?? fallback ?? '').trim().slice(0, 200);
}

const DocumentoEmitidoController = {

  /**
   * GET /api/documentos/contexto/:animalId?evolucaoId=
   *
   * As variáveis do paciente JÁ RESOLVIDAS + a marca da clínica e a assinatura de
   * quem está logado. É o que faz "ao selecionar o animal, preencher automaticamente
   * as informações do animal": a tela pede isto uma vez e o preview passa a mostrar
   * dado real no lugar dos exemplos do catálogo.
   */
  contexto: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      if (!Number.isInteger(animalId)) return res.status(400).json({ sucesso: false, error: 'Animal inválido' });

      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId,
        equipeId: req.equipeId, userType: req.user.userType,
      });
      if (acesso === null) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, error: 'Acesso não autorizado a este animal' });

      const ctx = await montarContexto(req, { animalId, evolucaoId: req.query.evolucaoId ?? null });
      if (!ctx) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });

      return res.json({
        sucesso: true,
        dados: { variaveis: ctx.variaveis, marca: ctx.marca, evolucaoId: ctx.evolucaoId },
      });
    } catch (err) {
      console.error('Erro ao montar contexto do documento:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao carregar dados do paciente' });
    }
  },

  /**
   * POST /api/documentos/campos  { animalId, blocos, evolucaoId? }
   *
   * "O que falta preencher para emitir ESTE documento para ESTE paciente."
   * É a chamada que abre a tela de emissão.
   *
   * 🔴 A COLETA MORA NO BACKEND, e não no navegador, por um motivo concreto: decidir
   * se um campo está vazio exige saber o que as VARIÁVEIS resolveram, e quem resolve
   * é o servidor. Uma segunda implementação no front divergiria na primeira correção
   * — e o modo de divergir seria pedir um campo que já está preenchido, ou pior,
   * deixar de pedir um que vai sair em branco no papel.
   * (O front ainda APLICA o preenchimento para a pré-visualização ao vivo; aplicar é
   * trivial e reversível, coletar é que é a regra.)
   */
  campos: async (req, res) => {
    try {
      const animalId = Number(req.body?.animalId);
      if (!Number.isInteger(animalId)) return res.status(400).json({ sucesso: false, error: 'Selecione o paciente.' });
      const blocos = Array.isArray(req.body?.blocos) ? req.body.blocos : [];

      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId,
        equipeId: req.equipeId, userType: req.user.userType,
      });
      if (acesso === null) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, error: 'Acesso não autorizado a este animal' });

      const ctx = await montarContexto(req, { animalId, evolucaoId: req.body?.evolucaoId ?? null });
      if (!ctx) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });

      return res.json({
        sucesso: true,
        dados: {
          campos:     coletarCampos(blocos, ctx.variaveis),
          variaveis:  ctx.variaveis,
          marca:      ctx.marca,
          evolucaoId: ctx.evolucaoId,
        },
      });
    } catch (err) {
      console.error('Erro ao coletar campos do documento:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao preparar a emissão' });
    }
  },

  /**
   * POST /api/documentos/emitidos
   * body: { animalId, templateId?, templateNome?, blocos, evolucaoId?, preenchimento? }
   *
   * `blocos` vem do EDITOR (o vet pode ter alterado o modelo antes de emitir, que é
   * justamente o que se quer permitir) e chega com as variáveis AINDA CRUAS — é aqui
   * que elas são resolvidas.
   */
  emitir: async (req, res) => {
    try {
      if (!req.empresaId) {
        return res.status(400).json({ sucesso: false, error: 'Selecione a empresa antes de emitir.', code: 'SEM_EMPRESA' });
      }
      const animalId = Number(req.body?.animalId);
      if (!Number.isInteger(animalId)) {
        return res.status(400).json({ sucesso: false, error: 'Selecione o paciente.', code: 'ANIMAL_OBRIGATORIO' });
      }
      const blocos = Array.isArray(req.body?.blocos) ? req.body.blocos : null;
      if (!blocos || blocos.length === 0) {
        return res.status(400).json({ sucesso: false, error: 'Documento vazio.', code: 'SEM_BLOCOS' });
      }

      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId,
        equipeId: req.equipeId, userType: req.user.userType,
      });
      if (acesso === null) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, error: 'Acesso não autorizado a este animal' });

      const ctx = await montarContexto(req, { animalId, evolucaoId: req.body?.evolucaoId ?? null });
      if (!ctx) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });

      const templateId = Number(req.body?.templateId);
      const template = Number.isInteger(templateId)
        ? await prisma.documentoTemplate.findUnique({ where: { id: templateId }, select: { id: true, nome: true, empresaId: true } })
        : null;

      // O que a pessoa digitou na tela de emissão, chaveado pelo RÓTULO normalizado
      // (ver `chaveDaLacuna`). Só entram strings — o resto é descartado em silêncio
      // em vez de virar "[object Object]" impresso no papel.
      const preenchimento = {};
      for (const [k, v] of Object.entries(req.body?.preenchimento ?? {})) {
        if (typeof v === 'string' && v.trim()) preenchimento[chaveDaLacuna(k)] = v.trim().slice(0, 2000);
      }

      const doc = await prisma.$transaction(async (tx) => {
        const numero = await proximoNumero(tx, req.empresaId);

        // O número só existe AGORA — por isso ele entra no contexto depois de
        // sorteado, e não em `montarContexto` (que também serve à pré-visualização,
        // onde o documento ainda não tem número).
        const variaveis = { ...ctx.variaveis, 'sistema.numeroDocumento': formatNumero(numero) };
        const resolvidos = aplicarEmBlocos(blocos, variaveis, preenchimento);

        const criado = await tx.documentoEmitido.create({
          data: {
            empresaId:     req.empresaId,
            animalId,
            // Template GLOBAL também pode originar emissão — o vínculo é só
            // rastreabilidade, e o conteúdo já está no snapshot.
            templateId:    template?.id ?? null,
            templateNome:  String(template?.nome ?? req.body?.templateNome ?? 'Documento').slice(0, 160),
            numero,
            titulo:        tituloDosBlocos(resolvidos, template?.nome),
            blocos:        resolvidos,
            // Guarda TAMBÉM o que foi digitado à mão: sem isso, reabrir o documento
            // não explicaria de onde veio o número da partida da vacina.
            contexto:      { ...variaveis, _preenchimento: preenchimento },
            evolucaoId:    ctx.evolucaoId ?? null,
            veterinarioId: req.user?.id ?? null,
            animalNome:    String(ctx.animal.nome ?? '').slice(0, 255),
            clienteNome:   String(ctx.animal.clienteNome ?? '').slice(0, 255),
          },
          select: SELECT,
        });

        // Só o modelo DA EMPRESA conta uso: o global é compartilhado e um contador
        // nele misturaria a atividade de todas as clínicas.
        if (template?.id && template.empresaId !== null) {
          await tx.documentoTemplate.update({ where: { id: template.id }, data: { usos: { increment: 1 } } });
        }
        return criado;
      });

      return res.status(201).json({ sucesso: true, dados: serializar(doc) });
    } catch (err) {
      console.error('Erro ao emitir documento:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao emitir documento' });
    }
  },

  /**
   * GET /api/documentos/emitidos?animalId=&limit=
   * Sem `animalId`, lista os da empresa (a aba "Emitidos" da Central).
   */
  listar: async (req, res) => {
    try {
      const animalId = Number(req.query.animalId);
      const limit    = Math.min(Number(req.query.limit) || 50, 200);

      if (Number.isInteger(animalId)) {
        const acesso = await verificarAcessoAnimal({
          animalId, userId: req.user.id, empresaId: req.empresaId,
          equipeId: req.equipeId, userType: req.user.userType,
        });
        if (acesso === null) return res.status(404).json({ sucesso: false, error: 'Animal não encontrado' });
        if (!acesso)         return res.status(403).json({ sucesso: false, error: 'Acesso não autorizado a este animal' });
      }

      const docs = await prisma.documentoEmitido.findMany({
        where: {
          ativo: true,
          ...(Number.isInteger(animalId) ? { animalId } : {}),
          // O RLS já recorta por empresa; o filtro explícito mantém a intenção
          // legível na query e protege caso a rota seja chamada por um caminho que
          // não carimbe o tenant (cron, script).
          ...(req.empresaId ? { empresaId: req.empresaId } : {}),
        },
        select:  SELECT,
        orderBy: { emitidoEm: 'desc' },
        take:    limit,
      });
      return res.json({ sucesso: true, dados: docs.map(serializar) });
    } catch (err) {
      console.error('Erro ao listar documentos emitidos:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao listar documentos' });
    }
  },

  // GET /api/documentos/emitidos/:id
  obterPorId: async (req, res) => {
    try {
      const doc = await prisma.documentoEmitido.findUnique({ where: { id: Number(req.params.id) }, select: SELECT });
      if (!doc) return res.status(404).json({ sucesso: false, error: 'Documento não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: doc.animalId, userId: req.user.id, empresaId: req.empresaId,
        equipeId: req.equipeId, userType: req.user.userType,
      });
      if (!acesso) return res.status(403).json({ sucesso: false, error: 'Acesso não autorizado' });

      return res.json({ sucesso: true, dados: serializar(doc) });
    } catch (err) {
      console.error('Erro ao obter documento:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao obter documento' });
    }
  },

  /**
   * DELETE /api/documentos/emitidos/:id  (body: { motivo })
   * Cancelamento com justificativa obrigatória e auditoria (§33). Soft delete: o
   * documento entregue não some do prontuário, fica marcado como cancelado.
   */
  cancelar: async (req, res) => {
    try {
      const motivo = String(req.body?.motivo ?? '').trim();
      if (motivo.length < 3) {
        return res.status(400).json({ sucesso: false, error: 'Informe a justificativa do cancelamento.', code: 'MOTIVO_OBRIGATORIO' });
      }
      const doc = await prisma.documentoEmitido.findUnique({
        where: { id: Number(req.params.id) },
        select: { id: true, animalId: true, titulo: true, numero: true, ativo: true },
      });
      if (!doc) return res.status(404).json({ sucesso: false, error: 'Documento não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: doc.animalId, userId: req.user.id, empresaId: req.empresaId,
        equipeId: req.equipeId, userType: req.user.userType,
      });
      if (!acesso) return res.status(403).json({ sucesso: false, error: 'Acesso não autorizado' });

      await prisma.$transaction(async (tx) => {
        await tx.documentoEmitido.update({ where: { id: doc.id }, data: { ativo: false, canceladoMotivo: motivo } });
        await registrarAuditoria(tx, req, {
          categoria: 'CANCELAMENTO', entidade: 'DOCUMENTO_EMITIDO', entidadeId: doc.id,
          animalId: doc.animalId, motivo,
          detalhes: `Documento ${formatNumero(doc.numero) ?? ''} "${doc.titulo}" cancelado`,
        });
      });
      return res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao cancelar documento:', err);
      return res.status(500).json({ sucesso: false, error: 'Erro ao cancelar documento' });
    }
  },
};

module.exports = DocumentoEmitidoController;
module.exports.formatNumero = formatNumero;
