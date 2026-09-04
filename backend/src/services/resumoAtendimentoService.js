// backend/src/services/resumoAtendimentoService.js
// MEMÓRIA CLÍNICA DO PACIENTE — duas camadas, geradas por IA e PERSISTIDAS
// (tb_resumo_atendimento_ia, 1 registro por animal+empresa do contexto):
//
//   1. highlights — padrões factuais entre atendimentos (ex.: perda progressiva
//      de peso), cada um ancorado nos tópicos que o comprovam;
//   2. topicos    — um por evento, com "ref" apontando para o registro de origem
//      (evolucao-31, vacina-7…), o que permite navegar do resumo até a evolução.
//
// O LLM só é chamado quando há eventos NOVOS desde a última consolidação (append
// incremental) — abrir a tela de novo NÃO varre as evoluções nem gasta IA.
// A IA é proibida de sugerir conduta, diagnosticar ou emitir laudo: ela apenas
// descreve e correlaciona o que está registrado (ver prompt 'memoria_clinica').
//
// Fontes: evoluções, vacinas, exames clínicos, prescrições, encaminhamentos
// (mesma segregação multi-clínica do Histórico) + itens de FATURA lançados
// MANUALMENTE (sem FK de origem clínica — ex.: atendimento emergencial).
//
// NOTA: a tabela é acessada via SQL parametrizado (funciona com o client Prisma
// desatualizado — mesmo padrão de lib/auditoria.js).
'use strict';

const crypto = require('crypto');
const prisma = require('../lib/prisma').default;
const { escopoEvolucaoWhere, escopoFilhoEvolucaoWhere, escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { dosesTotaisEsperadas } = require('../lib/agendaDoses');
const { callAI, MODULOS_IA } = require('../ai');
const { buildPrompt, PROMPTS } = require('../ai/prompts');

const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR');

const PROMPT_KEY   = 'memoria_clinica';
const VERSAO_ATUAL = `${PROMPT_KEY}@${PROMPTS[PROMPT_KEY].version}`;

const TIPOS_HIGHLIGHT = new Set(['TENDENCIA', 'RECORRENCIA', 'PENDENCIA', 'ALTERACAO']);
const DIRECOES        = new Set(['aumento', 'reducao', 'estavel', 'nao_aplicavel']);

// ── Registro persistido ───────────────────────────────────────────────────────

async function buscarRegistro(animalId, empresaId) {
  const rows = empresaId
    ? await prisma.$queryRawUnsafe(
        `SELECT id, resumo, dados, versao_prompt AS "versaoPrompt", ultimo_evento_em AS "ultimoEventoEm",
                total_eventos AS "totalEventos", "updatedAt"
           FROM schs2vet.tb_resumo_atendimento_ia WHERE animal_id = $1 AND empresa_id = $2 LIMIT 1`,
        animalId, empresaId)
    : await prisma.$queryRawUnsafe(
        `SELECT id, resumo, dados, versao_prompt AS "versaoPrompt", ultimo_evento_em AS "ultimoEventoEm",
                total_eventos AS "totalEventos", "updatedAt"
           FROM schs2vet.tb_resumo_atendimento_ia WHERE animal_id = $1 AND empresa_id IS NULL LIMIT 1`,
        animalId);
  return rows[0] ?? null;
}

async function salvarRegistro(animalId, empresaId, { resumo, dados, ultimoEventoEm, totalEventos }) {
  const existente = await buscarRegistro(animalId, empresaId);
  const dadosJson = JSON.stringify(dados);
  if (existente) {
    await prisma.$executeRawUnsafe(
      `UPDATE schs2vet.tb_resumo_atendimento_ia
          SET resumo = $1, dados = $2::jsonb, versao_prompt = $3, ultimo_evento_em = $4,
              total_eventos = $5, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $6`,
      resumo, dadosJson, VERSAO_ATUAL, ultimoEventoEm, totalEventos, existente.id);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_resumo_atendimento_ia
         (animal_id, empresa_id, resumo, dados, versao_prompt, ultimo_evento_em, total_eventos)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      animalId, empresaId ?? null, resumo, dadosJson, VERSAO_ATUAL, ultimoEventoEm, totalEventos);
  }
}

