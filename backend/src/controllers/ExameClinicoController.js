// backend/src/controllers/ExameClinicoController.js
'use strict';

const prisma                  = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { lancarExameNaFatura, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria, registrarAlteracao, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro, getNivelEfetivo, NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { processarExame } = require('../services/exameParserService');
const { storage }        = require('../storage');

const TIPOS_VALIDOS = ['Laboratorial', 'Bioquímico', 'Imagem', 'Compra'];

// NOTA: o PEDIDO de exame (criar/editar/finalizar/excluir) é protegido APENAS por
// `atendimento.exames.*`. Já o RESULTADO/laudo (carregar) usa os slugs de resultado
// `exames.laboratorial.*` / `exames.imagem.*` — ver `SLUG_RESULTADO` e `salvarResultado`.
// Laboratorial/Bioquímico → exames.laboratorial ; Imagem → exames.imagem ;
// Compra não tem resultado (sem restrição extra).
const SLUG_RESULTADO = {
  Laboratorial: 'exames.laboratorial',
  'Bioquímico': 'exames.laboratorial',
  Imagem:       'exames.imagem',
};

const INCLUDE = {
  veterinario:    { select: { id: true, fullName: true } },
  resultadoItens: { orderBy: { ordem: 'asc' } },
  imagens:        { where: { ativo: true }, orderBy: { id: 'asc' }, select: { id: true, nome: true, arquivoUrl: true } },
};

/**
 * Tabela do resultado DIGITADA à mão (tela Resultado de Exame > "Preencher manualmente").
 *
 * Chega como string JSON quando o request é multipart — o mesmo endpoint atende o
 * upload de laudo e o preenchimento manual, e ali todo campo é texto. Linha sem
 * `parametro` é descartada: é a linha em branco que o editor sempre deixa no fim.
 */
function parseItensManuais(bruto) {
  if (!bruto) return [];
  let lista = bruto;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch { return []; }
  }
  if (!Array.isArray(lista)) return [];
  return lista
    .map((i, idx) => ({
      parametro:  String(i?.parametro ?? '').trim(),
      valor:      i?.valor != null && i.valor !== '' ? String(i.valor).trim() : null,
      unidade:    i?.unidade    ? String(i.unidade).trim()    : null,
      referencia: i?.referencia ? String(i.referencia).trim() : null,
      ordem:      idx,
    }))
    .filter(i => i.parametro);
}

/**
 * Exame de COMPRA é ÚNICO por paciente e por dia.
 *
 * POR QUÊ: o laudo de compra é a fotografia do animal naquela data — dois laudos no
 * mesmo dia para o mesmo paciente são duplicidade (ou reenvio de formulário), não dois
 * exames. Vale SÓ para `tipo === 'Compra'`: os demais tipos são PEDIDOS e podem se
 * repetir no dia à vontade (dois hemogramas, dois raios-x…).
 *
 * A comparação é pela DATA (YYYY-MM-DD), não pelo instante: `dataSolicitacao` é
 * DateTime e o front manda "YYYY-MM-DD" (meia-noite UTC), mas registro criado por outro
 * caminho pode ter hora — igualdade exata deixaria a duplicata passar. São poucos
 * laudos de compra por animal, então carregar e comparar em JS evita depender de
 * `date_trunc` e de fuso do servidor.
 *
 * @returns o exame conflitante, ou null
 */
async function compraNoMesmoDia(client, { animalId, dataSolicitacao, ignorarId = null }) {
  const alvo = String(dataSolicitacao ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(alvo)) return null;

  const existentes = await client.exameClinico.findMany({
    where: {
      animalId: Number(animalId),
      tipo:     'Compra',
      ativo:    true,
      ...(ignorarId ? { id: { not: Number(ignorarId) } } : {}),
    },
    select: { id: true, numero: true, dataSolicitacao: true },
  });

  return existentes.find(e =>
    e.dataSolicitacao && e.dataSolicitacao.toISOString().slice(0, 10) === alvo) ?? null;
}

