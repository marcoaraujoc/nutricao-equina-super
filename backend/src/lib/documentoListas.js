// backend/src/lib/documentoListas.js
//
// LISTAS REPETÍVEIS do documento — medicamento, vacina, exame, procedimento e
// qualquer outro grupo que se repita.
//
// 🔴 O PROBLEMA QUE ISTO RESOLVE. Uma LACUNA (`[[Rótulo]]`) é um campo e um valor: ela
// serve para "Nome do comprador", não para "os medicamentos da receita" — receita com
// dois medicamentos precisaria de dois pares de lacunas escritos à mão no modelo, e
// com três, de mais um. O número de itens não é do MODELO, é de cada EMISSÃO.
//
// Uma LISTA é um grupo de sub-campos (as colunas) repetido N vezes (as linhas), com o
// N decidido na hora de emitir. Na tela vira um repetidor com "+ Adicionar"; no papel,
// uma tabela.
//
// 🔴 E ELA NASCE PREENCHIDA. Quando a lista aponta para uma FONTE clínica
// (`prescricao.medicamentos` e amigas), as linhas vêm do que o paciente REALMENTE tem
// no S2Vet — a última prescrição, as vacinas aplicadas, os exames pedidos. O vet
// confere, corrige e acrescenta; não redigita o que o sistema já sabe.
//
// ⚠️ AS COLUNAS DA FONTE SÃO CANÔNICAS, não as que o modelo declarou. É isso que faz o
// preenchimento automático ALINHAR: se o modelo pedisse ["Remédio", "Qtd"] e os dados
// viessem em cinco campos, a dose cairia na coluna da quantidade. Lista SEM fonte usa
// as colunas do modelo e nasce vazia — ali não há dado a alinhar.
//
// ⚠️ NADA DE INVENTAR VALOR continua valendo: paciente sem prescrição devolve lista
// VAZIA (uma linha em branco para preencher), nunca um exemplo.
'use strict';

const prisma = require('./prisma').default;
const { formatarDataNaEmpresa } = require('./fusoEmpresa');

/** Normaliza o rótulo para chave — MESMA regra da lacuna, e de propósito: as duas
 *  convivem no mesmo formulário e uma "Vacinas" lacuna e uma "Vacinas" lista seriam o
 *  mesmo campo para quem preenche. */
function chaveDaLista(rotulo) {
  return String(rotulo ?? '').trim().toLowerCase();
}

/**
 * Fontes clínicas que o S2Vet sabe preencher sozinho.
 *
 * A chave é o `conteudo.fonteDados` do bloco; `colunas` é o contrato entre a consulta
 * e a tabela impressa — mudar uma exige mudar a outra na mesma linha de raciocínio.
 */
const FONTES = {
  'prescricao.medicamentos': {
    rotulo:  'Medicamentos',
    colunas: ['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração'],
  },
  'prescricao.procedimentos': {
    rotulo:  'Procedimentos',
    colunas: ['Procedimento', 'Quantidade', 'Observação'],
  },
  /**
   * SÓ os medicamentos SUJEITOS A CONTROLE ESPECIAL da prescrição.
   *
   * É a fonte do receituário de controle especial, que por norma é um papel PRÓPRIO:
   * o controlado sai nele e o resto continua na receita comum. Mesmas colunas de
   * `prescricao.medicamentos` de propósito — é a mesma linha de receita, o que muda é
   * o RECORTE, e colunas diferentes fariam o vet reler a tabela em cada papel.
   */
  'prescricao.controlados': {
    rotulo:  'Medicamentos sujeitos a controle especial',
    colunas: ['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração'],
  },
  'vacinas.aplicadas': {
    rotulo:  'Vacinas',
    colunas: ['Vacina', 'Lote', 'Aplicação', 'Próxima dose'],
  },
  'exames.resultados': {
    rotulo:  'Exames',
    colunas: ['Exame', 'Solicitado em', 'Resultado'],
  },
};

/** `exames.solicitados` é o mesmo conjunto de `exames.resultados` — o catálogo do
 *  editor usa um nome e o das variáveis usa o outro, e recusar o apelido faria a lista
 *  nascer sem colunas por causa de uma diferença de vocabulário. */
