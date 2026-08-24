// backend/src/lib/fusoEmpresa.js
// FUSO HORÁRIO DA CLÍNICA — fonte única do lado do servidor.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO EXISTE
// ─────────────────────────────────────────────────────────────────────────────
// A aplicação roda em TODO O BRASIL, que tem QUATRO fusos:
//     UTC−2  America/Noronha
//     UTC−3  America/Sao_Paulo   (Brasília, SP, Rio, Sul, Nordeste)
//     UTC−4  America/Manaus, Cuiabá, Campo Grande, Porto Velho, Boa Vista
//     UTC−5  America/Rio_Branco, Eirunepé
//
// O processo Node roda com `process.env.TZ = 'America/Sao_Paulo'` (server.ts), então
// `new Date().getHours()` devolve a hora de BRASÍLIA — não a da clínica. Para uma
// clínica em UTC−4/−5 isso desloca:
//   • o "hoje" da fila do plantão (uma dose aplicada às 22h em Rio Branco cai no dia
//     seguinte pela conta do servidor — 00h em Brasília);
//   • o horário exibido em e-mail e WhatsApp (1-2h a mais).
//
// ⚠️ NUNCA use `getHours()`/`getDate()` do Date para exibir ou comparar dia/hora de
// algo que pertence a uma EMPRESA. Use `hojeNaEmpresa` / `diaNaEmpresa` /
// `formatarNaEmpresa` daqui, que resolvem pelo fuso configurado.
//
// ⚠️ `process.env.TZ` NÃO deve ser trocado em runtime para "virar" o fuso do tenant:
// é global ao processo e o servidor atende várias clínicas ao mesmo tempo — trocá-lo
// no meio de uma requisição corromperia as outras. Por isso tudo aqui passa por
// `Intl` com `timeZone` EXPLÍCITO, que é isolado por chamada.
//
// ⚠️ SQL CRU (mesma razão de validadeOrcamento/acessoSistema): no Windows o
// `prisma generate` falha com o backend rodando, e passar um campo que o client ainda
// não conhece ao update derrubaria o SALVAR de Configurações inteiro. Sempre
// parametrizado. E `tb_empresa_configuracoes` é das poucas tabelas SEM @map nas FKs —
// as colunas chamam-se "empresaId"/"equipeId" (camelCase) e EXIGEM aspas no Postgres
// (armadilha 41 do CLAUDE.md).
'use strict';

// ⚠️ `require` TARDIO do client: `lib/prisma` é TypeScript e o carregamento no topo
// arrastava o parser para dentro dele, quebrando qualquer teste que só queira as
// funções PURAS daqui (formatação/conversão de fuso, que não tocam o banco).
const getPrisma = () => require('./prisma').default;

/** Fuso assumido quando a empresa não configurou nada — é o comportamento que o
 *  sistema sempre teve (process.env.TZ do server.ts). Mudar isto muda o padrão de
 *  TODA clínica que não escolheu fuso: não mexer sem decisão de produto. */
const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * UF → fuso IANA. É daqui que o fuso da clínica sai: o gestor NÃO escolhe fuso
 * (ninguém deveria precisar saber o que é "America/Cuiaba" para cadastrar a
 * clínica) — ele é DEDUZIDO do endereço que o cadastro já coletou.
 *
 * Os estados de UTC−3 poderiam todos apontar para America/Sao_Paulo, já que hoje
 * são equivalentes; ficam com o nome canônico de cada um de propósito: o Brasil já
 * teve horário de verão em parte dos estados, e se voltar a ter, o mapa continua
 * correto sem precisar ser reescrito sob pressão.
 */
const FUSO_POR_UF = {
  AC: 'America/Rio_Branco',    // UTC−5
  AL: 'America/Maceio',        // UTC−3
  AM: 'America/Manaus',        // UTC−4 (o extremo oeste é −5 — ver `fusoPorCep`)
  AP: 'America/Belem',         // UTC−3
  BA: 'America/Bahia',         // UTC−3
  CE: 'America/Fortaleza',     // UTC−3
  DF: 'America/Sao_Paulo',     // UTC−3
  ES: 'America/Sao_Paulo',     // UTC−3
  GO: 'America/Sao_Paulo',     // UTC−3
  MA: 'America/Fortaleza',     // UTC−3
  MG: 'America/Sao_Paulo',     // UTC−3
  MS: 'America/Campo_Grande',  // UTC−4
  MT: 'America/Cuiaba',        // UTC−4
  PA: 'America/Belem',         // UTC−3
  PB: 'America/Fortaleza',     // UTC−3
  PE: 'America/Recife',        // UTC−3 (Fernando de Noronha é −2 — ver `fusoPorCep`)
  PI: 'America/Fortaleza',     // UTC−3
  PR: 'America/Sao_Paulo',     // UTC−3
  RJ: 'America/Sao_Paulo',     // UTC−3
  RN: 'America/Fortaleza',     // UTC−3
  RO: 'America/Porto_Velho',   // UTC−4
  RR: 'America/Boa_Vista',     // UTC−4
  RS: 'America/Sao_Paulo',     // UTC−3
  SC: 'America/Sao_Paulo',     // UTC−3
  SE: 'America/Maceio',        // UTC−3
  SP: 'America/Sao_Paulo',     // UTC−3
  TO: 'America/Araguaina',     // UTC−3
};

