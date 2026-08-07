// backend/src/lib/cronTenant.js
//
// FASE 7 DO MULTI-TENANCY — o padrão de execução dos crons.
//
// ════════════════════════════════════════════════════════════════════════════
// "GLOBAL" E "CROSS-TENANT" NÃO SÃO A MESMA COISA
// ════════════════════════════════════════════════════════════════════════════
//
// O fechamento de fatura é GLOBAL no agendamento (roda uma vez, para todo mundo) e
// POR EMPRESA na execução: cada fatura pertence a exatamente uma clínica. Ele nunca
// precisa ver as faturas de A e de B na MESMA consulta — precisa processar as de A,
// depois as de B.
//
// E o código já era assim, ao contrário: `fecharFaturasDoMes` varria TODAS as faturas
// e resolvia `resolverConfigsFechamento(...)` DENTRO do laço, uma vez por fatura. A
// regra de fechamento, o dia de vencimento e a validade do orçamento sempre foram por
// empresa. O que era global era só o laço.
//
// `paraCadaEmpresa` inverte isso: percorre as EMPRESAS e roda o trabalho dentro de cada
// uma, com o tenant carimbado. Não é trabalho a mais — é o mesmo, melhor organizado.
//
// ── O QUE SE GANHA ──────────────────────────────────────────────────────────
//  1. O RLS CONTINUA LIGADO. O cron recebe a mesma proteção de uma requisição de
//     usuário, em vez de ser a exceção que precisa de bypass. Sem isto, a fase 7c
//     (remover o escape) quebraria o fechamento de fatura na primeira noite.
//  2. ISOLAMENTO DE FALHA. Hoje uma exceção derruba o lote inteiro; aqui a clínica A
//     falhar não impede a B de fechar.
//  3. AUDITORIA CORRETA. Cada escrita acontece sob um tenant declarado, então o
//     registro nasce com o `empresa_id` certo — em vez do `null` que produziu as
//     órfãs apagadas na fase 7.
//  4. MENOS CONSULTAS, não mais: a configuração passa a ser resolvida uma vez por
//     EMPRESA, não uma vez por fatura.
//
// ⚠️ `tb_empresas` é CONTROL PLANE (sem RLS) — listar as clínicas para percorrê-las
// nunca precisou de privilégio especial. É por isso que o laço externo funciona sem
// nenhum bypass.
//
// ⚠️ NÃO existe "escopo de plataforma" para cron. Dos 10 jobs, 8 são por empresa e 2
// tocam apenas control plane/catálogo global (`crmv_sync`, `limpeza_desafios_2fa`) —
// tabelas que nem têm RLS. Nenhum precisa ler cross-tenant.
'use strict';

const { comTenant, usarClient } = require('./tenantDb');
const logger = require('./logger');

// Resolução PREGUIÇOSA do client, pelo mesmo motivo de `tenantDb.js`: `./prisma` é
// TypeScript e um `require` no topo quebra em teste/script rodando com node puro.
let _client = null;
function client() {
  // ⚠️ `prismaSemTenant`, NÃO o default. O default é o client ESTENDIDO (fase 7b), que
  // carimba o tenant sozinho — e aqui a transação e o `set_config` são gerenciados à
  // mão. Usar o estendido empilharia os dois mecanismos.
  if (!_client) _client = require('./prisma').prismaSemTenant;
  return _client;
}
/** Injeta o client (testes/scripts). Repassa para `tenantDb` — os dois precisam do MESMO. */
function usarClientCron(c) { _client = c; usarClient(c); }

/**
 * Empresas em que o cron deve trabalhar.
 *
 * ⚠️ SÓ as ATIVAS. Empresa SUSPENSA/CANCELADA não deve ter fatura fechada nem lembrete
 * disparado em nome dela (D3: a suspensão bloqueia o login de todos — seria incoerente
 * o robô seguir operando). `COALESCE` porque `status` nasceu na migration
 * 20260805120000 e a linha legada pode tê-lo nulo.
 */
async function empresasAtivas() {
  const rows = await client().$queryRawUnsafe(
    `SELECT id, nome FROM schs2vet.tb_empresas
      WHERE COALESCE(status, 'ATIVA') = 'ATIVA'
      ORDER BY id`);
  return rows;
}

/**
 * DIÁRIO DE EXECUÇÃO — o que foi feito, item a item.
 *
 * ⚠️ Contagem não basta. "3 faturas fechadas, 1 empresa com erro" não diz QUAL fatura
 * falhou nem QUAIS fecharam — e é exatamente isso que se precisa saber às 2h da manhã,
 * olhando a tela de Monitoração. O diário guarda cada item tratado e cada falha, com o
 * identificador do registro, e vira o `resumo` gravado em `CronExecucao.resumo` (TEXT).
 *
 * O log do Winston recebe as mesmas linhas na hora em que acontecem — o diário serve
 * para o RESUMO PERSISTIDO, que é o que sobrevive para consulta posterior.
 */
