// backend/src/controllers/ExameClinicoController.js
'use strict';

const prisma                  = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { lancarExameNaFatura, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria, registrarAlteracao, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro, getNivelEfetivo, NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { animalEstaInativo } = require('../lib/animalInativo');
const { processarExame, processarBuffer } = require('../services/exameParserService');
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
 * Extrai o laboratório gravado em `observacao` (JSON, campo `laboratorio` — ver
 * `criar`/`criarNaoPedido`). Usado para expor o laboratório como campo de leitura
 * pronto, sem o front precisar fazer `JSON.parse` do texto bruto.
 */
function laboratorioDoExame(ex) {
  if (!ex?.observacao) return null;
  try {
    return JSON.parse(ex.observacao)?.laboratorio ?? null;
  } catch {
    return null;
  }
}

/**
 * Mapeia a extração da IA (prompt `parse_laudo`) para as linhas de
 * ExameClinicoResultadoItem. Compartilhado por `salvarResultado` (upload de um
 * exame já PEDIDO) e `analisarNaoPedido` (leitura prévia de um exame não pedido) —
 * uma regra de mapeamento só, nunca duas.
 */
function mapExtracaoParaItens(extracao) {
  return (extracao?.exames ?? [])
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
}

/**
 * Acha um exame CLÍNICO já existente (ativo) do mesmo animal, mesmo tipo, mesma
 * descrição (comparação insensível a maiúsculas/espaço) e mesma data — usado só
 * pelo fluxo "não pedido" (`analisarNaoPedido` + `criarNaoPedido`) para nunca
 * duplicar o resultado do mesmo exame quando o laudo é reenviado/reanalisado por
 * engano. `dataISO` null (a IA não achou data) compara só por tipo+descrição.
 */
async function exameDuplicado(animalId, tipo, descricao, dataISO) {
  const descricaoNorm = (descricao ?? '').toString().trim().toLowerCase();
  if (!descricaoNorm) return null;

  const candidatos = await prisma.exameClinico.findMany({
    where: { animalId: Number(animalId), tipo, ativo: true },
    select: { id: true, numero: true, descricao: true, dataSolicitacao: true },
  });

  return candidatos.find(c => {
    if ((c.descricao ?? '').trim().toLowerCase() !== descricaoNorm) return false;
    if (!dataISO) return true;
    const dataC = c.dataSolicitacao ? new Date(c.dataSolicitacao).toISOString().slice(0, 10) : null;
    return dataC === dataISO;
  }) ?? null;
}

const ExameClinicoController = {

  // GET /clinica/exames/animal/:animalId?page=1&limit=10
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
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

      const dados = itens.map(it => ({ ...it, laboratorio: laboratorioDoExame(it) }));
      res.json({ dados, meta: { total: dados.length } });
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
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }

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
        await lancarExameNaFatura(tx, criado, animalDoExame?.userId ?? null, req.empresaId ?? null);
        return criado;
      });

      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao criar exame' });
    }
  },

  // POST /clinica/exames/analisar (multipart: arquivo, animalId) — LEITURA da IA para
  // pré-preencher o cadastro de um exame CLÍNICO "não pedido" (Laboratorial/Bioquímico).
  // Não grava nada: devolve tipo/descrição/laboratório/data sugeridos + a tabela de
  // resultado já extraída, que o front reenvia pronta ao criar (ver `criar` +
  // `salvarResultado`) — evita rodar a IA duas vezes sobre o MESMO arquivo.
  // Gate pelo slug de RESULTADO (não o de pedido): Laboratorial e Bioquímico
  // compartilham `exames.laboratorial`, então dá para checar sem saber ainda qual
  // dos dois a IA vai sugerir.
  analisarNaoPedido: async (req, res) => {
    try {
      const { animalId } = req.body;
      if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório' });
      if (!req.file)  return res.status(400).json({ error: 'Anexe o arquivo do laudo' });

      const acesso = await verificarAcessoAnimal({
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const nivel = await getNivelEfetivo(req, 'exames.laboratorial.editar');
      if ((NIVEL_ORDINAL[nivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
        return res.status(403).json({ error: 'Sem permissão para carregar resultado de exame.' });
      }

      const extracao = await processarBuffer(req.file.buffer, req.user?.id ?? null, Number(animalId), req.empresaId ?? null);

      // A IA classifica o documento ANTES de tentar extrair (prompt parse_laudo,
      // PASSO 0) — pega nota fiscal, contrato, foto qualquer etc. anexados por
      // engano, sem deixar o usuário revisar uma tabela inventada/vazia.
      if (extracao?.ehLaudoExame === false) {
        return res.status(422).json({
          error: 'O arquivo não é compatível com um exame.',
          code:  'ARQUIVO_NAO_E_EXAME',
        });
      }

      const tipoSugerido = extracao?.tipoSugerido === 'Bioquímico' ? 'Bioquímico' : 'Laboratorial';
      const descricao    = (extracao?.nomeExame ?? '').toString().trim() || null;
      const laboratorio  = (extracao?.laboratorio ?? '').toString().trim() || null;
      const dataExame    = extracao?.dataExame || null;

      // Nunca repete o resultado do mesmo exame — avisa aqui, assim que a IA lê o
      // laudo, para o usuário não preencher a tela inteira e só descobrir no salvar.
      // A checagem definitiva (autoritativa) é feita de novo em `criarNaoPedido`.
      const duplicado = await exameDuplicado(Number(animalId), tipoSugerido, descricao, dataExame);
      if (duplicado) {
        return res.status(409).json({
          error: `Este exame já foi carregado (${duplicado.descricao}).`,
          code:  'EXAME_JA_CARREGADO',
        });
      }

      res.json({ dados: { tipoSugerido, descricao, laboratorio, dataExame, itens: mapExtracaoParaItens(extracao) } });
    } catch (err) {
      console.error('Erro ao analisar laudo (exame não pedido):', err);
      res.status(500).json({ error: 'Erro ao analisar o laudo com a IA' });
    }
  },

  // POST /clinica/exames/nao-pedido (multipart: animalId, tipo, descricao, laboratorio?,
  // dataExame?, resultado?, itens? — a tabela já REVISADA pelo usuário na tela de
  // confirmação —, arquivos[])
  //
  // Cria e já REALIZA num único passo um exame que nunca passou pelo Pedido de Exames
  // (achado antigo, laudo externo, resultado entregue depois do atendimento). NÃO exige
  // evolução: é um registro AVULSO (evolucaoId null), mesma categoria do exame de Compra
  // — `escopoFilhoEvolucaoWhere` já sabe enxergar avulso pelo autor/empresa (ver
  // lib/clinicalScope.js). Sem 2ª chamada de IA: a tabela já veio pronta da análise
  // prévia (`analisarNaoPedido`) e da revisão do usuário.
  // Gate pelo slug de RESULTADO — mesmo raciocínio de `analisarNaoPedido`.
  criarNaoPedido: async (req, res) => {
    try {
      const { animalId, descricao, laboratorio, dataExame, resultado } = req.body;
      const tipoFinal = req.body.tipo === 'Bioquímico' ? 'Bioquímico'
        : req.body.tipo === 'Imagem' ? 'Imagem' : 'Laboratorial';

      if (!animalId || !descricao?.trim()) {
        return res.status(400).json({ error: 'animalId e descricao são obrigatórios' });
      }

      const acesso = await verificarAcessoAnimal({
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }

      const nivel = await getNivelEfetivo(req, `${SLUG_RESULTADO[tipoFinal]}.editar`);
      if ((NIVEL_ORDINAL[nivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
        return res.status(403).json({ error: `Sem permissão para carregar resultado de exame ${tipoFinal}.` });
      }

      // Nunca repete o resultado do mesmo exame — checagem AUTORITATIVA (a de
      // `analisarNaoPedido` é só um aviso antecipado; cobre também quem preencheu a
      // tabela na mão, sem passar pela análise). Usa a data que efetivamente será
      // gravada (hoje, quando o usuário não informou uma).
      const dataISOFinal = dataExame ? new Date(dataExame).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const duplicado = await exameDuplicado(Number(animalId), tipoFinal, descricao, dataISOFinal);
      if (duplicado) {
        return res.status(409).json({
          error: `Este exame já foi carregado (${duplicado.descricao}).`,
          code:  'EXAME_JA_CARREGADO',
        });
      }

      const arquivos   = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
      const laudoTexto = (resultado ?? '').toString().trim();
      const itens      = tipoFinal === 'Imagem' ? [] : parseItensManuais(req.body?.itens);

      if (tipoFinal !== 'Imagem' && itens.length === 0) {
        return res.status(400).json({ error: 'Informe ao menos um parâmetro do resultado' });
      }
      if (tipoFinal === 'Imagem' && arquivos.length === 0 && !laudoTexto) {
        return res.status(400).json({ error: 'Anexe as imagens ou escreva o laudo' });
      }

      // Upload ANTES da transaction (I/O de storage fica fora da transação de banco —
      // mesmo padrão de `salvarResultado`).
      let arquivoUrl = null;
      const imagensNovas = [];
      if (tipoFinal === 'Imagem') {
        for (const file of arquivos) {
          const url = await storage.upload(file, 'exames-imagens', { empresaId: req.empresaId ?? null, animalId: Number(animalId), criadoPorId: req.user?.id ?? null });
          imagensNovas.push({ nome: file.originalname ?? null, arquivoUrl: url });
        }
      } else if (arquivos[0]) {
        arquivoUrl = await storage.upload(arquivos[0], 'exames', { empresaId: req.empresaId ?? null, animalId: Number(animalId), criadoPorId: req.user?.id ?? null });
      }

      const animalDoExame = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { userId: true } });
      const agora = new Date();
      const observacaoFinal = tipoFinal === 'Imagem' ? null : JSON.stringify({
        laboratorio: laboratorio?.trim() || null, dataHoraColeta: null, tipoAmostra: null,
        indicacaoClinica: null, obs: laudoTexto || null, grupoNome: null, grupos: null,
      });

      const item = await prisma.$transaction(async (tx) => {
        const maxResult = await tx.exameClinico.aggregate({
          where: { animalId: Number(animalId) }, _max: { numero: true },
        });
        const proximoNumero = (maxResult._max.numero ?? 0) + 1;

        const criado = await tx.exameClinico.create({
          data: {
            animalId:        Number(animalId),
            veterinarioId:   req.user.id,
            evolucaoId:      null,
            tipo:            tipoFinal,
            descricao:       descricao.trim(),
            status:          'REALIZADO',
            ativo:           true,
            observacao:      observacaoFinal,
            arquivoUrl,
            resultado:       tipoFinal === 'Imagem' ? (laudoTexto || null) : null,
            numero:          proximoNumero,
            dataSolicitacao: dataExame ? new Date(dataExame) : agora,
            dataResultado:   agora,
          },
        });

        await lancarExameNaFatura(tx, criado, animalDoExame?.userId ?? null, req.empresaId ?? null);

        for (const img of imagensNovas) {
          await tx.exameImagemAnexo.create({
            data: { animalId: Number(animalId), exameClinicoId: criado.id, nome: img.nome, arquivoUrl: img.arquivoUrl, criadoPorId: req.user?.id ?? null },
          });
        }
        for (const it of itens) {
          await tx.exameClinicoResultadoItem.create({
            data: { exameClinicoId: criado.id, parametro: it.parametro, valor: it.valor, unidade: it.unidade, referencia: it.referencia, ordem: it.ordem },
          });
        }

        return tx.exameClinico.findUnique({ where: { id: criado.id }, include: INCLUDE });
      });

      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar exame não pedido:', err);
      res.status(500).json({ error: 'Erro ao criar o exame' });
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
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Autoria via RBAC (nível efetivo em atendimento.exames.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req, item.veterinarioId)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite editar exames criados por você.' });
      }

      const { descricao, observacao, status, laboratorio, tipoAmostra, indicacaoClinica, dataSolicitacao, qtdAmostra } = req.body;

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
        animalId: exame.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
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
          const arquivoUrl = await storage.upload(file, 'exames-imagens', { empresaId: req.empresaId ?? null, animalId: exame.animalId, criadoPorId: req.user?.id ?? null });
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
        if (file) arquivoUrl = await storage.upload(file, 'exames', { empresaId: req.empresaId ?? null, animalId: exame.animalId, criadoPorId: req.user?.id ?? null });
      } else if (file) {
        arquivoUrl = await storage.upload(file, 'exames', { empresaId: req.empresaId ?? null, animalId: exame.animalId, criadoPorId: req.user?.id ?? null });
        try {
          const extracao = await processarExame(file.path, req.user?.id ?? null, exame?.animalId ?? null, req.empresaId ?? null);
          itens = mapExtracaoParaItens(extracao);
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
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
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
            await lancarExameNaFatura(tx, item, animal?.userId, req.empresaId ?? null);
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
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
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