/**
 * Faixas de CEP → UF. Usadas quando a empresa tem CEP mas não tem `estado`
 * preenchido (cadastro antigo, ou importação). Cada item é [inicio, fim, UF] sobre
 * os 5 primeiros dígitos do CEP.
 *
 * ⚠️ As faixas de AM/RR/AC dentro do 69xxx e as de DF/GO/RO dentro do 7xxxx são
 * INTERCALADAS — não é "um prefixo por estado". Por isso a tabela é por intervalo,
 * e não um `switch` no primeiro dígito.
 */
const FAIXAS_CEP = [
  [ 1000, 19999, 'SP'], [20000, 28999, 'RJ'], [29000, 29999, 'ES'],
  [30000, 39999, 'MG'], [40000, 48999, 'BA'], [49000, 49999, 'SE'],
  [50000, 56999, 'PE'], [57000, 57999, 'AL'], [58000, 58999, 'PB'],
  [59000, 59999, 'RN'], [60000, 63999, 'CE'], [64000, 64999, 'PI'],
  [65000, 65999, 'MA'], [66000, 68899, 'PA'], [68900, 68999, 'AP'],
  [69000, 69299, 'AM'], [69300, 69389, 'RR'], [69400, 69899, 'AM'],
  [69900, 69999, 'AC'], [70000, 72799, 'DF'], [72800, 72999, 'GO'],
  [73000, 73699, 'DF'], [73700, 76799, 'GO'], [76800, 76999, 'RO'],
  [77000, 77999, 'TO'], [78000, 78899, 'MT'], [78900, 78999, 'RO'],
  [79000, 79999, 'MS'], [80000, 87999, 'PR'], [88000, 89999, 'SC'],
  [90000, 99999, 'RS'],
];

/** Fernando de Noronha: UTC−2, único lugar do Brasil nesse fuso. Pertence a PE
 *  (que é UTC−3), então só o CEP distingue. Faixa 53990-xxx. */
const CEP_NORONHA = [53990, 53990];

/** UF (2 letras) → fuso IANA, ou null se a UF não for reconhecida. */
function fusoPorUf(uf) {
  if (!uf) return null;
  return FUSO_POR_UF[String(uf).trim().toUpperCase()] ?? null;
}

/** CEP (com ou sem máscara) → fuso IANA, ou null. */
function fusoPorCep(cep) {
  const digitos = String(cep ?? '').replace(/\D/g, '');
  if (digitos.length < 5) return null;
  const prefixo = Number(digitos.slice(0, 5));
  if (Number.isNaN(prefixo)) return null;
  if (prefixo >= CEP_NORONHA[0] && prefixo <= CEP_NORONHA[1]) return 'America/Noronha';
  const faixa = FAIXAS_CEP.find(([ini, fim]) => prefixo >= ini && prefixo <= fim);
  return faixa ? fusoPorUf(faixa[2]) : null;
}

/**
 * Fuso deduzido do endereço da clínica. O CEP vem PRIMEIRO: ele é mais específico
 * que a UF (é o único jeito de separar Fernando de Noronha do resto de Pernambuco).
 * Sem CEP utilizável, cai na UF.
 */
function fusoPorEndereco({ cep, estado } = {}) {
  return fusoPorCep(cep) ?? fusoPorUf(estado) ?? null;
}

const FUSOS_VALIDOS = new Set(Object.values(FUSO_POR_UF).concat(['America/Noronha', 'America/Eirunepe']));

/** "Manaus (UTC−4)" — rótulo legível de um fuso, para a tela apenas EXIBIR qual foi
 *  detectado. O deslocamento é calculado pelo `Intl` (nunca escrito à mão: se o país
 *  voltar a ter horário de verão, o rótulo se corrige sozinho). */
function rotuloFuso(fuso, quando = new Date()) {
  const zona = fuso || FUSO_PADRAO;
  let offset = '';
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: zona, timeZoneName: 'shortOffset' })
      .formatToParts(quando);
    offset = (partes.find(p => p.type === 'timeZoneName')?.value ?? '')
      .replace('GMT', 'UTC').replace('-', '−');
  } catch { /* fuso desconhecido — devolve só a cidade */ }
  const cidade = zona.split('/').pop().replace(/_/g, ' ');
  return offset ? `${cidade} (${offset})` : cidade;
}