const APELIDOS = { 'exames.solicitados': 'exames.resultados', 'vacinas.ultima': 'vacinas.aplicadas' };

const normalizarFonte = (f) => {
  const chave = String(f ?? '').trim();
  const canon = APELIDOS[chave] ?? chave;
  return FONTES[canon] ? canon : null;
};

/**
 * Tipos de bloco que SÃO lista.
 *
 * Os quatro clínicos já existiam no editor e mostravam linhas de EXEMPLO com a legenda
 * "Preenchido na emissão a partir de X" — promessa que nada cumpria: no papel eles
 * saíam VAZIOS, porque a emissão nunca os preenchia. Entram aqui para que a legenda
 * passe a ser verdade.
 */
const TIPOS_LISTA = new Set([
  'listaCampos', 'medicamentos', 'vacinas', 'procedimentos', 'exames', 'tabelaDinamica',
]);

const ehLista = (b) => TIPOS_LISTA.has(String(b?.tipo ?? ''));

/** Colunas efetivas: as da FONTE quando há fonte, senão as declaradas no modelo. */
function colunasDaLista(b) {
  const fonte = normalizarFonte(b?.conteudo?.fonteDados);
  if (fonte) return [...FONTES[fonte].colunas];
  const declaradas = Array.isArray(b?.conteudo?.colunas)
    ? b.conteudo.colunas.map(c => String(c ?? '').trim()).filter(Boolean)
    : [];
  // Lista sem coluna nenhuma vira um campo de texto por linha — é melhor do que uma
  // tabela de zero colunas, que não renderiza nada e engole o que a pessoa digitar.
  return declaradas.length > 0 ? declaradas : ['Item'];
}

/** Rótulo do grupo: o do modelo, senão o da fonte, senão um genérico. */
function rotuloDaLista(b) {
  const proprio = String(b?.conteudo?.rotulo ?? '').trim();
  if (proprio) return proprio;
  const fonte = normalizarFonte(b?.conteudo?.fonteDados);
  return fonte ? FONTES[fonte].rotulo : 'Itens';
}

/**
 * CATÁLOGOS que uma coluna de lista pode oferecer num `<select>`.
 *
 * 🔴 NÃO CONFUNDIR COM `fonteDados`. Aquela PREENCHE as linhas com o que o PACIENTE
 * tem registrado (a prescrição dele, as vacinas dele). Esta apenas OFERECE o que
 * existe no cadastro da EMPRESA, para a pessoa escolher — e, escolhido um item, traz
 * junto o que a clínica já sabe dele (fabricante, partida, validade), tudo editável.
 * A lista continua nascendo VAZIA: nada é afirmado no papel sem alguém escolher.
 *
 * `preenche` é chaveado pelo NOME DA COLUNA, não pelo índice: o modelo pode
 * reordenar as colunas, e por índice a validade cairia na coluna do fabricante.
 */
const OPCOES = {
  'empresa.vacinas': { rotulo: 'Vacinas da empresa' },
};

const normalizarFonteOpcoes = (f) => {
  const chave = String(f ?? '').trim();
  return OPCOES[chave] ? chave : null;
};

/**
 * As vacinas que a empresa pode aplicar: o catálogo GLOBAL + o dela (a mesma regra de
 * `MedicamentoController.paraAtendimento`), com o lote de validade mais próxima
 * respondendo por partida e validade.
 *
 * ⚠️ Vacina SEM lote entra na lista assim mesmo — a clínica aplica frasco trazido pelo
 * cliente e precisa poder atestar isso; o que falta é digitado à mão.
 * ⚠️ DATA DE FABRICAÇÃO fica em branco: o S2Vet não guarda esse dado em lugar nenhum
 * (`LoteVacina` tem lote e validade), e preencher com a validade seria inventar valor.
 */
