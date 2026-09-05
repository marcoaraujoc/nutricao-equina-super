// backend/scripts/testarEmail.js
// Testa o envio de e-mail DE VERDADE, com a configuração do .env — inclusive o
// anexo em PDF, que é o caminho novo (prescrição/exame/fatura enviados ao cliente).
//
//   node scripts/testarEmail.js destino@exemplo.com
//   node scripts/testarEmail.js destino@exemplo.com --sem-anexo
//
// POR QUE existe: trocar de provedor (Gmail -> Brevo -> Resend) falha em silêncio
// de várias formas — porta bloqueada pela VPS, login errado, remetente não
// verificado, TLS na porta errada. Descobrir isso pela tela significa um vet
// clicando "enviar" e nada acontecendo. Aqui o erro aparece inteiro, no terminal.
//
// ⚠️ ENVIA MENSAGEM DE VERDADE. Use um endereço seu.
'use strict';

require('dotenv').config();

const { getEmailProvider, remetente, remetenteEmail } = require('../src/messaging/emailProvider');

const out = (s) => process.stdout.write(`${s}\n`);

async function main() {
  const destino  = process.argv[2];
  const semAnexo = process.argv.includes('--sem-anexo');

  if (!destino || !destino.includes('@')) {
    out('Uso: node scripts/testarEmail.js destino@exemplo.com [--sem-anexo]');
    process.exitCode = 1;
    return;
  }

  const provider = getEmailProvider();
  const tipo     = process.env.EMAIL_PROVIDER || 'nodemailer';

  out('');
  out('  Configuração lida do .env');
  out(`   provider ...... ${tipo}`);
  if (tipo !== 'resend') {
    out(`   host .......... ${process.env.EMAIL_HOST || 'smtp.gmail.com (padrão)'}`);
    out(`   porta ......... ${process.env.EMAIL_PORT || '587 (padrão)'}`);
    out(`   secure ........ ${process.env.EMAIL_SECURE === 'true' ? 'true (TLS direto)' : 'false (STARTTLS)'}`);
    out(`   login (user) .. ${process.env.EMAIL_USER || '(vazio)'}`);
    out(`   senha ......... ${process.env.EMAIL_PASS ? '(definida)' : '(VAZIA)'}`);
  } else {
    out(`   RESEND_API_KEY  ${process.env.RESEND_API_KEY ? '(definida)' : '(VAZIA)'}`);
  }
  out(`   remetente ..... ${remetente()}`);
  out(`   destino ....... ${destino}`);
  out('');

  if (!provider.estaConfigurado()) {
    out('  ✗ Provider NÃO configurado — faltam credenciais no .env. Nada foi enviado.');
    process.exitCode = 1;
    return;
  }

  // ⚠️ Aviso, não erro: com o Gmail o login É o remetente e isso é legítimo. Com
  // Brevo/SES/Resend o login não é caixa de e-mail, e sair assim é o defeito que
  // `EMAIL_FROM` veio evitar.
  if (!process.env.EMAIL_FROM && /smtp-brevo|amazonses|mailgun|sendgrid/i.test(process.env.EMAIL_USER || '')) {
    out('  ⚠ EMAIL_FROM está vazio e o login parece ser de um relay (Brevo/SES/...).');
    out('    O e-mail vai sair assinado pelo LOGIN, que não é um endereço real.');
    out('');
  }

  const anexos = semAnexo ? undefined : [{
    filename: 'teste-s2vet.pdf',
    // PDF mínimo válido, escrito à mão — o ponto do teste é provar que o ANEXO
    // atravessa o provider, não gerar documento bonito. Puppeteer aqui só somaria
    // um motivo a mais de falha entre o clique e a resposta do SMTP.
    content: Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
      + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
      + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n'
      + 'trailer<</Root 1 0 R>>\n%%EOF\n',
      'utf8',
    ),
    contentType: 'application/pdf',
  }];

  const inicio = Date.now();
  try {
    const r = await provider.enviar({
      from:    remetente(),
      to:      destino,
      subject: 'S2Vet — teste de envio de e-mail',
      text:    'Se você recebeu esta mensagem, o envio de e-mail do S2Vet está funcionando.',
      html:    '<p>Se você recebeu esta mensagem, o envio de e-mail do S2Vet está funcionando.</p>'
             + (semAnexo ? '' : '<p>Um PDF de teste deve estar anexado.</p>'),
      attachments: anexos,
    });
    out(`  ✓ Enviado em ${Date.now() - inicio}ms${r.id ? ` — id ${r.id}` : ''}`);
    out(`    Confira a caixa de ${destino} (inclusive o SPAM: sem SPF/DKIM no`);
    out(`    domínio de ${remetenteEmail()}, é lá que a mensagem costuma cair).`);
  } catch (err) {
    out(`  ✗ FALHOU após ${Date.now() - inicio}ms`);
    out(`    ${err.message}`);
    // Os três erros que respondem por quase toda falha em VPS.
    if (/ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(err.message)) {
      out('');
      out('    Parece BLOQUEIO DE PORTA (o caso mais comum em VPS).');
      out(`    Teste:  nc -zv ${process.env.EMAIL_HOST || 'smtp.gmail.com'} ${process.env.EMAIL_PORT || 587}`);
      out('    Bloqueado? Peça liberação ao provedor, ou use EMAIL_PROVIDER=resend (HTTPS).');
    } else if (/Invalid login|535|authentication/i.test(err.message)) {
      out('');
      out('    Parece CREDENCIAL. No Brevo, EMAIL_USER é o login gerado em');
      out('    SMTP & API > SMTP (não o seu e-mail) e EMAIL_PASS é a SMTP key.');
      out('    No Gmail, EMAIL_PASS tem de ser uma "senha de app" (exige 2FA na conta).');
    } else if (/sender|from|not verified|domain/i.test(err.message)) {
      out('');
      out(`    Parece REMETENTE não verificado. Verifique ${remetenteEmail()} no painel`);
      out('    do provedor (SPF + DKIM no domínio).');
    }
    process.exitCode = 1;
  }
  out('');
}

main().catch(err => { out(`Erro inesperado: ${err.message}`); process.exitCode = 1; });