/** Normaliza a entrada do request. Retorna { erro } ou { valor: string|null }. */
function normalizarFuso(bruto) {
  if (bruto === undefined) return { valor: undefined };  // não altera
  const s = String(bruto ?? '').trim();
  if (s === '') return { valor: null };                  // volta ao padrão
  if (!FUSOS_VALIDOS.has(s)) {
    return { erro: 'Fuso horário inválido — escolha um dos fusos do Brasil.' };
  }
  return { valor: s };
}

// ─── Leitura / escrita ───────────────────────────────────────────────────────

/**
 * Cache em memória por empresa. O fuso é lido em caminho quente (fila do plantão,
 * cron de lembrete, cada e-mail) e muda praticamente nunca — sem cache seria um
 * SELECT por formatação. TTL curto para a troca na tela refletir sozinha.
 */
const cache = new Map();           // empresaId → { fuso, expiraEm }
const TTL_MS = 60_000;

function invalidarCache(empresaId = null) {
  if (empresaId == null) cache.clear();
  else cache.delete(Number(empresaId));
}

/** Lê o fuso configurado no escopo (sem cache). null = não configurado. */
async function lerFuso(client, empresaId, equipeId = null) {
  const rows = equipeId == null
    ? await client.$queryRawUnsafe(
        `SELECT fuso_horario AS fuso FROM schs2vet.tb_empresa_configuracoes
          WHERE "empresaId" = $1 AND "equipeId" IS NULL LIMIT 1`, Number(empresaId))
    : await client.$queryRawUnsafe(
        `SELECT fuso_horario AS fuso FROM schs2vet.tb_empresa_configuracoes
          WHERE "empresaId" = $1 AND "equipeId" = $2 LIMIT 1`, Number(empresaId), Number(equipeId));
  const fuso = rows?.[0]?.fuso;
  return fuso ? String(fuso) : null;
}

/** Grava o fuso no escopo. A linha de configuração já existe quando isto roda
 *  (salvarConfiguracao faz o upsert antes). */
async function salvarFuso(client, empresaId, equipeId, fuso) {
  if (fuso === undefined) return;
  const valor = fuso == null ? null : String(fuso);
  if (equipeId == null) {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_empresa_configuracoes SET fuso_horario = $2
        WHERE "empresaId" = $1 AND "equipeId" IS NULL`, Number(empresaId), valor);
  } else {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_empresa_configuracoes SET fuso_horario = $2
        WHERE "empresaId" = $1 AND "equipeId" = $3`, Number(empresaId), valor, Number(equipeId));
  }
  invalidarCache(empresaId);
}

/**
 * Fuso EFETIVO da empresa — o configurado, ou `FUSO_PADRAO`. Nunca devolve null:
 * quem chama está prestes a formatar/comparar e precisa de um fuso válido.
 *
 * 🔴 Procura primeiro a linha da EMPRESA (equipeId null) e, não achando, qualquer
 * linha daquela empresa — empresa pessoal (CPF) configura POR EQUIPE, e sem esse
 * fallback ela nunca enxergaria o próprio fuso. Nunca falha: erro de banco cai no
 * padrão, porque derrubar a fila do plantão por causa de uma preferência de exibição
 * seria pior que exibir no fuso antigo.
 */
async function fusoDaEmpresa(empresaId, client = null) {
  if (!empresaId) return FUSO_PADRAO;
  const db = client ?? getPrisma();
  const id = Number(empresaId);
  const agora = Date.now();
  const hit = cache.get(id);
  if (hit && hit.expiraEm > agora) return hit.fuso;

  let fuso = null;

  // 1. Override explícito. NÃO é exposto ao gestor — ele não escolhe fuso. Existe
  //    para o caso raro em que o endereço não decide sozinho (ex.: clínica no
  //    extremo oeste do Amazonas, que é UTC−5 embora a UF seja AM/UTC−4) e para o
  //    ADMIN da plataforma corrigir sem depender de deploy.
  try {
    const rows = await db.$queryRawUnsafe(
      `SELECT fuso_horario AS fuso FROM schs2vet.tb_empresa_configuracoes
        WHERE "empresaId" = $1 AND fuso_horario IS NOT NULL
        ORDER BY "equipeId" NULLS FIRST LIMIT 1`, id);
    if (rows?.[0]?.fuso) fuso = String(rows[0].fuso);
  } catch {
    // Coluna ainda não existe (migration não aplicada): segue para a dedução.
  }

  // 2. Dedução pelo ENDEREÇO da clínica — o caminho normal. O cadastro já coleta
  //    CEP e UF (busca automática por CEP), então o fuso sai de graça, sem
  //    perguntar nada a quem cadastra.
  if (!fuso) {
    try {
      const empresa = await db.empresa.findUnique({
        where:  { id },
        select: { cep: true, estado: true },
      });
      fuso = fusoPorEndereco(empresa ?? {});
    } catch {
      // Sem acesso ao cadastro: cai no padrão abaixo.
    }
  }

  // 3. Empresa sem endereço utilizável — o comportamento que sempre existiu.
  fuso = fuso || FUSO_PADRAO;
  cache.set(id, { fuso, expiraEm: agora + TTL_MS });
  return fuso;
}