async function opcoesEmpresaVacinas(empresaId, fuso) {
  const vacinas = await prisma.medicamento.findMany({
    where: {
      ativo:         true,
      classificacao: { contains: 'vacin', mode: 'insensitive' },
      OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId: Number(empresaId) }] : [])],
    },
    select: {
      nome: true, apresentacao: true, fabricante: true,
      lotes: {
        // FEFO, como o resto do sistema: o frasco que vence primeiro é o que sai.
        // Sem empresa no contexto não existe lote a mostrar (estoque é sempre de
        // alguém) — `-1` não casa com empresa nenhuma, e é o fail-closed de
        // `paraAtendimento`.
        where:   { ativo: true, qtdDisponivel: { gt: 0 }, empresaId: empresaId ? Number(empresaId) : -1 },
        select:  { lote: true, validade: true },
        orderBy: { validade: 'asc' },
        take:    1,
      },
    },
    orderBy: { nome: 'asc' },
    take: 500,
  });

  // DEDUPLICA POR NOME. O catálogo é MISTO (global + o da empresa) e o mesmo produto
  // costuma existir nos dois — sem isto a lista sai com "Abor-Vac" duas vezes e a
  // pessoa escolhe no escuro. Vence a entrada que tem MAIS dado (lote em estoque,
  // depois fabricante): é a que preenche as outras colunas sozinha.
  const porNome = new Map();
  for (const v of vacinas) {
    const nome = txt(v.nome);
    if (!nome) continue;
    const atual = porNome.get(nome);
    const peso  = ((v.lotes ?? []).length > 0 ? 2 : 0) + (txt(v.fabricante) ? 1 : 0);
    if (!atual || peso > atual.peso) porNome.set(nome, { v, peso });
  }

  return [...porNome.values()].map(({ v }) => {
    const lote = (v.lotes ?? [])[0];
    return {
      rotulo: v.nome,
      valores: {
        'Nome comercial da vacina': v.nome,
        Fabricante:                 txt(v.fabricante),
        'Número da partida':        txt(lote?.lote),
        'Data de validade':         lote?.validade ? formatarDataNaEmpresa(lote.validade, fuso) : '',
      },
    };
  });
}

/** Opções de cada lista que declarou `fonteOpcoes`, prontas para a tela. */
async function sugerirOpcoes(listas, { empresaId = null, fuso = undefined } = {}) {
  const comOpcoes = (listas ?? []).filter(l => l.fonteOpcoes);
  const mapa = {};
  for (const l of comOpcoes) {
    if (l.fonteOpcoes === 'empresa.vacinas') {
      // Falha de catálogo NÃO derruba a emissão: sem opções, a coluna volta a ser um
      // campo de texto e o documento continua emissível.
      mapa[l.chave] = await opcoesEmpresaVacinas(empresaId, fuso).catch(() => []);
    }
  }
  return mapa;
}

/**
 * As listas de um documento, na ordem da folha e com a seção em que caem — o mesmo
 * contrato de `coletarCampos`, para o formulário da emissão agrupar os dois juntos.
 */
function coletarListas(blocos) {
  const listas = [];
  const vistas = new Set();
  let secao = null;

  for (const b of Array.isArray(blocos) ? blocos : []) {
    if (b?.tipo === 'subtitulo') secao = String(b?.conteudo?.texto ?? '').trim() || secao;
    if (!ehLista(b)) continue;

    const rotulo = rotuloDaLista(b);
    const chave  = chaveDaLista(rotulo);
    // Rótulo repetido é o MESMO grupo — duas tabelas de "Medicamentos" no mesmo papel
    // (uma no corpo, outra no resumo) recebem as mesmas linhas.
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);

    listas.push({
      chave,
      rotulo,
      colunas:     colunasDaLista(b),
      fonteDados:  normalizarFonte(b?.conteudo?.fonteDados),
      // Catálogo que a PRIMEIRA coluna oferece num `<select>` (ver `OPCOES` abaixo).
      // Diferente de `fonteDados`: aquela PREENCHE linhas sozinha, esta apenas OFERECE
      // o que existe no cadastro da empresa para a pessoa escolher.
      fonteOpcoes: normalizarFonteOpcoes(b?.conteudo?.fonteOpcoes),
      secao,
    });
  }
  return listas;
}

// ── Lista OBRIGATÓRIA ───────────────────────────────────────────────────────