function novoDiario(rotulo) {
  const porEmpresa = new Map();   // empresaId → { nome, ok: [], erros: [] }

  const bucket = (empresa) => {
    const id = empresa?.id ?? 0;
    if (!porEmpresa.has(id)) porEmpresa.set(id, { nome: empresa?.nome ?? '—', ok: [], erros: [] });
    return porEmpresa.get(id);
  };

  return {
    /** Item tratado com sucesso. `desc` deve IDENTIFICAR o registro (ex.: 'fatura #63'). */
    ok(empresa, desc) {
      bucket(empresa).ok.push(desc);
      logger.info(`[${rotulo}] empresa ${empresa?.id}: ${desc}`);
    },
    /** Item que falhou — o restante da empresa segue. */
    erro(empresa, desc, err) {
      const msg = err?.message ?? String(err ?? '');
      bucket(empresa).erros.push(`${desc} — ${msg}`);
      logger.error(`[${rotulo}] empresa ${empresa?.id}: ${desc} — ${msg}`);
    },
    /** Falha que derrubou a EMPRESA inteira (rollback do lote dela). */
    erroDaEmpresa(empresa, err) {
      const msg = err?.message ?? String(err ?? '');
      const b = bucket(empresa);
      // O lote foi revertido: o que estava marcado como OK não vale mais.
      const revertidos = b.ok.length;
      b.ok = [];
      b.erros.push(`LOTE REVERTIDO (rollback) — ${msg}`
        + (revertidos ? ` · ${revertidos} item(ns) desfeito(s)` : ''));
      logger.error(`[${rotulo}] empresa ${empresa?.id} (${empresa?.nome}): lote revertido — ${msg}`);
    },
    get totalOk()   { return [...porEmpresa.values()].reduce((s, b) => s + b.ok.length, 0); },
    get totalErros(){ return [...porEmpresa.values()].reduce((s, b) => s + b.erros.length, 0); },

    /**
     * Texto para `CronExecucao.resumo`/`erro`, no formato que a tela de Monitoração
     * consome: **a PRIMEIRA LINHA é a contagem** (é só ela que aparece na lista, com
     * `truncate`), e o DETALHE vem abaixo — visível ao clicar na execução, onde o modal
     * renderiza tudo num `<pre whitespace-pre-wrap>`.
     *
     * O detalhe identifica cada registro (fatura, proprietário, item) e traz o ERRO
     * INTEIRO, seja de banco, de validação ou de rede: quem abre isso às 2h da manhã
     * precisa saber QUAL fatura falhou e POR QUÊ, não só que "houve 1 erro".
     */
    texto(empresasVarridas, unidade = 'item') {
      const blocos = [];
      for (const [id, b] of porEmpresa) {
        if (!b.ok.length && !b.erros.length) continue;   // empresa sem trabalho não polui
        const linhas = [`Empresa ${id} — ${b.nome}`];
        b.ok.forEach(d => linhas.push(`  ✓ ${d}`));
        b.erros.forEach(d => linhas.push(`  ✗ ${d}`));
        blocos.push(linhas.join('\n'));
      }
      const cabecalho = `${this.totalOk} ${unidade}(ns) com sucesso`
        + (this.totalErros ? ` · ${this.totalErros} com ERRO` : '')
        + ` — ${empresasVarridas} empresa(s) varrida(s)`;
      return blocos.length ? `${cabecalho}\n\n${blocos.join('\n\n')}` : cabecalho;
    },
  };
}

/**
 * Roda `fn(tx, empresa, diario)` UMA VEZ POR EMPRESA ATIVA, com o tenant carimbado.
 *
 * `fn` registra cada item em `diario.ok(...)` / `diario.erro(...)`. O retorno agregado
 * traz os totais, as falhas por empresa e o TEXTO detalhado para a Monitoração.
 *
 * @param {string} rotulo prefixo de log (ex.: 'FaturaFechamento-Cron')
 * @param {(tx, empresa, diario) => Promise<void>} fn
 */