// `dados` pode voltar como objeto (jsonb) ou string, conforme o driver.
function lerDados(registro) {
  const bruto = registro?.dados;
  if (!bruto) return { highlights: [], topicos: [], resumoLinhas: [], mudancas: [], resumoAnterior: [], assinatura: null };
  const obj = typeof bruto === 'string' ? safeParse(bruto) : bruto;
  return {
    highlights:   Array.isArray(obj?.highlights)   ? obj.highlights   : [],
    topicos:      Array.isArray(obj?.topicos)      ? obj.topicos      : [],
    // Registro gravado antes do prompt v2 nao tem resumoLinhas: fica vazio e o
    // painel cai no texto corrido de sempre ate a proxima consolidacao.
    resumoLinhas: Array.isArray(obj?.resumoLinhas) ? obj.resumoLinhas : [],
    // O que mudou na ULTIMA consolidacao, e o resumo que valia antes dela. Ficam
    // gravados porque o resumo so e refeito quando ha evento novo: entre uma
    // alteracao e a seguinte, e este o "antes x depois" que a tela mostra.
    mudancas:       Array.isArray(obj?.mudancas)       ? obj.mudancas       : [],
    resumoAnterior: Array.isArray(obj?.resumoAnterior) ? obj.resumoAnterior : [],
    assinatura:     typeof obj?.assinatura === 'string' ? obj.assinatura : null,
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ── Coleta de eventos ─────────────────────────────────────────────────────────
// Retorna TODOS os eventos do escopo, ordenados por data. Cada evento:
// { data, origem, ref, texto }. `ref` casa com o id do Histórico
// (evolucao-31, vacina-7…) e é o que torna o tópico clicável no front.

// Item prescrito COM o quanto ja foi aplicado. Sem este numero o modelo so via o
// nome do medicamento e o status do grupo, e afirmava "foram executadas" um curso
// que esta 0/6 — foi o erro relatado. `dosesTotaisEsperadas` e a MESMA conta que a
// tela de execucao usa (frequencia x duracaoDias), nunca uma estimativa daqui.
function descreverItemPrescrito(item) {
  const feitas = Number(item.dosesExecutadas ?? 0);
  const total  = dosesTotaisEsperadas(item);
  const pct    = total > 0 ? Math.round((feitas / total) * 100) : 0;
  const nome   = `${item.medicamento}${item.dose ? ` ${item.dose}` : ''}`;
  return `${nome} — ${feitas} de ${total} doses aplicadas (${pct}% executado)`;
}

// ASSINATURA DO ESTADO — o que muda SEM entrar evento novo.
// A contagem de eventos nao ve o exame que recebeu resultado nem a prescricao que
// foi de 0 para 3 doses: os dois continuam sendo o mesmo registro, com a mesma data.
// Sem esta assinatura a memoria so se renovava ao NASCER um registro, e a
// comparacao antes x depois nunca chegaria a dizer "a pendencia foi resolvida".
function assinaturaDoEstado(eventos) {
  return crypto.createHash('sha1')
    .update(eventos.map(e => `${e.ref}=${e.estado ?? ''}`).join('|'))
    .digest('hex');
}

async function coletarEventos(req, animalId) {
  const whereAtivo   = { animalId, ativo: true };
  const escopoEvo    = escopoEvolucaoWhere(req);
  const escopoFilho  = escopoFilhoEvolucaoWhere(req);
  const escopoPresc  = escopoPrescricaoGrupoWhere(req);

  const [evolucoes, vacinas, exames, encaminhamentos, grupos, itensManuais, documentos] = await Promise.all([
    prisma.evolucaoClinica.findMany({
      where:  { ...whereAtivo, status: { in: ['EM_ANDAMENTO', 'FINALIZADA', 'CONCLUIDO'] }, AND: [escopoEvo] },
      select: { id: true, titulo: true, especialidade: true, texto: true, dataInicio: true, status: true },
      orderBy: { dataInicio: 'asc' },
    }),
    prisma.vacinaClinica.findMany({
      where:  { ...whereAtivo, AND: [escopoFilho] },
      select: { id: true, nome: true, fabricante: true, observacao: true, dataAplicacao: true, evolucaoId: true, status: true },
      orderBy: { dataAplicacao: 'asc' },
    }),
    prisma.exameClinico.findMany({
      where:  { ...whereAtivo, status: { in: ['SOLICITADO', 'REALIZADO', 'CONCLUIDO'] }, AND: [escopoFilho] },
      select: { id: true, tipo: true, descricao: true, status: true, resultado: true, dataSolicitacao: true, evolucaoId: true },
      orderBy: { dataSolicitacao: 'asc' },
    }),
    prisma.encaminhamentoClinico.findMany({
      where:  { ...whereAtivo, AND: [escopoFilho] },
      select: { id: true, especialidade: true, motivo: true, status: true, dataEncaminhamento: true, evolucaoId: true },
      orderBy: { dataEncaminhamento: 'asc' },
    }),
    // Somente as 5 prescrições mais recentes entram no resumo (evita prompt gigante
    // em pacientes com longo histórico de prescrição)
    prisma.prescricaoGrupo.findMany({
      where:  { animalId, status: { in: ['FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE'] }, AND: [escopoPresc] },
      select: {
        id: true, numero: true, status: true, createdAt: true, evolucaoId: true,
        // dosesExecutadas + frequencia/duracaoDias sao o que permite dizer QUANTO do
        // curso foi aplicado. Sem isso o modelo so via o nome do medicamento e o
        // status do grupo, e passou a afirmar "foram executadas" um curso 0% aplicado.
        itens: {
          where: { ativo: true },
          select: { medicamento: true, tipo: true, dose: true, frequencia: true, duracaoDias: true, dosesExecutadas: true },
          take: 8,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Itens de fatura lançados MANUALMENTE (sem vínculo com origem clínica)
    prisma.faturaItem.findMany({
      where: {
        animalId,
        exameClinicoId: null, prescricaoId: null, vacinaClinicaId: null, encaminhamentoClinicoId: null,
      },
      select: { id: true, tipo: true, descricao: true, valor: true, quantidade: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    }),
    // Documentos EMITIDOS (Central de Documentos). Entram na memória clínica porque
    // são fato do atendimento: um termo de consentimento para eutanásia assinado em
    // março explica a ausência de evolução depois dele, e um atestado sanitário
    // marca a data em que o animal foi declarado apto ao trânsito.
    // Recorte por EMPRESA (o modelo tem `empresaId` próprio, e a evolução é opcional).
    prisma.documentoEmitido.findMany({
      where: { animalId, ativo: true, ...(req.empresaId ? { empresaId: req.empresaId } : {}) },
      select: { id: true, numero: true, titulo: true, templateNome: true, emitidoEm: true, evolucaoId: true },
      orderBy: { emitidoEm: 'asc' },
    // Tabela ainda não migrada não pode derrubar a memória clínica inteira.
    }).catch(() => []),
  ]);

  const eventos = [
    ...evolucoes.map(e => ({
      // `atendimento` = a que consulta o evento pertence. Na evolucao e ela propria;
      // nos filhos e o `evolucaoId`. E o que permite ao resumo dizer "no atendimento
      // de 21/08 foram pedidos os exames X" em vez de listar exame e consulta como
      // dois fatos soltos — o Historico ja agrupa assim, a memoria nao agrupava.
      data: e.dataInicio, origem: 'ATENDIMENTO', ref: `evolucao-${e.id}`, atendimento: e.id, estado: e.status,
      texto: `${e.titulo?.trim() || 'Evolução clínica'}${e.especialidade ? ` (${e.especialidade})` : ''}: ${(e.texto ?? '').slice(0, 500)}`,
    })),
    ...vacinas.map(v => ({
      data: v.dataAplicacao, origem: 'VACINA', ref: `vacina-${v.id}`, atendimento: v.evolucaoId, estado: v.status,
      texto: `Vacina ${v.nome}${v.fabricante ? ` (${v.fabricante})` : ''}${v.observacao ? `. ${v.observacao.slice(0, 120)}` : ''}`,
    })),
    ...exames.map(x => ({
      data: x.dataSolicitacao, origem: 'EXAME', ref: `exame-${x.id}`, atendimento: x.evolucaoId,
      estado: `${x.status}:${x.resultado && String(x.resultado).trim() ? 'COM_RESULTADO' : 'SEM_RESULTADO'}`,
      // `temResultado` explicito: "SOLICITADO" sozinho ja dizia isso, mas o modelo
      // vinha tratando o pedido como exame feito. O estado do exame e o dado mais
      // consultado do resumo (o que esta pendente), entao ele vai afirmado.
      temResultado: Boolean(x.resultado && String(x.resultado).trim()),
      texto: `Exame ${x.tipo} — ${x.status}${x.descricao ? `: ${x.descricao.slice(0, 150)}` : ''}${x.resultado ? `. Resultado: ${x.resultado.slice(0, 200)}` : '. Sem resultado registrado.'}`,
    })),
    ...encaminhamentos.map(en => ({
      data: en.dataEncaminhamento, origem: 'ENCAMINHAMENTO', ref: `encaminhamento-${en.id}`, atendimento: en.evolucaoId, estado: en.status,
      texto: `Encaminhamento para ${en.especialidade} (${en.status}): ${(en.motivo ?? '').slice(0, 150)}`,
    })),
    ...grupos.map(g => ({
      data: g.createdAt, origem: 'PRESCRICAO', ref: `prescricao-${g.id}`, atendimento: g.evolucaoId,
      estado: `${g.status}:${g.itens.reduce((n, i) => n + Number(i.dosesExecutadas ?? 0), 0)}`,
      texto: `Prescrição nº ${String(g.numero).padStart(3, '0')} (${g.status}): ${g.itens.map(descreverItemPrescrito).join('; ').slice(0, 400)}`,
    })),
    ...itensManuais.map(f => ({
      data: f.criadoEm, origem: 'FATURA_MANUAL', ref: `fatura-item-${f.id}`, atendimento: null,
      texto: `Serviço lançado na fatura: ${f.descricao}${f.quantidade > 1 ? ` (x${f.quantidade})` : ''}`,
    })),
    ...documentos.map(d => ({
      data: d.emitidoEm, origem: 'DOCUMENTO', ref: `documento-${d.id}`, atendimento: d.evolucaoId,
      texto: `Documento emitido: ${d.titulo || d.templateNome}${d.numero != null ? ` (nº ${String(d.numero).padStart(4, '0')})` : ''}`,
    })),
  ].sort((a, b) => new Date(a.data) - new Date(b.data));

  const ultimoEventoEm = eventos.length ? new Date(eventos[eventos.length - 1].data) : null;
  return { eventos, total: eventos.length, ultimoEventoEm, assinatura: assinaturaDoEstado(eventos) };
}

// ── Normalização da resposta do LLM ───────────────────────────────────────────
// Descarta qualquer id/ref que o modelo tenha inventado: um tópico só vale se
// casar com um evento realmente coletado, e um highlight só vale se apontar
// para 2+ tópicos existentes.

function normalizarTopicos(brutos, eventosPorId) {
  const saida = [];
  for (const t of Array.isArray(brutos) ? brutos : []) {
    const evento = eventosPorId.get(String(t?.id ?? ''));
    if (!evento) continue;
    const texto = String(t?.texto ?? '').trim();
    if (!texto) continue;
    saida.push({
      id:     evento.id,
      ref:    evento.ref,          // sempre do evento — nunca o que o LLM devolveu
      data:   evento.data,
      origem: evento.origem,
      // Vínculo com a consulta, PERSISTIDO no tópico: num append os tópicos
      // antigos não são reenviados como eventos, e sem isto o agrupamento por
      // atendimento valeria só na primeira consolidação.
      atendimento: evento.atendimento ?? null,
      texto:  texto.slice(0, 400),
    });
  }
  return saida;
}

function normalizarHighlights(brutos, idsValidos) {
  const saida = [];
  for (const h of Array.isArray(brutos) ? brutos : []) {
    const texto = String(h?.texto ?? '').trim();
    if (!texto) continue;
    const topicos = (Array.isArray(h?.topicos) ? h.topicos : [])
      .map(String)
      .filter(id => idsValidos.has(id));
    if (topicos.length < 2) continue;   // highlight sem 2 evidências não entra
    saida.push({
      texto:    texto.slice(0, 200),
      tipo:     TIPOS_HIGHLIGHT.has(h?.tipo)     ? h.tipo     : 'TENDENCIA',
      direcao:  DIRECOES.has(h?.direcao)         ? h.direcao  : 'nao_aplicavel',
      topicos,
    });
    if (saida.length === 6) break;
  }
  return saida;
}

// RESUMO DAS ATIVIDADES — 10 a 20 linhas, produzidas pelo LLM (prompt v2).
// O teto de 20 e cortado AQUI, e nao so pedido no prompt: modelo prolixo devolve
// a lista inteira de eventos de volta, que e justamente o que este resumo veio
// substituir.
const MAX_LINHAS_RESUMO = 20;
// O "o que mudou" e um aviso, nao um segundo resumo: passando de 6 linhas ele
// competiria com o resumo em vez de apontar para dentro dele.
const MAX_LINHAS_MUDANCAS = 6;

function normalizarResumo(bruto) {
  // Aceita o array pedido e tambem texto corrido, que e o que o modelo devolve
  // quando ignora o formato — ai a quebra e por linha.
  const cru = Array.isArray(bruto) ? bruto : String(bruto ?? '').split('\n');
  const linhas = [];
  for (const item of cru) {
    // Bullet e numeracao sao proibidos no prompt; aparecendo, sao retirados aqui
    // em vez de descartar a linha — o conteudo esta certo, so a forma nao.
    const texto = String(item ?? '').trim()
      .replace(/^[-*•\s]+/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();
    if (!texto) continue;
    // 400 e nao 300: [[evolucao-31|...]] ocupa ~18 caracteres que NAO aparecem na
    // tela, e cortar no meio de uma marcacao deixaria colchete cru na frase.
    linhas.push(texto.slice(0, 400));
    if (linhas.length === MAX_LINHAS_RESUMO) break;
  }
  return linhas;
}

// AMARRAS DO RESUMO — [[id|texto]] vira [[ref|texto]].
// O modelo marca o trecho que NOMEIA o registro com o id do topico; aqui o id vira a
// `ref` (evolucao-31, prescricao-7...), que e o que a tela sabe abrir.
// O id e trocado pela ref no SERVIDOR porque so aqui existe a lista de topicos
// validos: id alucinado viraria um link que nao abre nada, e link morto num resumo
// clinico e pior que texto sem link.
const MARCA_RE = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;

// Texto SEM marcacao, para a coluna `resumo` (busca, impressao, leitor que nao
// entende a amarra). A tela usa `resumoLinhas`, que preserva os links.
function semAmarras(linha) {
  return String(linha).replace(MARCA_RE, (_todo, _id, texto) => texto);
}

function resolverAmarras(linha, refPorTopicoId) {
  return String(linha).replace(MARCA_RE, (_todo, id, texto) => {
    const ref = refPorTopicoId.get(String(id).trim());
    // Sem ref conhecida a marcacao CAI, deixando o texto puro: a frase segue legivel
    // ("No atendimento de 09/08/2026 ...") e ninguem clica num link quebrado.
    return ref ? `[[${ref}|${texto}]]` : texto;
  });
}

// Reserva de quando o LLM nao devolve resumo nenhum: uma linha por topico, que
// era o comportamento ate o prompt v2. Nao e um resumo, mas e melhor que vazio.
function montarTextoCorrido(topicos) {
  return topicos.map(t => `${t.data} — ${t.texto}`).join('\n');
}

// ── API do serviço ────────────────────────────────────────────────────────────

function montarSaida(registro, dados, totalEventos, desatualizado) {
  return {
    resumo:       registro?.resumo ?? '',
    resumoLinhas: dados.resumoLinhas ?? [],
    mudancas:       dados.mudancas       ?? [],
    resumoAnterior: dados.resumoAnterior ?? [],
    highlights:   dados.highlights,
    topicos:      dados.topicos,
    atualizadoEm: registro?.updatedAt ?? null,
    totalEventos,
    desatualizado,
  };
}

/**
 * Estado atual da memória clínica + flag de desatualização (sem chamar o LLM).
 */
async function obterResumo(req, animalId) {
  const empresaId = req.empresaId ?? null;
  const [registro, coleta] = await Promise.all([
    buscarRegistro(animalId, empresaId),
    coletarEventos(req, animalId),
  ]);

  const salvos = lerDados(registro);
  const desatualizado = coleta.total > 0 && (
    !registro ||
    registro.totalEventos !== coleta.total ||
    registro.versaoPrompt !== VERSAO_ATUAL ||
    // Estado mudou sem entrar evento novo (resultado lancado, dose aplicada,
    // registro cancelado). `assinatura` null = consolidado antes de ela existir:
    // NAO conta como desatualizado, senao toda memoria antiga da base dispararia
    // uma chamada de IA na primeira abertura de tela.
    (salvos.assinatura !== null && salvos.assinatura !== coleta.assinatura) ||
    (coleta.ultimoEventoEm && registro.ultimoEventoEm &&
      new Date(coleta.ultimoEventoEm) > new Date(registro.ultimoEventoEm))
  );

  return montarSaida(registro, salvos, coleta.total, desatualizado);
}

// Consolidações EM CURSO, por (empresa, animal). Duas chamadas simultâneas para o
// mesmo paciente compartilham a MESMA promessa: uma consolida, a outra espera e
// recebe o resultado dela — uma chamada de IA em vez de duas.
// Acontece mais do que parece: o React em StrictMode monta o efeito DUAS VEZES em
// desenvolvimento, e no uso real basta a ficha aberta em duas abas, dois cliques
// seguidos ou dois profissionais no mesmo paciente. A checagem de "mudou?" não pega
// esse caso — as duas leem o banco ANTES de qualquer uma gravar, e as duas concluem
// que está desatualizado.
// ⚠️ Vale por PROCESSO. Com mais de uma instância de servidor, cada uma tem o seu
// mapa; a proteção vira parcial e o caminho seria um lock no banco.
const consolidacoesEmCurso = new Map();

/**
 * Consolida a memória clínica via LLM quando há eventos novos e persiste.
 * Sem eventos novos → devolve o que está salvo, sem chamar a IA.
 */
async function atualizarResumo(req, animalId, animalNome = null) {
  const chave = `${req.empresaId ?? 'sem-empresa'}:${animalId}`;
  const emCurso = consolidacoesEmCurso.get(chave);
  if (emCurso) return emCurso;

  const promessa = consolidar(req, animalId, animalNome)
    .finally(() => consolidacoesEmCurso.delete(chave));
  consolidacoesEmCurso.set(chave, promessa);
  return promessa;
}

async function consolidar(req, animalId, animalNome) {
  const empresaId = req.empresaId ?? null;
  const registro  = await buscarRegistro(animalId, empresaId);
  const coleta    = await coletarEventos(req, animalId);
  const salvos    = lerDados(registro);

  if (coleta.total === 0) {
    return montarSaida(registro, salvos, 0, false);
  }

  const marcaAnterior = registro?.ultimoEventoEm ? new Date(registro.ultimoEventoEm) : null;
  const novos = marcaAnterior ? coleta.eventos.filter(e => new Date(e.data) > marcaAnterior) : coleta.eventos;
  // Append puro = todos os eventos extras têm data posterior à marca anterior
  const appendConsistente = registro && registro.totalEventos + novos.length === coleta.total;
  const versaoAtual       = registro?.versaoPrompt === VERSAO_ATUAL;
  // Estado de um registro JA consolidado mudou (exame recebeu resultado, dose foi
  // aplicada, prescrição foi cancelada). `null` = consolidado antes da assinatura
  // existir: não conta como mudança, senão toda memória antiga da base se
  // reconstruiria sozinha na primeira abertura de tela.
  const estadoMudou = salvos.assinatura !== null && salvos.assinatura !== coleta.assinatura;

  // Nada novo, nenhum estado alterado e prompt na versão corrente → mantém o salvo
  // (não gasta IA).
  if (registro && appendConsistente && versaoAtual && !estadoMudou && novos.length === 0) {
    return montarSaida(registro, salvos, coleta.total, false);
  }

  // Append incremental quando consistente; senão (primeiro resumo, lançamento
  // retroativo, exclusão de evento ou bump de versão do prompt) reconstrói do
  // zero com a lista completa.
  // ⚠️ `estadoMudou` FORÇA a reconstrução completa: o que mudou pertence a um
  // registro ANTIGO, e no append os antigos não são reenviados — o modelo
  // continuaria dizendo "sem resultado" de um exame que já tem laudo.
  const fazAppend = Boolean(registro && appendConsistente && versaoAtual && !estadoMudou && salvos.topicos.length);
  const base      = fazAppend ? salvos.topicos : [];
  const paraIa    = fazAppend ? novos : coleta.eventos;

  // Os ids são atribuídos AQUI (t1..tN), nunca pelo modelo — ele só os ecoa.
  const offset      = base.length;
  const eventosPrompt = paraIa.map((e, i) => ({
    id:     `t${offset + i + 1}`,
    ref:    e.ref,
    data:   dataBR(e.data),
    tipo:   e.origem,
    // Qual CONSULTA este evento pertence. Sem isto o exame pedido no atendimento
    // do dia 21 sai no resumo como um fato solto com a data propria dele.
    atendimento: e.atendimento ?? null,
    ...(e.temResultado === undefined ? {} : { temResultado: e.temResultado }),
    evento: e.texto,
  }));
  const eventosPorId = new Map(eventosPrompt.map(e => [e.id, {
    id: e.id, ref: e.ref, data: e.data, origem: e.tipo, atendimento: e.atendimento,
  }]));

  // Data de cada atendimento, para o modelo narrar pela consulta e nao pela data
  // solta de cada filho. Sai da lista COMPLETA (nao so dos eventos novos): num
  // append, o exame novo pode pertencer a um atendimento ja consolidado.
  const atendimentos = coleta.eventos
    .filter(e => e.origem === 'ATENDIMENTO')
    .map(e => ({ id: e.atendimento, data: dataBR(e.data) }));

  const { operacaoVers, prompt } = buildPrompt(PROMPT_KEY, {
    topicosAtuais: base.map(t => ({ id: t.id, data: t.data, atendimento: t.atendimento ?? null, texto: t.texto })),
    eventos:       eventosPrompt,
    atendimentos,
    resumoAnterior: salvos.resumoLinhas ?? [],
    animalNome,
  });

  const respostaTexto = await callAI({
    operacao:    operacaoVers,
    modulo:      MODULOS_IA.MEMORIA_CLINICA,
    prompt,
    // 2600 e nao 1800: o prompt v2 devolve o RESUMO (ate 20 linhas) alem dos
    // topicos e highlights, e JSON truncado no meio nao faz parse — a
    // consolidacao inteira se perderia.
    maxTokens:   2600,
    temperature: 0.2,
    userId:      req.user?.id ?? null,
    animalId,
    empresaId,
  });

  const jsonMatch = (respostaTexto ?? '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM não retornou JSON');

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { throw new Error('LLM retornou JSON inválido'); }

  const topicosNovos = normalizarTopicos(parsed.topicos, eventosPorId);
  if (topicosNovos.length === 0) throw new Error('LLM não produziu nenhum tópico válido');

  const topicos    = [...base, ...topicosNovos];
  const idsValidos = new Set(topicos.map(t => t.id));
  const highlights = normalizarHighlights(parsed.highlights, idsValidos);
  // O resumo e RECALCULADO sobre tudo a cada consolidacao (o prompt recebe os
  // topicos ja consolidados junto dos eventos novos), nunca acumulado por append:
  // resumo de 20 linhas somado a cada atualizacao deixaria de ser resumo.
  // id do topico -> ref do registro. Montado sobre TUDO (consolidados + novos):
  // num append o modelo cita atendimento antigo, e sem os ids antigos aqui a amarra
  // daquela linha cairia.
  const refPorTopicoId = new Map(topicos.map(t => [t.id, t.ref]));
  const resumoLinhas = normalizarResumo(parsed.resumo).map(l => resolverAmarras(l, refPorTopicoId));
  // O resumo que valia ATE agora vira o "antes" da comparacao. Guardado aqui e nao
  // recalculado depois: quando esta consolidacao terminar, `salvos` ja nao existe.
  const resumoAnterior = salvos.resumoLinhas ?? [];
  // Sem resumo anterior nao ha o que comparar (primeira consolidacao): o que o
  // modelo devolver ali e invencao, entao nem e lido.
  const mudancas = resumoAnterior.length
    ? normalizarResumo(parsed.mudancas).slice(0, MAX_LINHAS_MUDANCAS).map(l => resolverAmarras(l, refPorTopicoId))
    : [];
  const dados        = { highlights, topicos, resumoLinhas, mudancas, resumoAnterior, assinatura: coleta.assinatura };
  // Coluna `resumo`: o texto do LLM quando existe; o derivado dos topicos quando
  // o modelo omitiu o campo — o painel nunca fica sem nada para mostrar.
  const resumo     = resumoLinhas.length ? resumoLinhas.map(semAmarras).join('\n') : montarTextoCorrido(topicos);

  await salvarRegistro(animalId, empresaId, {
    resumo,
    dados,
    ultimoEventoEm: coleta.ultimoEventoEm,
    totalEventos:   coleta.total,
  });

  return {
    resumo,
    resumoLinhas,
    mudancas,
    resumoAnterior,
    highlights,
    topicos,
    atualizadoEm:  new Date(),
    totalEventos:  coleta.total,
    desatualizado: false,
  };
}

// normalizarResumo e MAX_LINHAS_RESUMO exportados para teste: sao o corte que
// impede o resumo de 10-20 linhas virar a lista inteira de eventos de volta.
module.exports = { obterResumo, atualizarResumo, VERSAO_ATUAL, normalizarResumo, MAX_LINHAS_RESUMO, MAX_LINHAS_MUDANCAS, descreverItemPrescrito, resolverAmarras, semAmarras, consolidacoesEmCurso };