/**
 * A lista precisa de pelo menos UMA linha preenchida para o documento ser emitido.
 *
 * 🔴 REGRA PEDIDA em 2026-09-04 para o Atestado de Vacinação (Anexo XI): "obrigar a
 * preencher pelo menos 1 vacina". Um atestado de vacinação sem nenhuma vacina não é
 * um documento incompleto — é um documento que NÃO DECLARA NADA, assinado por um
 * veterinário. Pior ainda depois de `removerVazios` (2026-09-03): a lista vazia é
 * descartada do snapshot, então o papel sai sem sequer o rótulo, e nada nele acusa
 * que faltou alguma coisa.
 *
 * O gatilho é `fonteOpcoes` — a lista que OFERECE o catálogo da empresa é a lista que
 * dá razão de ser ao documento (hoje só as vacinas; medicamento/procedimento/exame
 * seguirão o mesmo molde e a mesma conclusão: receituário sem medicamento é papel em
 * branco). ⚠️ NÃO vale para toda lista: grupo repetível sem catálogo — "Identificação
 * do Comprador", itens de uma nota — é acessório em muitos modelos, e exigi-lo
 * travaria a emissão dos 12 modelos do CFMV por um dado que a norma não pede.
 *
 * ⚠️ `conteudo.obrigatoria` VENCE, quando o modelo o traz: é o gancho para o editor
 * marcar (ou desmarcar) qualquer lista sem depender deste heurístico. Nenhum modelo
 * grava o campo hoje, e por isso NÃO houve migration nem re-seed.
 */
function listaObrigatoria(lista) {
  if (typeof lista?.obrigatoria === 'boolean') return lista.obrigatoria;
  return !!lista?.fonteOpcoes;
}

/**
 * Linha preenchida = a PRIMEIRA coluna tem conteúdo — é ela que NOMEIA o item (a
 * vacina, o medicamento). Linha só com observação digitada não é um item: iria para
 * o papel como um registro sem sujeito.
 */
function temLinhaPreenchida(linhas) {
  return (Array.isArray(linhas) ? linhas : []).some(l => String(l?.[0] ?? '').trim() !== '');
}

/**
 * Devolve a PRIMEIRA lista obrigatória que ficou sem nenhuma linha preenchida, ou
 * `null` quando está tudo certo. `linhasPorChave` é o mapa que a emissão recebe.
 */
function listaObrigatoriaVazia(listas, linhasPorChave) {
  return (Array.isArray(listas) ? listas : [])
    .find(l => listaObrigatoria(l) && !temLinhaPreenchida(linhasPorChave?.[l.chave])) ?? null;
}

// ── Preenchimento automático ────────────────────────────────────────────────

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Linhas sugeridas para uma fonte, a partir do que o PACIENTE tem.
 *
 * ⚠️ Só o que está registrado. Sem prescrição, sem vacina, sem exame → `[]`, e a tela
 * abre com uma linha em branco. Sugerir um medicamento plausível num receituário seria
 * o pior tipo de erro que este módulo pode cometer.
 */
