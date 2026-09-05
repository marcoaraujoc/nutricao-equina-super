// backend/scripts/verificarEvolution.js
// "O Evolution subiu?" — responde sem depender da tela e sem tocar no banco.
//
//   npm run wa:verificar
//
// POR QUE existe: a tela de Configurações mostra UMA luz, e ela responde a uma
// pergunta composta ("o servidor está no ar E a sessão da clínica está pareada").
// Quando fica vermelha, não dá para saber QUAL das duas caiu. Aqui as duas são
// checadas em separado, na ordem em que uma depende da outra:
//
//   1. as variáveis de ambiente estão definidas?
//   2. o servidor responde? (é o "subiu ou não subiu")
//   3. as instâncias existem, e em que estado estão?
//
// ⚠️ Só LÊ — não conecta, não desconecta, não envia mensagem.
// ⚠️ Não consulta o banco de propósito: `tb_empresa_configuracoes` está sob RLS e,
// fora de um contexto de tenant, devolveria ZERO linha em silêncio (CLAUDE.md,
// sessão 2026-08-23 parte 4) — o script acusaria "não provisionado" com tudo certo.
// Para saber o que a APLICAÇÃO enxerga, use a tela; aqui é o lado do SERVIDOR.
'use strict';

require('dotenv').config();

const axios = require('axios');

const out = (s) => process.stdout.write(`${s}\n`);
const TIMEOUT_MS = Number(process.env.EVOLUTION_TIMEOUT_MS || 15000);

// Mesmo mapeamento de whatsappService.mapearEstado — o vocabulário da Evolution
// ('open'/'connecting'/'close') não é o da aplicação.
const ESTADO = {
  open:       'CONECTADO      (pronta para enviar)',
  connecting: 'AGUARDANDO QR  (pareamento em andamento)',
  close:      'DESCONECTADO   (sessão caiu — reconecte lendo o QR)',
};

async function main() {
  const url    = (process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
  const apikey = process.env.EVOLUTION_API_KEY || '';

  out('');
  out('  1) Configuração (.env)');
  out(`     EVOLUTION_URL ....... ${url || '(VAZIA)'}`);
  out(`     EVOLUTION_API_KEY ... ${apikey ? '(definida)' : '(VAZIA)'}`);
  out(`     WHATSAPP_PROVIDER ... ${process.env.WHATSAPP_PROVIDER || 'noop (envio SIMULADO — nada sai de verdade)'}`);

  if (!url || !apikey) {
    out('');
    out('  ✗ Sem URL ou API key: a aplicação nem tenta falar com a Evolution');
    out('    (EvolutionService.configurado() = false) e a tela mostra');
    out('    "Integração de WhatsApp não configurada no servidor".');
    process.exitCode = 1;
    return;
  }

  const http = axios.create({ baseURL: url, timeout: TIMEOUT_MS, headers: { apikey } });

  out('');
  out('  2) O servidor respondeu?');
  const inicio = Date.now();
  let instancias;
  try {
    // `fetchInstances` exige a apikey GLOBAL — serve de ping E de teste da chave
    // numa tacada só. Um GET na raiz responderia 200 mesmo com a chave errada.
    const res = await http.get('/instance/fetchInstances');
    instancias = Array.isArray(res.data) ? res.data : (res.data?.instances ?? []);
    out(`     ✓ SIM — ${Date.now() - inicio}ms`);
  } catch (err) {
    const status = err.response?.status;
    out(`     ✗ NÃO — ${Date.now() - inicio}ms`);
    out('');
    if (status === 401 || status === 403) {
      out('     A EVOLUTION ESTÁ NO AR, mas recusou a chave (HTTP ' + status + ').');
      out('     Confira EVOLUTION_API_KEY (é a apikey GLOBAL do servidor, definida');
      out('     na env do container da Evolution como AUTHENTICATION_API_KEY).');
    } else if (!status) {
      out(`     O servidor NÃO SUBIU, ou não é alcançável em ${url}.`);
      out(`     Erro de rede: ${err.code || err.message}`);
      out('');
      out('     Docker:  docker ps | grep evolution');
      out('              docker logs --tail 50 <container>');
      out('              docker compose up -d');
      out('     Em VPS, confira também se a porta está publicada e se o firewall a permite.');
    } else {
      out(`     Respondeu HTTP ${status} — no ar, mas com erro. Veja os logs do servidor.`);
    }
    out('');
    out('     Enquanto isso, a aplicação mostra "Serviço de WhatsApp fora do ar"');
    out('     e NÃO tenta enviar (nem gera o PDF à toa). Nenhuma configuração se perde:');
    out('     assim que o servidor voltar, a luz volta ao verde sozinha.');
    process.exitCode = 1;
    return;
  }

  out('');
  out('  3) Instâncias no servidor');
  if (instancias.length === 0) {
    out('     (nenhuma) — normal antes do primeiro "Conectar" em Configurações.');
    out('     A instância da clínica nasce ali, com o nome s2vet_e<empresa>[_q<equipe>].');
    out('');
    return;
  }
  for (const i of instancias) {
    const nome   = i.name ?? i.instanceName ?? i.instance?.instanceName ?? '(sem nome)';
    const estado = i.connectionStatus ?? i.connectionState ?? i.instance?.state ?? '(desconhecido)';
    const numero = i.number ?? i.ownerJid?.split('@')[0] ?? null;
    out(`     • ${nome}`);
    out(`         estado ..... ${ESTADO[estado] ?? estado}`);
    if (numero)       out(`         número ..... ${numero}`);
    if (i.profileName) out(`         perfil ..... ${i.profileName}`);
    // Só interessa quando a sessão NÃO está de pé — num "open" é lixo de histórico.
    if (estado !== 'open' && i.disconnectionAt) {
      out(`         caiu em .... ${new Date(i.disconnectionAt).toLocaleString('pt-BR')}`);
    }
  }
  out('');
  out('     A instância da clínica é s2vet_e<empresaId> (empresa com CNPJ) ou');
  out('     s2vet_e<empresaId>_q<equipeId> (empresa pessoal/CPF).');
  out('');
}

main().catch(err => { out(`Erro inesperado: ${err.message}`); process.exitCode = 1; });