const ExameClinicoController = {

  // GET /clinica/exames/animal/:animalId?page=1&limit=10
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      // Histórico completo (ativos E inativados) — o front filtra por status
      // (SALVA/FINALIZADA/INATIVA) e pagina no cliente, mesmo padrão da tela de Vacina.
      // Segregação multi-clínica: cada empresa vê só os próprios exames do animal.
      const where = { animalId, AND: [escopoFilhoEvolucaoWhere(req)] };
      const itens = await prisma.exameClinico.findMany({
        where,
        include: INCLUDE,
        orderBy: { dataSolicitacao: 'desc' },
      });

      res.json({ dados: itens, meta: { total: itens.length } });
    } catch (err) {
      console.error('Erro ao listar exames clínicos:', err);
      res.status(500).json({ error: 'Erro ao listar exames' });
    }
  },

  // POST /clinica/exames
  // body: { animalId, tipo, descricao, evolucaoId, laboratorio?, tipoAmostra?, indicacaoClinica?, observacao? }
  criar: async (req, res) => {
    try {
      const { animalId, tipo, descricao, evolucaoId, laboratorio, tipoAmostra, qtdAmostra, indicacaoClinica, observacao, grupoNome, grupos } = req.body;

      if (!animalId || !tipo || !descricao?.trim()) {
        return res.status(400).json({ error: 'animalId, tipo e descricao são obrigatórios' });
      }
      if (!TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: `tipo deve ser: ${TIPOS_VALIDOS.join(', ')}` });
      }
      // evolucaoId obrigatório apenas fora do fluxo autônomo de Compra
      if (!evolucaoId && tipo !== 'Compra') {
        return res.status(400).json({ error: 'evolucaoId é obrigatório', code: 'EVOLUCAO_REQUIRED' });
      }

      const acesso = await verificarAcessoAnimal({
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      // Valida evolução apenas quando fornecida
      if (evolucaoId) {
        const evolucao = await prisma.evolucaoClinica.findFirst({
          where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
          select: { id: true },
        });
        if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal', code: 'EVOLUCAO_NOT_FOUND' });
      }

      // Campos extras armazenados em observacao como JSON
      const { dataHoraColeta, dataSolicitacao } = req.body;

      // Um laudo de compra por paciente/dia — ver `compraNoMesmoDia`
      if (tipo === 'Compra') {
        const jaExiste = await compraNoMesmoDia(prisma, {
          animalId, dataSolicitacao: dataSolicitacao ?? new Date().toISOString(),
        });
        if (jaExiste) {
          return res.status(409).json({
            error: 'Este paciente já tem um Exame de Compra nesta data — Altere o exame existente.',
            code:  'COMPRA_DUPLICADA',
            exameId: jaExiste.id,
          });
        }
      }

      // Exame de Compra: ExameCompra.tsx manda o laudo completo em `observacao` como JSON string.
      // Preserva direto, sem encapsular na estrutura extra (que quebraria a leitura em handleEditar).
      let observacaoFinal;
      if (tipo === 'Compra') {
        observacaoFinal = observacao ?? null;
      } else {
        const extra = {
          laboratorio:      laboratorio?.trim()      || null,
          dataHoraColeta:   dataHoraColeta           || null,
          tipoAmostra:      tipoAmostra?.trim()      || null,
          indicacaoClinica: indicacaoClinica?.trim() || null,
          obs:              observacao?.trim()        || null,
          grupoNome:        grupoNome?.trim()         || null,
          grupos:           Array.isArray(grupos) && grupos.length >= 1 ? grupos : null,
        };
        observacaoFinal = JSON.stringify(extra);
      }

      // Proprietário do animal — o exame é lançado na fatura já na solicitação
      const animalDoExame = await prisma.animal.findUnique({
        where: { id: Number(animalId) }, select: { userId: true },
      });

      const item = await prisma.$transaction(async (tx) => {
        const maxResult = await tx.exameClinico.aggregate({
          where: { animalId: Number(animalId) },
          _max:  { numero: true },
        });
        const proximoNumero = (maxResult._max.numero ?? 0) + 1;

        const criado = await tx.exameClinico.create({
          data: {
            animalId:        Number(animalId),
            veterinarioId:   req.user.id,
            evolucaoId:      evolucaoId ? Number(evolucaoId) : null,
            tipo,
            descricao:       descricao.trim(),
            status:          'SOLICITADO',
            ativo:           true,
            observacao:      observacaoFinal,
            qtdAmostra:      qtdAmostra != null ? Number(qtdAmostra) : null,
            numero:          proximoNumero,
            dataSolicitacao: dataSolicitacao ? new Date(dataSolicitacao) : new Date(),
          },
          include: INCLUDE,
        });

        // Lança na fatura (valor zerado) JÁ na solicitação. Antes isso só acontecia ao
        // FINALIZAR a evolução ou ao concluir o exame — exame pedido depois da evolução
        // finalizada, ou que nunca foi concluído, nunca chegava ao financeiro.
        // `lancarExameNaFatura` é idempotente: os outros gatilhos não duplicam.
        await lancarExameNaFatura(tx, criado, animalDoExame?.userId ?? null);
        return criado;
      });

      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao criar exame' });
    }
  },

  // GET /clinica/exames/:id
  obterPorId: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({
        where:   { id: Number(req.params.id) },
        include: INCLUDE,
      });
      if (!item) return res.status(404).json({ error: 'Exame não encontrado' });
      res.json({ dados: item });
    } catch (err) {
      console.error('Erro ao obter exame clínico:', err);
      res.status(500).json({ error: 'Erro ao obter exame' });
    }
  },

  // PUT /clinica/exames/:id
  atualizar: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Autoria via RBAC (nível efetivo em atendimento.exames.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req, item.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite editar exames criados por você.' });
      }

      const { descricao, observacao, status, laboratorio, tipoAmostra, indicacaoClinica, dataSolicitacao, qtdAmostra } = req.body;

      // Editar a DATA não pode colidir com outro laudo de compra do mesmo paciente.
      // `ignorarId` é o próprio exame: sem ele, salvar sem mudar a data acusaria
      // conflito consigo mesmo e travaria toda edição.
      if (item.tipo === 'Compra' && dataSolicitacao) {
        const jaExiste = await compraNoMesmoDia(prisma, {
          animalId: item.animalId, dataSolicitacao, ignorarId: item.id,
        });
        if (jaExiste) {
          return res.status(409).json({
            error: 'Este paciente já tem outro Exame de Compra nesta data. Escolha outra data.',
            code:  'COMPRA_DUPLICADA',
            exameId: jaExiste.id,
          });
        }
      }

      // Exame de Compra: ExameCompra.tsx manda o laudo completo em `observacao` como JSON string.
      // Preserva direto; para outros tipos, encapsula na estrutura extra padrão.
      let observacaoAtualizada;
      if (item.tipo === 'Compra') {
        observacaoAtualizada = observacao ?? item.observacao;
      } else {
        const extra = {
          laboratorio:      laboratorio?.trim()      || null,
          tipoAmostra:      tipoAmostra?.trim()      || null,
          indicacaoClinica: indicacaoClinica?.trim() || null,
          obs:              observacao?.trim()        || null,
        };
        observacaoAtualizada = JSON.stringify(extra);
      }

      const descricaoTrim  = descricao ? descricao.trim() : undefined;
      const descricaoMudou = descricaoTrim !== undefined && descricaoTrim !== item.descricao;

      const atualizado = await prisma.$transaction(async (tx) => {
        // Descrição mudou → sincroniza o FaturaItem vinculado (se houver), independente
        // do status — o exame pode estar faturado ainda como SOLICITADO (valor 0 ao
        // finalizar a evolução). Idempotente; bloqueia se a fatura de destino for PAGA.
        if (descricaoMudou) {
          const exNum = `EX-${String(item.numero).padStart(4, '0')}`;
          await atualizarFaturaItensDaOrigem(tx, 'exameClinicoId', item.id, {
            descricao: `[${exNum}] ${item.tipo}: ${descricaoTrim}`,
          });
        }

        const upd = await tx.exameClinico.update({
          where: { id: item.id },
          data: {
            ...(descricaoTrim !== undefined && { descricao: descricaoTrim }),
            ...(status          && { status }),
            ...(dataSolicitacao && { dataSolicitacao: new Date(dataSolicitacao) }),
            ...(qtdAmostra != null && { qtdAmostra: Number(qtdAmostra) }),
            observacao: observacaoAtualizada,
          },
          include: INCLUDE,
        });

        await registrarAlteracao(tx, req, {
          entidade: 'EXAME_CLINICO', entidadeId: item.id, animalId: item.animalId,
          donoAtualId: item.veterinarioId,
          campos: {
            descricao:  { de: item.descricao, para: upd.descricao },
            status:     { de: item.status,    para: upd.status },
            observacao: { de: resumoTexto(item.observacao), para: resumoTexto(upd.observacao) },
            qtdAmostra: { de: item.qtdAmostra, para: upd.qtdAmostra },
          },
        });

        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao atualizar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao atualizar exame' });
    }
  },

  // PATCH /clinica/exames/:id/resultado — CARREGAR RESULTADO (multipart)
  // Laboratorial/Bioquímico: extrai o laudo (LLM) em forma de TABELA + guarda o arquivo.
  // Imagem: laudo VERBATIM (sem interpretação) + imagens anexadas. Ao salvar → REALIZADO.
  // RBAC do RESULTADO (distinto do pedido): exames.laboratorial.* / exames.imagem.* por tipo.
  salvarResultado: async (req, res) => {
    try {
      const { id } = req.params;
      const exame = await prisma.exameClinico.findUnique({ where: { id: Number(id) } });
      if (!exame || !exame.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: exame.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      // Gate do RESULTADO por TIPO (exames.laboratorial.editar / exames.imagem.editar).
      // Compra não tem resultado estruturado — sem restrição extra.
      const base = SLUG_RESULTADO[exame.tipo];
      if (base) {
        const nivel = await getNivelEfetivo(req, `${base}.editar`);
        if ((NIVEL_ORDINAL[nivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
          return res.status(403).json({ error: `Sem permissão para carregar resultado de exame ${exame.tipo}.` });
        }
      }

      const laudoTexto = (req.body?.resultado ?? '').toString().trim();
      const arquivos   = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
      const agora      = new Date();

      // ── IMAGEM: laudo VERBATIM + imagens (sem interpretação da IA) ───────────
      if (exame.tipo === 'Imagem') {
        const imagens = [];
        for (const file of arquivos) {
          const arquivoUrl = await storage.upload(file, 'exames-imagens');
          const anexo = await prisma.exameImagemAnexo.create({
            data: {
              animalId:       exame.animalId,
              exameClinicoId: exame.id,
              nome:           file.originalname ?? null,
              arquivoUrl,
              criadoPorId:    req.user?.id ?? null,
            },
          });
          imagens.push({ id: anexo.id, nome: anexo.nome, arquivoUrl: anexo.arquivoUrl });
        }
        await prisma.exameClinico.update({
          where: { id: exame.id },
          data:  { resultado: laudoTexto || exame.resultado, status: 'REALIZADO', dataResultado: agora },
        });
        return res.json({ dados: { id: exame.id, status: 'REALIZADO', imagens } });
      }

      // ── LABORATORIAL/BIOQUÍMICO: extrai a TABELA do laudo (LLM) + guarda arquivo ──
      let arquivoUrl = exame.arquivoUrl;
      let itens = [];
      const file = arquivos[0];

      // PREENCHIMENTO MANUAL: a tela de Resultado de Exame também deixa DIGITAR a
      // tabela, sem laudo nenhum (nem todo laboratório entrega arquivo). Vindo por
      // multipart, `itens` chega como string JSON. Havendo itens digitados, eles
      // MANDAM — não faz sentido pedir a leitura do arquivo à IA e depois descartar
      // o que a pessoa digitou.
      const itensManuais = parseItensManuais(req.body?.itens);
      if (itensManuais.length > 0) {
        itens = itensManuais;
        if (file) arquivoUrl = await storage.upload(file, 'exames');
      } else if (file) {
        arquivoUrl = await storage.upload(file, 'exames');
        try {
          const extracao = await processarExame(file.path, req.user?.id ?? null, exame?.animalId ?? null, req.empresaId ?? null);
          itens = (extracao?.exames ?? [])
            .map((e, idx) => {
              const refMin = e.referencia_min ?? e.valorMinRef;
              const refMax = e.referencia_max ?? e.valorMaxRef;
              const referencia = [refMin, refMax]
                .filter(v => v != null && v !== '')
                .join(' – ') || null;
              return {
                parametro:  (e.nome ?? e.nomeNutriente ?? '').toString().trim(),
                valor:      (e.resultado ?? e.valorEncontrado),
                unidade:    e.unidade ? String(e.unidade).trim() : null,
                referencia,
                ordem:      idx,
              };
            })
            .filter(i => i.parametro);
        } catch (errLLM) {
          // LLM indisponível/falhou → guarda o arquivo mesmo assim (sem tabela)
          console.error('salvarResultado — extração LLM falhou, mantendo só o arquivo:', errLLM.message);
        }
      }

      await prisma.$transaction(async (tx) => {
        // Recarga do resultado substitui a tabela anterior deste exame.
        // Só quando há tabela NOVA: sem isso, reenviar o formulário apenas com uma
        // observação apagaria o resultado já carregado (a IA falhou / o usuário só
        // quis corrigir o texto) e não haveria como recuperá-lo.
        if (itens.length > 0) {
          await tx.exameClinicoResultadoItem.deleteMany({ where: { exameClinicoId: exame.id } });
        }
        for (const it of itens) {
          await tx.exameClinicoResultadoItem.create({
            data: {
              exameClinicoId: exame.id,
              parametro:      it.parametro,
              valor:          it.valor != null ? String(it.valor) : null,
              unidade:        it.unidade,
              referencia:     it.referencia,
              ordem:          it.ordem,
            },
          });
        }
        await tx.exameClinico.update({
          where: { id: exame.id },
          data:  { resultado: laudoTexto || exame.resultado, arquivoUrl, status: 'REALIZADO', dataResultado: agora },
        });
      });

      return res.json({ dados: { id: exame.id, status: 'REALIZADO', itens } });
    } catch (err) {
      console.error('Erro ao salvar resultado do exame:', err);
      res.status(500).json({ error: 'Erro ao salvar resultado' });
    }
  },

  // PATCH /clinica/exames/:id/finalizar — transita status para CONCLUIDO
  // GESTOR: qualquer exame (bypass via checkPermission)
  // FORNECEDOR: apenas exames que ele próprio criou (veterinarioId check)
  finalizar: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Autoria via RBAC (nível efetivo em atendimento.exames.finalizar)
      if (!podeOperarRegistro(req, item.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar exames criados por você.' });
      }

      if (item.status === 'CONCLUIDO') {
        return res.status(400).json({ error: 'Exame já está concluído.' });
      }

      const atualizado = await prisma.exameClinico.update({
        where: { id: item.id },
        data:  { status: 'CONCLUIDO' },
        include: INCLUDE,
      });

      res.json({ dados: atualizado });

      // Lança na fatura com valor zerado (idempotente — não duplica se o exame já foi
      // lançado ao finalizar a evolução). Exame clínico não tem preço automático.
      setImmediate(async () => {
        try {
          const animal = await prisma.animal.findUnique({
            where:  { id: item.animalId },
            select: { userId: true },
          });
          await prisma.$transaction(async (tx) => {
            await lancarExameNaFatura(tx, item, animal?.userId);
          });
        } catch { /* silencioso — fatura não bloqueia a finalização */ }
      });
    } catch (err) {
      console.error('Erro ao finalizar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao finalizar exame' });
    }
  },

  // DELETE /clinica/exames/:id  (soft delete)
  excluir: async (req, res) => {
    try {
      const { motivo } = req.body ?? {};
      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Autoria via RBAC (nível efetivo em atendimento.exames.deletar)
      if (!podeOperarRegistro(req, item.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite excluir exames criados por você.' });
      }

      await prisma.$transaction(async (tx) => {
        // Remove o FaturaItem vinculado ao exame (se houver) — independente do status,
        // pois desde 2026-07-16 o exame pode ser faturado (valor 0) já ao FINALIZAR a
        // evolução, ainda como SOLICITADO. Idempotente: sem item vinculado, não faz nada.
        // Bloqueia (lança FaturaPagaError) se a fatura de destino já estiver PAGA.
        await removerFaturaItensDaOrigem(tx, 'exameClinicoId', item.id);
        await tx.exameClinico.update({ where: { id: item.id }, data: { ativo: false } });

        await registrarAuditoria(tx, req, {
          categoria:  'CANCELAMENTO',
          entidade:   'EXAME_CLINICO',
          entidadeId: item.id,
          animalId:   item.animalId,
          motivo,
          detalhes:   [item.tipo, item.descricao].filter(Boolean).join(' — ') || null,
        });
      });

      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao excluir exame clínico:', err);
      res.status(500).json({ error: 'Erro ao excluir exame' });
    }
  },
};

module.exports = ExameClinicoController;