async function linhasDaFonte(fonte, { animalId, evolucaoId = null, empresaId = null, fuso = undefined, prescricaoGrupoId = null }) {
  const data = (d) => (d ? formatarDataNaEmpresa(d, fuso) : '');

  if (fonte === 'prescricao.medicamentos' || fonte === 'prescricao.procedimentos'
      || fonte === 'prescricao.controlados') {
    const querProcedimento = fonte === 'prescricao.procedimentos';
    const querControlado   = fonte === 'prescricao.controlados';
    const grupo = await prisma.prescricaoGrupo.findFirst({
      where: {
        animalId,
        // 🔴 `prescricaoGrupoId` VENCE tudo: é a prescrição que a pessoa tinha na tela
        // quando pediu o receituário. Sem ele, o receituário de controle especial de
        // uma prescrição antiga sairia com os medicamentos da mais recente.
        // ⚠️ O id vem do cliente, mas continua dentro do `animalId` já autorizado (e
        // do RLS): o pior caso é não achar grupo nenhum e a lista nascer vazia.
        ...(prescricaoGrupoId
          ? { id: prescricaoGrupoId }
          // A prescrição DO ATENDIMENTO em curso quando ele existe; senão a última que
          // valeu. Emitir a receita de um atendimento com os itens de outro seria pior
          // do que emitir em branco.
          : (evolucaoId ? { evolucaoId } : { status: { in: ['FINALIZADO', 'EXECUTADO'] } })),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        itens: {
          where:  { ativo: true },
          // ⚠️ `Prescricao` NÃO tem coluna de quantidade — o que existe é `dosagem` +
          // `unidade`. Pedir um campo inexistente derruba a consulta inteira com
          // "Unknown field", e a lista voltaria vazia sem pista nenhuma do motivo.
          select: {
            tipo: true, medicamento: true, dosagem: true, unidade: true, via: true,
            frequencia: true, duracaoDias: true, observacao: true,
            // Quem diz que o medicamento é controlado é o CATÁLOGO, não o texto do
            // item: `medicamento` é o nome digitado e pode ser qualquer coisa.
            medicamentoCat: { select: { controlado: true } },
          },
          take:   30,
        },
      },
    }).catch(() => null);

    const itens = (grupo?.itens ?? []).filter(i =>
      querProcedimento ? i.tipo === 'PROCEDIMENTO'
        : (i.tipo !== 'PROCEDIMENTO'
           // Item fora do catálogo não é controlado: sem cadastro não há classificação,
           // e presumir que é traria remédio comum para o receituário especial.
           && (!querControlado || i.medicamentoCat?.controlado === true)));

    if (querProcedimento) {
      return itens.map(i => [
        txt(i.medicamento),
        [txt(i.dosagem), txt(i.unidade)].filter(Boolean).join(' ') || '1',
        txt(i.observacao),
      ]);
    }
    return itens.map(i => [
      txt(i.medicamento),
      [txt(i.dosagem), txt(i.unidade)].filter(Boolean).join(' '),
      txt(i.via),
      txt(i.frequencia),
      i.duracaoDias ? `${i.duracaoDias} dia${i.duracaoDias > 1 ? 's' : ''}` : '',
    ]);
  }

  if (fonte === 'vacinas.aplicadas') {
    const vacinas = await prisma.vacinaClinica.findMany({
      where:   { animalId, ativo: true },
      orderBy: { dataAplicacao: 'desc' },
      take:    12,
      select:  { nome: true, lote: true, dataAplicacao: true, dataReforco: true },
    }).catch(() => []);
    return vacinas.map(v => [txt(v.nome), txt(v.lote), data(v.dataAplicacao), data(v.dataReforco)]);
  }

  if (fonte === 'exames.resultados') {
    const exames = await prisma.exameClinico.findMany({
      where:   { animalId, ativo: true },
      orderBy: { dataSolicitacao: 'desc' },
      take:    12,
      select:  { tipo: true, descricao: true, dataSolicitacao: true, resultado: true },
    }).catch(() => []);
    return exames.map(e => [txt(e.descricao) || txt(e.tipo), data(e.dataSolicitacao), txt(e.resultado)]);
  }

  return [];
}

/**
 * Sugestões de TODAS as listas de um documento, em paralelo e só para as fontes que o
 * documento realmente usa — um atestado sem tabela de vacina não paga a consulta de
 * vacinas.
 */
async function sugerirListas(listas, contexto) {
  const comFonte = (listas ?? []).filter(l => l.fonteDados);
  const linhas = await Promise.all(comFonte.map(l => linhasDaFonte(l.fonteDados, contexto).catch(() => [])));
  const mapa = {};
  comFonte.forEach((l, i) => { mapa[l.chave] = linhas[i]; });
  return mapa;
}

// ── Aplicação nos blocos ────────────────────────────────────────────────────

/** Descarta linha totalmente em branco: linha vazia impressa é uma tabela com buracos. */
const linhaTemAlgo = (l) => Array.isArray(l) && l.some(c => String(c ?? '').trim());

/**
 * Escreve as linhas preenchidas dentro dos blocos de lista.
 *
 * ⚠️ `fonteDados` é APAGADO na saída, de propósito: o bloco vira uma tabela literal com
 * as linhas daquele dia. É o que faz o documento emitido ser um SNAPSHOT — reimprimir
 * daqui a dois anos não pode voltar ao banco e trazer a prescrição de hoje.
 */
