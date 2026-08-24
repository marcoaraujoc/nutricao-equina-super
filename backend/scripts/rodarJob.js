// backend/scripts/rodarJob.js
//
// Executa UMA tarefa agendada AGORA, pela linha de comando, imprimindo o rastro
// passo a passo — o `set -x` dos crons.
//
//   node -r ts-node/register/transpile-only scripts/rodarJob.js --list
//   node -r ts-node/register/transpile-only scripts/rodarJob.js fechamento_faturas
//
// (no Windows, com o npm script pronto:  npm run job -- fechamento_faturas)
//
// ════════════════════════════════════════════════════════════════════════════
// POR QUE ISTO PRECISA EXISTIR
// ════════════════════════════════════════════════════════════════════════════
//
// A Monitoração só grava execução quando há TRABALHO ou ERRO (`reportarCron`). Um job
// que roda, decide "hoje não é dia" e termina não deixa registro nenhum — e fica
// indistinguível de um job que nunca rodou porque o servidor estava fora do ar. Foi
// esse ponto cego que escondeu o fechamento de faturas quebrado: todo dia às 18:00 ele
// varria as 6 clínicas, lia a configuração VAZIA (o RLS a escondia), caía no fallback
// "último dia do mês" e não fechava nada, em silêncio.
//
// Aqui a decisão aparece: qual configuração foi lida, o que ela determinou para hoje e
// por que cada fatura fechou ou não.
//
// 🔴 RODA A TAREFA DE VERDADE — grava no banco, manda e-mail e WhatsApp, para TODAS as
// empresas ativas. Não existe modo simulação: o job é o mesmo objeto que o agendador
// dispara, e um "faz de conta" seria outro código, testando outra coisa.
'use strict';

require('dotenv').config();

// ⚠️ ANTES de importar o server: é esta variável que impede o `app.listen` e o
// `iniciarJobs()` (ver a guarda no fim de src/server.ts). Sem ela, o script tomaria a
// porta 3001 do backend em execução e ligaria todas as tarefas em segundo plano.
process.env.CRON_CLI = '1';

require('../src/server');   // é aqui que os registrarJob(...) acontecem
const cronManager = require('../src/lib/cronManager');

const argv  = process.argv.slice(2);
const chave = argv.find(a => !a.startsWith('-'));

// ⚠️ `console.log` NÃO serve aqui: `server.ts` redireciona o console para o Winston
// (logs estruturados, com carimbo de hora e cor), e o trace sairia picado no meio das
// linhas de log da aplicação. Escrever direto no stdout mantém o rastro legível.
const out = (s = '') => process.stdout.write(s + '\n');

function listar() {
  out('\nTarefas registradas (agenda REAL, lida de CronAgenda):\n');
  for (const j of cronManager.listarJobs()) {
    out(`  ${j.chave.padEnd(38)} ${j.ativo ? 'ativa    ' : 'DESLIGADA'} ${String(j.expr).padEnd(15)} ${j.nome}`);
  }
  out('\nUso: npm run job -- <chave>\n');
}

(async () => {
  // Carrega a agenda do BANCO sem agendar nada: o horário que interessa é o que está
  // valendo, não o padrão escrito no código.
  await cronManager.iniciarJobs({ agendar: false });

  if (!chave || argv.includes('--list') || argv.includes('-l')) { listar(); process.exit(0); }

  out(`\n═══ ${chave} — execução manual em ${new Date().toLocaleString('pt-BR')} ═══\n`);

  let r;
  try {
    r = await cronManager.executarAgora(chave);
  } catch (e) {
    out(`\n✗ ${e.message}`);
    if (e.code === 'JOB_DESCONHECIDO') listar();
    process.exit(1);
  }

  for (const linha of r.trace) out(linha);

  out('\n─── resultado ───');
  out(`agenda      : ${r.expr}${r.ativo ? '' : '  (DESLIGADA — só roda manualmente)'}`);
  out(`duração     : ${(r.duracaoMs / 1000).toFixed(3)}s`);
  // `comAlerta` engole o retorno do job (ele só reporta), então `resultado` é `undefined`
  // para a maioria — o que interessa está no trace acima e no `erro` abaixo.
  if (r.resultado !== undefined) out(`retorno     : ${JSON.stringify(r.resultado)}`);
  if (r.erro) {
    out(`\n✗ EXCEÇÃO:\n${r.erro}`);
    process.exit(1);
  }
  out('\n✓ concluído\n');
  process.exit(0);
})();
