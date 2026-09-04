// backend/src/controllers/ExameClinicoController.js
'use strict';

const prisma                  = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { corteDePropriedade } = require('../lib/animalPropriedadeCorte');
const { lancarExameNaFatura, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
// `.doc` legado vira `.docx` no INGEST (convert-on-ingest) — ver lib/documentoConversao.js.
// Sem isto o laudo `.doc` fica sem pre-visualizacao E sem leitura por IA.
const { normalizarDocsLegados } = require('../lib/documentoConversao');
const { registrarAuditoria, registrarAlteracao, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro, getNivelEfetivo, NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');
const { animalEstaInativo, bloquearSeAnimalInativo } = require('../lib/animalInativo');
const { animalFoiExcluido } = require('../lib/animalAtivacao');
const { processarExame, processarBuffer, processarLaudoImagem, processarLaudoImagemBuffer, ArquivoSemTranscricaoError } = require('../services/exameParserService');
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
 * Concatena os laudos de exame de IMAGEM já transcritos (um por arquivo
 * anexado). Com mais de um arquivo no MESMO registro — ex.: Ultrassom +
 * Raio-X carregados juntos — cada um vira uma seção com o próprio título
 * (`tipoExame` que a IA leu do documento, ver `parse_laudo_imagem_texto`/
 * `_visao`; nome do arquivo como reserva quando a IA não achou a modalidade
 * escrita nele). Um único laudo não ganha título — não há o que diferenciar.
 * Compartilhado por `analisarNaoPedido` e `salvarResultado`.
 */
function capitalizarPrimeiraLetra(s) {
  const t = (s ?? '').toString().trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function montarLaudoImagemFinal(laudos) {
  const validos = laudos.filter(l => l.texto);
  if (validos.length === 0) return '';
  if (validos.length === 1) return validos[0].texto;
  return validos.map(l => `# ${capitalizarPrimeiraLetra(l.titulo)}\n\n${l.texto}`).join('\n\n---\n\n');
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
 * descrição (comparação insensível a maiúsculas/espaço) e mesma data — usado pelo
 * fluxo "não pedido" (`analisarNaoPedido` + `criarNaoPedido`) para nunca duplicar o
 * resultado do mesmo exame quando o laudo é reenviado/reanalisado por engano.
 * `dataISO` null (a IA não achou data) compara só por tipo+descrição.
 *
 * `ignorarId`: o PRÓPRIO exame, quando `analisarNaoPedido` é chamado para pré-
 * preencher o resultado de um exame PEDIDO existente (tela "Carregar Resultados" —
 * ver `salvarResultado`) — sem isto, o pedido bateria com ele mesmo (mesmo tipo,
 * mesma descrição, mesma data) e todo upload devolveria "exame já carregado".
 */
async function exameDuplicado(animalId, tipo, descricao, dataISO, ignorarId = null) {
  const descricaoNorm = (descricao ?? '').toString().trim().toLowerCase();
  if (!descricaoNorm) return null;

  const candidatos = await prisma.exameClinico.findMany({
    where: {
      animalId: Number(animalId), tipo, ativo: true,
      ...(ignorarId ? { id: { not: Number(ignorarId) } } : {}),
    },
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

      // Transferência de Propriedade — o PROPRIETÁRIO atual só vê o que foi
      // solicitado a partir de `propriedadeDesde`; GESTOR/VET/ADMIN veem tudo.
      const animalCorte = await prisma.animal.findUnique({ where: { id: animalId }, select: { propriedadeDesde: true } });
      const corte = corteDePropriedade(req, animalCorte);

      // Histórico completo (ativos E inativados) — o front filtra por status
      // (SALVA/FINALIZADA/INATIVA) e pagina no cliente, mesmo padrão da tela de Vacina.
      // Segregação multi-clínica: cada empresa vê só os próprios exames do animal.
      const where = { animalId, AND: [escopoFilhoEvolucaoWhere(req)], ...(corte ? { dataSolicitacao: { gte: corte } } : {}) };
      const itens = await prisma.exameClinico.findMany({
        where,
        include: INCLUDE,
        orderBy: { dataSolicitacao: 'desc' },
      });

      const dados = itens.map(it => ({ ...it, laboratorio: laboratorioDoExame(it) }));

      // Justificativa do CANCELAMENTO (exame inativo, ativo:false) — o registro não tem
      // coluna própria para isso (só `ativo`); o texto só existe no AuditLog, gravado
      // por `excluir`. Sem migration: um SELECT pontual, só para os inativos da página.
      const idsInativos = dados.filter(d => !d.ativo).map(d => d.id);
      if (idsInativos.length > 0) {
        const logs = await prisma.auditLog.findMany({
          where:   { categoria: 'CANCELAMENTO', entidade: 'EXAME_CLINICO', entidadeId: { in: idsInativos } },
          orderBy: { timestamp: 'desc' },
          select:  { entidadeId: true, motivo: true },
        });
        const motivoPorId = new Map();
        for (const log of logs) if (!motivoPorId.has(log.entidadeId)) motivoPorId.set(log.entidadeId, log.motivo);
        for (const d of dados) if (!d.ativo) d.justificativa = motivoPorId.get(d.id) ?? null;
      }

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
      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
      }
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }

      // Valida evolução apenas quando fornecida
      if (evolucaoId) {
        const evolucao = await prisma.evolucaoClinica.findFirst({
          where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
          select: { id: true, veterinarioId: true },
        });
        if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal', code: 'EVOLUCAO_NOT_FOUND' });

        // Autoria: pedir exame dentro do atendimento de outro profissional é operar
        // um documento que não é seu — mesma regra de atualizar/finalizar/excluir,
        // só que aqui é ANTES do registro existir. Quem não conduz a evolução (não
        // criou nem assumiu) só pede exame depois de assumi-la.
        if (!podeOperarRegistro(req, evolucao.veterinarioId)) {
          return res.status(403).json({ error: 'Só é possível pedir exame dentro de uma evolução sua. Assuma o atendimento antes de pedir exames.' });
        }
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

  // POST /clinica/exames/analisar (multipart: arquivos[], animalId, tipo?) — LEITURA
  // da IA para pré-preencher o cadastro de um exame CLÍNICO "não pedido", com QUANTOS
  // arquivos o usuário anexar de uma vez — cada um passa pela MESMA regra de extração
  // do tipo, e o resultado é FUNDIDO num só (ver `fundirExtracoesLab`/junção de laudo
  // abaixo). Um arquivo que falhe a classificação (não é laudo) é descartado sem
  // derrubar os demais; só falha a 422 quando NENHUM arquivo é aproveitável.
  // Laboratorial/Bioquímico (tipo omitido): devolve tipo/descrição/laboratório/data
  // sugeridos (do primeiro arquivo válido) + a tabela de resultado com as linhas de
  // TODOS os arquivos — o front reenvia pronta ao criar (ver `criar` +
  // `salvarResultado`), evitando rodar a IA de novo sobre os MESMOS arquivos.
  // Gate pelo slug de RESULTADO (não o de pedido).
  // Imagem (tipo='Imagem'): devolve laudo/data — TRANSCRIÇÃO literal de cada arquivo,
  // concatenada em ordem, nunca tabela nem interpretação (CLAUDE.md §12/28-d).
  // `exameId` (opcional): reusada TAMBÉM pela tela "Carregar Resultados" de um exame
  // PEDIDO existente (`salvarResultado`), para pré-preencher laboratório + tabela
  // antes de salvar — o id exclui o PRÓPRIO pedido da checagem de duplicidade abaixo.
  analisarNaoPedido: async (req, res) => {
    try {
      const { animalId, exameId } = req.body;
      const modoImagem = req.body?.tipo === 'Imagem';
      // `.doc` vira `.docx` ANTES de qualquer leitura: `mammoth` so abre `.docx` e o
      // Gemini nao aceita `.doc` como anexo, entao sem esta linha todo laudo `.doc`
      // caia em `ArquivoSemTranscricaoError` ("nao suportado para ser interpretado").
      // Sem LibreOffice no ambiente devolve o original, e o comportamento e o de antes.
      const arquivos = await normalizarDocsLegados(
        Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []),
      );
      if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório' });
      if (arquivos.length === 0) return res.status(400).json({ error: 'Anexe ao menos um arquivo do laudo' });

      const acesso = await verificarAcessoAnimal({
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const slugResultado = modoImagem ? SLUG_RESULTADO.Imagem : SLUG_RESULTADO.Laboratorial;
      const nivel = await getNivelEfetivo(req, `${slugResultado}.editar`);
      if ((NIVEL_ORDINAL[nivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
        return res.status(403).json({ error: 'Sem permissão para carregar resultado de exame.' });
      }

      // ── IMAGEM: transcrição literal de CADA arquivo, concatenada ──────────────
      if (modoImagem) {
        const laudos = [];
        const naoTranscritos = [];
        let dataExame = null;
        // Nome do exame LIDO no laudo — usado pela tela para conferir se o arquivo
        // anexado é mesmo o exame que foi PEDIDO (um raio-x carregado no pedido de
        // ferro, p.ex.). Sai de `tipoExame`, que o prompt copia do TÍTULO/CABEÇALHO
        // do documento: é texto transcrito, nunca leitura da imagem em si.
        let descricaoLida = null;
        for (const file of arquivos) {
          try {
            const extracao = await processarLaudoImagemBuffer(file.buffer, file.mimetype, req.user?.id ?? null, Number(animalId), req.empresaId ?? null, file.originalname);
            if (extracao?.ehLaudoImagem === false) continue;
            if (extracao?.laudo) {
              laudos.push({ titulo: extracao.tipoExame || file.originalname || 'Laudo', texto: String(extracao.laudo).trim() });
            }
            if (!descricaoLida && extracao?.tipoExame) descricaoLida = String(extracao.tipoExame).trim() || null;
            if (!dataExame && extracao?.dataExame) dataExame = extracao.dataExame;
          } catch (errLLM) {
            // .doc: aceito no upload, mas sem NENHUM caminho de leitura (nem texto,
            // nem visão) — não é falha de IA, é aviso: o arquivo ainda vai anexado
            // normalmente ao salvar, só sem prévia automática.
            if (errLLM instanceof ArquivoSemTranscricaoError) { naoTranscritos.push(file.originalname || 'arquivo'); continue; }
            console.error(`Transcrição LLM falhou para "${file.originalname}":`, errLLM.message);
          }
        }
        if (laudos.length === 0 && naoTranscritos.length === 0) {
          return res.status(422).json({
            error: 'Nenhum dos arquivos é compatível com um laudo de exame de imagem.',
            code:  'ARQUIVO_NAO_E_EXAME',
          });
        }
        return res.json({ dados: { laudo: montarLaudoImagemFinal(laudos), descricao: descricaoLida, dataExame, naoTranscritos } });
      }

      // ── LABORATORIAL/BIOQUÍMICO: extração estruturada de CADA arquivo, combinada ──
      const extracoesValidas = [];
      const naoTranscritos = [];
      for (const file of arquivos) {
        try {
          const extracao = await processarBuffer(file.buffer, req.user?.id ?? null, Number(animalId), req.empresaId ?? null, file.mimetype, file.originalname);
          // A IA classifica o documento ANTES de tentar extrair (prompt parse_laudo,
          // PASSO 0) — pega nota fiscal, contrato, foto qualquer etc. anexados por
          // engano, sem deixar o usuário revisar uma tabela inventada/vazia.
          if (extracao?.ehLaudoExame === false) continue;
          extracoesValidas.push(extracao);
        } catch (errLLM) {
          if (errLLM instanceof ArquivoSemTranscricaoError) { naoTranscritos.push(file.originalname || 'arquivo'); continue; }
          console.error(`Extração LLM falhou para "${file.originalname}":`, errLLM.message);
        }
      }
      if (extracoesValidas.length === 0 && naoTranscritos.length === 0) {
        return res.status(422).json({
          error: 'Nenhum dos arquivos é compatível com um exame.',
          code:  'ARQUIVO_NAO_E_EXAME',
        });
      }

      const primeira      = extracoesValidas[0];
      const tipoSugerido   = primeira?.tipoSugerido === 'Bioquímico' ? 'Bioquímico' : 'Laboratorial';
      const descricao      = (primeira?.nomeExame ?? '').toString().trim() || null;
      const comLaboratorio = extracoesValidas.find(e => (e?.laboratorio ?? '').toString().trim());
      const laboratorio    = comLaboratorio ? String(comLaboratorio.laboratorio).trim() : null;
      const dataExame      = extracoesValidas.find(e => e?.dataExame)?.dataExame || null;
      // Linhas de TODOS os arquivos, uma tabela só — `ordem` é reindexada no conjunto
      // fundido (cada extração reinicia a própria contagem em 0).
      const itens = extracoesValidas
        .flatMap(e => mapExtracaoParaItens(e))
        .map((it, idx) => ({ ...it, ordem: idx }));

      // Nunca repete o resultado do mesmo exame — avisa aqui, assim que a IA lê o(s)
      // laudo(s), para o usuário não preencher a tela inteira e só descobrir no salvar.
      // A checagem definitiva (autoritativa) é feita de novo em `criarNaoPedido`.
      const duplicado = await exameDuplicado(Number(animalId), tipoSugerido, descricao, dataExame, exameId ? Number(exameId) : null);
      if (duplicado) {
        return res.status(409).json({
          error: `Este exame já foi carregado (${duplicado.descricao}).`,
          code:  'EXAME_JA_CARREGADO',
        });
      }

      res.json({ dados: { tipoSugerido, descricao, laboratorio, dataExame, itens, naoTranscritos } });
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
      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
      }
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

      // CONVERT-ON-INGEST: o `.docx` derivado e o artefato CANONICO — e ele que vai
      // para o storage, e e por isso que o visualizador (que so renderiza `.docx`)
      // passa a exibir o laudo sem precisar saber que a origem era `.doc`.
      const arquivos   = await normalizarDocsLegados(
        Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []),
      );
      const laudoTexto = (resultado ?? '').toString().trim();
      const itens      = tipoFinal === 'Imagem' ? [] : parseItensManuais(req.body?.itens);

      if (tipoFinal !== 'Imagem' && itens.length === 0) {
        return res.status(400).json({ error: 'Informe ao menos um parâmetro do resultado' });
      }
      if (tipoFinal === 'Imagem' && arquivos.length === 0 && !laudoTexto) {
        return res.status(400).json({ error: 'Anexe as imagens ou escreva o laudo' });
      }

      // Upload ANTES da transaction (I/O de storage fica fora da transação de banco —
      // mesmo padrão de `salvarResultado`). TODOS os arquivos viram anexo, em
      // qualquer tipo — Laboratorial/Bioquímico ganha `arquivoUrl` (campo legado,
      // aponta para o primeiro) além do anexo completo.
      let arquivoUrl = null;
      const imagensNovas = [];
      if (tipoFinal === 'Imagem') {
        for (const file of arquivos) {
          const url = await storage.upload(file, 'exames-imagens', { empresaId: req.empresaId ?? null, animalId: Number(animalId), criadoPorId: req.user?.id ?? null });
          imagensNovas.push({ nome: file.originalname ?? null, arquivoUrl: url });
        }
      } else {
        for (const file of arquivos) {
          const url = await storage.upload(file, 'exames', { empresaId: req.empresaId ?? null, animalId: Number(animalId), criadoPorId: req.user?.id ?? null });
          if (!arquivoUrl) arquivoUrl = url;
          imagensNovas.push({ nome: file.originalname ?? null, arquivoUrl: url });
        }
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
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // alterado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

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
  // Imagem: extrai o laudo (LLM) em forma de TEXTO TRANSCRITO (nunca interpretado) +
  // guarda as imagens anexadas. Texto digitado à mão sempre vence a IA, nos dois casos.
  // Ao salvar → REALIZADO. RBAC do RESULTADO (distinto do pedido): exames.laboratorial.*
  // / exames.imagem.* por tipo.
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
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // gravado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, exame.animalId)) return;

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
      // CONVERT-ON-INGEST — mesma razao de `criarNaoPedido`: o que fica guardado e o
      // `.docx`, entao pre-visualizacao e leitura por IA funcionam a jusante.
      const arquivos   = await normalizarDocsLegados(
        Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []),
      );
      const agora      = new Date();
      // DATA DO EXAME — a data IMPRESSA no laudo (lida pela IA em /analisar e
      // revisável na tela), não a do upload. Em branco, vale o instante do
      // lançamento, que é o comportamento que sempre houve.
      // ⚠️ `new Date('YYYY-MM-DD')` é meia-noite UTC: para uma clínica em UTC−3 o dia
      // do calendário se mantém, e é DATA PURA (dia do exame), não instante — a
      // tela a formata com `formatDate`, que lê em UTC de propósito (CLAUDE.md §6).
      const dataExameBody = (req.body?.dataExame ?? '').toString().trim();
      const dataResultadoFinal = /^\d{4}-\d{2}-\d{2}$/.test(dataExameBody)
        ? new Date(`${dataExameBody}T00:00:00.000Z`)
        : agora;

      // ── IMAGEM: imagens anexadas + laudo TRANSCRITO pela IA (sem interpretação) ──
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

        // TRANSCRIÇÃO POR IA de CADA arquivo, concatenada — só quando ninguém digitou
        // o laudo à mão (mesma regra "manual vence IA" do ramo Laboratorial abaixo).
        // A IA só transcreve o que está escrito em cada arquivo, nunca interpreta.
        let laudoFinal = laudoTexto;
        if (!laudoFinal && arquivos.length > 0) {
          const laudos = [];
          for (const file of arquivos) {
            try {
              const extracao = await processarLaudoImagem(file.path, file.mimetype, req.user?.id ?? null, exame.animalId, req.empresaId ?? null, file.originalname);
              if (extracao?.ehLaudoImagem !== false && extracao?.laudo) {
                laudos.push({ titulo: extracao.tipoExame || file.originalname || 'Laudo', texto: String(extracao.laudo).trim() });
              }
            } catch (errLLM) {
              // .doc: sem caminho de leitura nenhum — não é falha de IA (ver
              // ArquivoSemTranscricaoError); o arquivo já foi anexado acima do
              // mesmo jeito, só não contribui com texto transcrito.
              if (errLLM instanceof ArquivoSemTranscricaoError) continue;
              // LLM indisponível/falhou para ESTE arquivo → segue para os demais;
              // guarda ao menos o(s) anexo(s) mesmo que nenhum seja transcrito.
              console.error(`salvarResultado — transcrição LLM falhou para "${file.originalname}":`, errLLM.message);
            }
          }
          const laudoTranscrito = montarLaudoImagemFinal(laudos);
          if (laudoTranscrito) laudoFinal = laudoTranscrito;
        }

        await prisma.exameClinico.update({
          where: { id: exame.id },
          data:  { resultado: laudoFinal || exame.resultado, status: 'REALIZADO', dataResultado: dataResultadoFinal },
        });
        return res.json({ dados: { id: exame.id, status: 'REALIZADO', imagens } });
      }

      // ── LABORATORIAL/BIOQUÍMICO: extrai a TABELA de CADA arquivo (LLM) + guarda ───
      // TODOS os arquivos desta chamada — o primeiro alimenta `arquivoUrl` (campo
      // legado, mantido por compatibilidade); cada um também vira um anexo em
      // ExameImagemAnexo, para o usuário abrir/baixar qualquer um deles depois, não
      // só o primeiro (mesma tabela que a Imagem já usa — aqui é só mais um tipo de
      // anexo, não uma tabela nova).
      let arquivoUrl = exame.arquivoUrl;
      let itens = [];

      let primeiroUploadNovo = null;
      for (const file of arquivos) {
        const url = await storage.upload(file, 'exames', { empresaId: req.empresaId ?? null, animalId: exame.animalId, criadoPorId: req.user?.id ?? null });
        if (!primeiroUploadNovo) primeiroUploadNovo = url;
        await prisma.exameImagemAnexo.create({
          data: { animalId: exame.animalId, exameClinicoId: exame.id, nome: file.originalname ?? null, arquivoUrl: url, criadoPorId: req.user?.id ?? null },
        });
      }
      if (primeiroUploadNovo) arquivoUrl = primeiroUploadNovo;

      // PREENCHIMENTO MANUAL: a tela de Resultado de Exame também deixa DIGITAR a
      // tabela, sem laudo nenhum (nem todo laboratório entrega arquivo). Vindo por
      // multipart, `itens` chega como string JSON. Havendo itens digitados, eles
      // MANDAM — não faz sentido pedir a leitura dos arquivos à IA e depois descartar
      // o que a pessoa digitou.
      const itensManuais = parseItensManuais(req.body?.itens);
      if (itensManuais.length > 0) {
        itens = itensManuais;
      } else if (arquivos.length > 0) {
        const extracoesValidas = [];
        for (const file of arquivos) {
          try {
            const extracao = await processarExame(file.path, req.user?.id ?? null, exame?.animalId ?? null, req.empresaId ?? null, file.mimetype, file.originalname);
            if (extracao?.ehLaudoExame === false) continue;
            extracoesValidas.push(extracao);
          } catch (errLLM) {
            // .doc: sem caminho de leitura nenhum — não é falha de IA (o arquivo já
            // foi anexado acima do mesmo jeito, só não contribui com a tabela).
            if (errLLM instanceof ArquivoSemTranscricaoError) continue;
            // LLM indisponível/falhou para ESTE arquivo → segue para os demais;
            // guarda os arquivos mesmo assim (tabela fica com o que os outros deram).
            console.error(`salvarResultado — extração LLM falhou para "${file.originalname}":`, errLLM.message);
          }
        }
        // Linhas de TODOS os arquivos, uma tabela só — `ordem` reindexada no conjunto.
        itens = extracoesValidas.flatMap(e => mapExtracaoParaItens(e)).map((it, idx) => ({ ...it, ordem: idx }));
      }

      // LABORATÓRIO: o campo do modal "Carregar Resultados" (pré-preenchido pela IA
      // via `/clinica/exames/analisar`, editável) é a fonte da vez — grava MERGEADO
      // dentro de `observacao` (mesma estrutura JSON de `criar`/`atualizar`), sem
      // tocar nos demais campos que só existem desde o pedido (tipoAmostra,
      // indicacaoClinica, dataHoraColeta, grupoNome, grupos). Ausente no body (ex.:
      // "Preencher manualmente", que não tem esse campo) → preserva o que já havia.
      let observacaoAtualizada = exame.observacao;
      if (exame.tipo !== 'Compra' && req.body?.laboratorio !== undefined) {
        let extra = {};
        if (exame.observacao) {
          try { extra = JSON.parse(exame.observacao) ?? {}; } catch { extra = {}; }
        }
        extra.laboratorio = req.body.laboratorio.toString().trim() || null;
        observacaoAtualizada = JSON.stringify(extra);
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
          data:  { resultado: laudoTexto || exame.resultado, arquivoUrl, observacao: observacaoAtualizada, status: 'REALIZADO', dataResultado: dataResultadoFinal },
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
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // finalizado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

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
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // cancelado até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.animalId)) return;

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

  // DELETE /clinica/exames/:id/imagens/:imagemId — remove UM anexo do resultado
  // (soft delete, ativo:false). Não mexe no exame nem nos demais anexos.
  // Gate: mesmo slug DINÂMICO do resultado por tipo que `salvarResultado` usa para
  // `.editar`, aqui na variante `.deletar` (exames.laboratorial.deletar /
  // exames.imagem.deletar) — slugs que já existiam no seed sem proteger rota nenhuma
  // (armadilha 27 do CLAUDE.md); esta é a primeira a usá-los.
  // ⚠️ SEM justificativa obrigatória, de propósito (decisão de produto 2026-08-15):
  // é uma imagem a mais dentro de um resultado que continua existindo, não a exclusão
  // do exame/registro em si — o motivo continua sendo exigido para ESSE, aqui não.
  excluirImagem: async (req, res) => {
    try {
      const { motivo } = req.body ?? {};

      const exame = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!exame || !exame.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: exame.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — nada mais é
      // removido até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, exame.animalId)) return;

      const base = SLUG_RESULTADO[exame.tipo];
      if (base) {
        const nivel = await getNivelEfetivo(req, `${base}.deletar`);
        if ((NIVEL_ORDINAL[nivel] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
          return res.status(403).json({ error: `Sem permissão para excluir imagem de exame ${exame.tipo}.` });
        }
      }

      const imagem = await prisma.exameImagemAnexo.findUnique({ where: { id: Number(req.params.imagemId) } });
      if (!imagem || !imagem.ativo || imagem.exameClinicoId !== exame.id) {
        return res.status(404).json({ error: 'Imagem não encontrada' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.exameImagemAnexo.update({ where: { id: imagem.id }, data: { ativo: false } });
        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'EXAME_CLINICO',
          entidadeId: exame.id,
          animalId:   exame.animalId,
          motivo,
          detalhes:   `imagem removida: ${imagem.nome ?? imagem.id}`,
        });
      });

      res.json({ dados: { id: imagem.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir imagem do exame:', err);
      res.status(500).json({ error: 'Erro ao excluir imagem' });
    }
  },
};

module.exports = ExameClinicoController;