/**
 * Uma linha da lista virando um GRUPO DE CAMPOS, no lugar de uma faixa de tabela.
 *
 * 🔴 POR QUE existe o formato `campos` (2026-09-03, a pedido): a vacina tem SETE
 * dados, e sete colunas numa A4 retrato espremem cada uma em ~25mm — o nome comercial
 * quebra em três linhas e a observação vira uma coluna ilegível. Em campos, o mesmo
 * conteúdo sai como os demais cards do documento ("Rótulo: valor", três por linha), e
 * o que está em branco simplesmente não aparece.
 *
 * ⚠️ Cada célula vira um `campoAuto` SEM `variavel`: o valor já está resolvido e mora
 * em `texto`. É o que faz `removerVazios` limpar os brancos e os dois renderizadores
 * desenharem sem saber que aquilo veio de uma lista.
 * ⚠️ UM CAMPO POR LINHA (a pedido, 2026-09-03). Três por linha foi tentado e recusado:
 * os rótulos da vacina são longos ("Nome comercial da vacina", "Data de fabricação") e,
 * em um terço de linha, rótulo e valor disputavam o mesmo espaço.
 * ⚠️ `linha` entre um item e o outro, nunca antes do primeiro: sem separador, duas
 * vacinas viram um bloco só de catorze campos.
 */
function linhaEmCampos(colunas, valores) {
  const blocos = [];
  colunas.forEach((coluna, i) => {
    const valor = String(valores[i] ?? '').trim();
    if (!valor) return;   // em branco não vira campo, e portanto não vai ao papel
    blocos.push({
      id: `lc${i}_${Math.random().toString(36).slice(2, 8)}`,
      tipo: 'campoAuto',
      conteudo: { rotulo: coluna, texto: valor },
      estilo: { tamanho: 11, espacamentoBase: 3, colunas: 1 },
      visivel: true,
    });
  });
  return blocos;
}

function aplicarListasEmBlocos(blocos, listas) {
  if (!Array.isArray(blocos)) return [];
  const valores = listas && typeof listas === 'object' ? listas : {};

  return blocos.flatMap((b) => {
    if (!ehLista(b)) return [b];
    const chave   = chaveDaLista(rotuloDaLista(b));
    const colunas = colunasDaLista(b);
    const brutas  = Array.isArray(valores[chave]) ? valores[chave] : [];
    const linhas  = brutas
      .filter(linhaTemAlgo)
      .map(l => colunas.map((_, i) => String(l?.[i] ?? '').trim()));

    // FORMATO `campos`: o grupo deixa de ser uma tabela e vira uma sequência de
    // campos por item, com um separador entre itens. Ver `linhaEmCampos`.
    if (b?.conteudo?.formato === 'campos') {
      return linhas.flatMap((valoresDaLinha, i) => [
        ...(i > 0
          ? [{ id: `lcsep${i}`, tipo: 'linha', conteudo: {},
               estilo: { espacamentoTopo: 6, espacamentoBase: 6 }, visivel: true }]
          : []),
        ...linhaEmCampos(colunas, valoresDaLinha),
      ]);
    }

    return [{
      ...b,
      // Vira `tabela`: o tipo original só existia para dizer DE ONDE vinham os dados, e
      // no emitido eles já vieram. Assim o snapshot não depende de nenhum tipo especial
      // continuar existindo no editor daqui a dois anos.
      tipo: 'tabela',
      conteudo: { ...(b.conteudo ?? {}), colunas, linhas, fonteDados: undefined },
    }];
  });
}

module.exports = {
  FONTES,
  TIPOS_LISTA,
  ehLista,
  chaveDaLista,
  rotuloDaLista,
  colunasDaLista,
  normalizarFonte,
  coletarListas,
  listaObrigatoria,
  temLinhaPreenchida,
  listaObrigatoriaVazia,
  linhasDaFonte,
  sugerirListas,
  sugerirOpcoes,
  OPCOES,
  aplicarListasEmBlocos,
};