// ─── Formatação / comparação NO FUSO DA CLÍNICA ──────────────────────────────

/** Componentes de um instante no fuso pedido. Base de tudo abaixo. */
function partesNoFuso(data, fuso) {
  // ⚠️ Rejeita null/undefined/'' ANTES do construtor: `new Date(null)` é a época
  // (1970), NÃO data inválida — sem esta guarda, uma data ausente virava
  // "1969-12-31"/"31/12/1969" em silêncio, e como chave de dia não casaria com
  // nada (ou pior, casaria com outro registro igualmente vazio).
  if (data == null || data === '') return null;
  const d = data instanceof Date ? data : new Date(data);
  if (isNaN(d.getTime())) return null;
  let partes;
  try {
    partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso || FUSO_PADRAO,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
  } catch {
    // Fuso inválido gravado à mão no banco não pode derrubar a requisição.
    partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_PADRAO,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
  }
  const get = (t) => partes.find(p => p.type === t)?.value ?? '';
  return {
    ano: get('year'), mes: get('month'), dia: get('day'),
    hora: get('hour'), minuto: get('minute'),
  };
}

/** 'YYYY-MM-DD' de um instante NO FUSO da clínica — chave de comparação de dia. */
function diaNaEmpresa(data, fuso) {
  const p = partesNoFuso(data, fuso);
  return p ? `${p.ano}-${p.mes}-${p.dia}` : null;
}

/** 'YYYY-MM-DD' de HOJE no fuso da clínica. Substitui o `hojeLocalStr()` que lia
 *  o relógio do servidor (sempre Brasília). */
function hojeNaEmpresa(fuso) {
  return diaNaEmpresa(new Date(), fuso);
}

/** 'DD/MM/AAAA' no fuso da clínica. */
function formatarDataNaEmpresa(data, fuso) {
  const p = partesNoFuso(data, fuso);
  return p ? `${p.dia}/${p.mes}/${p.ano}` : '';
}

/** 'HH:MM' no fuso da clínica. */
function formatarHoraNaEmpresa(data, fuso) {
  const p = partesNoFuso(data, fuso);
  return p ? `${p.hora}:${p.minuto}` : '';
}

/** 'DD/MM/AAAA HH:MM' no fuso da clínica. */
function formatarNaEmpresa(data, fuso) {
  const p = partesNoFuso(data, fuso);
  return p ? `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}` : '';
}

/**
 * Caminho INVERSO: "dia 24/08 às 08:00 NA CLÍNICA" → o instante (UTC) correspondente.
 *
 * É o que traduz a Hora Início digitada no formulário. `new Date(ano, mes, dia, h, m)`
 * usaria o fuso do SERVIDOR (America/Sao_Paulo, fixado em server.ts): para uma clínica
 * em Manaus, "08:00" viraria 08:00 de Brasília = 07:00 em Manaus — uma hora adiantada.
 *
 * Duas passadas: assume UTC, mede quanto esse chute se desloca quando lido no fuso
 * alvo, e desconta a diferença. É a técnica padrão para converter horário-de-parede →
 * instante sem biblioteca externa. O Brasil não tem horário de verão desde 2019; se
 * voltar a ter, o único caso ambíguo é a hora que se repete/some na virada.
 */
function instanteNoFuso(ano, mes, dia, hora, minuto, fuso) {
  const chute = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0);
  const p = partesNoFuso(new Date(chute), fuso);
  if (!p) return new Date(chute);
  const comoLido = Date.UTC(
    Number(p.ano), Number(p.mes) - 1, Number(p.dia), Number(p.hora), Number(p.minuto), 0, 0,
  );
  return new Date(chute - (comoLido - chute));
}

module.exports = {
  FUSO_PADRAO,
  FUSO_POR_UF,
  FUSOS_VALIDOS,
  fusoPorUf,
  fusoPorCep,
  fusoPorEndereco,
  rotuloFuso,
  normalizarFuso,
  lerFuso,
  salvarFuso,
  fusoDaEmpresa,
  invalidarCache,
  diaNaEmpresa,
  hojeNaEmpresa,
  instanteNoFuso,
  formatarDataNaEmpresa,
  formatarHoraNaEmpresa,
  formatarNaEmpresa,
};