async function paraCadaEmpresa(rotulo, fn) {
  const empresas = await empresasAtivas();
  const diario = novoDiario(rotulo);
  const falhas = [];

  for (const empresa of empresas) {
    try {
      // ⚠️ Uma transação POR EMPRESA, não uma para todas. Além de carimbar o tenant,
      // isso limita o alcance de um rollback: erro na clínica A não desfaz o que já
      // foi feito na B.
      await comTenant(empresa.id, (tx) => fn(tx, empresa, diario));
    } catch (err) {
      // Isolamento de falha: registra e SEGUE. Antes, uma exceção aqui matava o lote.
      // ⚠️ `erroDaEmpresa` LIMPA os "ok" já registrados desta empresa — eles foram
      // revertidos pelo rollback, e mantê-los no resumo seria mentir sobre o que
      // ficou gravado.
      falhas.push({ empresa: empresa.id, erro: err?.message ?? String(err) });
      diario.erroDaEmpresa(empresa, err);
    }
  }

  if (falhas.length) {
    logger.warn(`[${rotulo}] ${falhas.length} de ${empresas.length} empresa(s) falharam`);
  }
  return {
    total: diario.totalOk,
    empresas: empresas.length,
    falhas,
    diario,
    resumo: diario.texto(empresas.length),
  };
}

/**
 * Traduz o resultado de `paraCadaEmpresa*` para o contrato do `comAlerta`/`reportarCron`.
 *
 * ⚠️ Houve erro → `ok: false` **e o texto vai em `erro`, não em `resumo`**. Não é
 * detalhe de estilo: a tela de Monitoração pinta a linha de vermelho por `ok` e, no
 * modal, mostra `resumo` quando `ok` e `erro` quando não. Devolver `ok: true` com falhas
 * dentro daria uma linha VERDE para uma execução que falhou; devolver `ok: false` com o
 * texto em `resumo` deixaria o modal vazio ("Sem detalhes registrados").
 *
 * Nos dois casos o texto é o MESMO — cabeçalho com a contagem + detalhe por empresa.
 *
 * @param {string} unidade nome do que foi processado ('fatura', 'lembrete', 'prescrição')
 */
function resultadoCron(r, unidade = 'item') {
  const texto = r.diario ? r.diario.texto(r.empresas, unidade) : r.resumo;
  const houveErro = (r.diario?.totalErros ?? 0) > 0 || r.falhas.length > 0;
  return houveErro
    ? { ok: false, notificar: true, erro: texto }
    : { ok: true,  notificar: r.total > 0, resumo: texto };
}

/**
 * Variante para job que faz **I/O EXTERNO** (e-mail, WhatsApp, API de terceiro).
 *
 * 🔴 NÃO abre transação. Entrega só a empresa; o callback decide quando abrir uma
 * `comTenant` curta, em volta de CADA escrita.
 *
 * ⚠️ POR QUE ISSO PRECISA EXISTIR — foi um defeito introduzido e corrigido no mesmo dia:
 * envolver um cron de LEMBRETE numa transação por empresa quebra de duas formas.
 *
 *  1. **O ROLLBACK NÃO DESFAZ MENSAGEM ENVIADA.** O laço envia o WhatsApp e depois marca
 *     `lembreteWa1hEnviadoEm`. Se o 5º item falhar, os flags dos 4 primeiros voltam
 *     atrás — mas as mensagens saíram. Cinco minutos depois o cron reprocessa os mesmos
 *     agendamentos e o cliente recebe tudo de novo. Antes do padrão por empresa cada
 *     `update` commitava sozinho e isso não acontecia.
 *
 *  2. **Transação aberta durante chamada de rede.** Segura uma conexão do pool (e locks)
 *     pelo tempo somado de TODAS as chamadas ao provedor. Com o provedor lento, é a
 *     transação mais longa do sistema — e a mais inútil.
 *
 * Regra: transação envolve trabalho de BANCO. I/O externo fica FORA dela, sempre.
 */
async function paraCadaEmpresaComEnvio(rotulo, fn) {
  const empresas = await empresasAtivas();
  const diario = novoDiario(rotulo);
  const falhas = [];

  for (const empresa of empresas) {
    try {
      await fn(empresa, diario);
    } catch (err) {
      falhas.push({ empresa: empresa.id, erro: err?.message ?? String(err) });
      // ⚠️ Aqui NÃO se usa `erroDaEmpresa`: sem transação não houve rollback, então o
      // que já foi enviado e marcado CONTINUA valendo e deve permanecer no resumo.
      diario.erro(empresa, 'lote interrompido', err);
    }
  }

  if (falhas.length) {
    logger.warn(`[${rotulo}] ${falhas.length} de ${empresas.length} empresa(s) falharam`);
  }
  return { total: diario.totalOk, empresas: empresas.length, falhas, diario, resumo: diario.texto(empresas.length) };
}

module.exports = { paraCadaEmpresa, paraCadaEmpresaComEnvio, resultadoCron, empresasAtivas, usarClientCron };
