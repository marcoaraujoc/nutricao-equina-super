'use strict';

const nodemailer = require('nodemailer');

const createTransporter = () =>
  nodemailer.createTransport({
    host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
    port:   Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

const podeEnviar = () => !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const emailService = {

  // ── Código de verificação em duas etapas (2FA) ────────────────────────────
  // Falha de envio é PROPAGADA de propósito: sem o código não pode nascer sessão.
  async enviarCodigoMfa({ email, nome, codigo, validadeMin, ip }) {
    if (!podeEnviar()) {
      throw new Error('Envio de e-mail não configurado — não é possível concluir a verificação em duas etapas.');
    }

    const primeiroNome = String(nome ?? '').trim().split(' ')[0] || 'você';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `${codigo} é o seu código de acesso S2Vet`,
      text:    `Seu código de acesso S2Vet é ${codigo}. Ele expira em ${validadeMin} minutos. Se não foi você que tentou entrar, troque sua senha.`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#047857;padding:20px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;font-weight:700;">🐴 S2Vet — Verificação em duas etapas</h1>
          </div>
          <div style="background:#f9fafb;padding:28px 32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
              Olá, ${primeiroNome}. Use o código abaixo para concluir o acesso:
            </p>

            <div style="background:white;border:2px solid #047857;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
              <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#047857;font-family:monospace;">${codigo}</span>
            </div>

            <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 16px;">
              O código expira em <strong>${validadeMin} minutos</strong> e só pode ser usado uma vez.
            </p>

            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;">
              <p style="color:#991b1b;font-size:13px;line-height:1.6;margin:0;">
                <strong>Não foi você?</strong> Ignore este e-mail e troque sua senha imediatamente.
                Ninguém do S2Vet vai pedir este código por telefone, WhatsApp ou e-mail.
                ${ip ? `<br><span style="color:#b91c1c;font-size:12px;">Tentativa registrada a partir do IP ${ip}.</span>` : ''}
              </p>
            </div>
          </div>
        </div>
      `,
    });
  },

  // ── Alerta de execução de tarefa agendada (cron) para o ADMIN ─────────────
  async enviarAlertaCron({ para, nome, ok, resumo, erro, quando }) {
    if (!podeEnviar()) {
      console.warn('[emailService] Credenciais não configuradas — alerta de cron suprimido');
      return;
    }
    const destinatarios = Array.isArray(para) ? para.join(',') : para;
    const dataStr = new Date(quando ?? Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const cor    = ok ? '#059669' : '#dc2626';
    const status = ok ? '✅ Executado com sucesso' : '❌ Erro na execução';
    const corpo  = ok
      ? `<p style="color:#374151;line-height:1.6;margin:0;">${resumo ?? 'Tarefa concluída.'}</p>`
      : `<pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;color:#991b1b;white-space:pre-wrap;font-size:13px;margin:0;">${erro ?? 'Erro desconhecido.'}</pre>`;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      destinatarios,
      subject: `[S2Vet] Cron ${ok ? 'OK' : 'ERRO'} — ${nome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:${cor};padding:20px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;font-weight:700;">🐴 S2Vet — Tarefa Agendada</h1>
          </div>
          <div style="background:#f9fafb;padding:28px 32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Tarefa</p>
            <h2 style="color:#111827;margin:0 0 16px;font-size:18px;">${nome}</h2>
            <p style="font-weight:700;color:${cor};margin:0 0 16px;">${status}</p>
            ${corpo}
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
              Execução em <strong>${dataStr}</strong> (Brasília). Alerta automático do agendador do S2Vet.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Alerta de cron "${nome}" (${ok ? 'OK' : 'ERRO'}) enviado → ${destinatarios}`);
  },

  // ── CRMV não encontrado no índice do CFMV (Cadastro Pessoal) ──────────────
  // O cadastro NUNCA é bloqueado por isso (ver nota em crmvService.js) — este
  // e-mail é a única consequência visível de um CRMV que o índice raspado não
  // confirmou, pra o ADMIN decidir (erro de digitação × buraco de cobertura da
  // raspagem × tentativa de fraude), sem travar o profissional na hora do cadastro.
  async enviarCrmvNaoEncontrado({ para, nome, telefone, tipoUsuario, crmv }) {
    if (!podeEnviar()) {
      console.warn('[emailService] Credenciais não configuradas — alerta de CRMV não encontrado suprimido');
      return;
    }
    const destinatarios = Array.isArray(para) ? para.join(',') : para;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      destinatarios,
      subject: `[S2Vet] CRMV não encontrado no CFMV — ${nome ?? 'cadastro'}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#dc2626;padding:20px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;font-weight:700;">🐴 S2Vet — CRMV não encontrado</h1>
          </div>
          <div style="background:#f9fafb;padding:28px 32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
              O CRMV abaixo não bateu com o índice local (raspado do CFMV) no cadastro
              deste profissional. <strong>O acesso foi liberado normalmente</strong> —
              o índice é uma cópia incompleta por natureza, então isto pode ser tanto
              um número digitado errado quanto um profissional legítimo que a
              raspagem ainda não alcançou.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Nome</td><td style="padding:6px 0;color:#111827;font-weight:600;">${nome ?? '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">Telefone</td><td style="padding:6px 0;color:#111827;">${telefone ?? '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">Tipo de usuário</td><td style="padding:6px 0;color:#111827;">${tipoUsuario ?? '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">CRMV informado</td><td style="padding:6px 0;color:#dc2626;font-weight:700;">${crmv ?? '—'}</td></tr>
            </table>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
              Alerta automático da verificação de CRMV do S2Vet — o profissional não foi
              informado deste resultado.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Alerta de CRMV não encontrado (${crmv}) enviado → ${destinatarios}`);
  },

  // ⚠️ FASE 3 DO MULTI-TENANCY — 8 TEMPLATES DE VÍNCULO REMOVIDOS:
  //   enviarSolicitacaoVinculo / enviarSolicitacaoVinculoProprietario
  //   enviarConfirmacaoVinculo
  //   enviarSolicitacaoDesvinculo / enviarSolicitacaoDesvinculoProprietario
  //   enviarSolicitacaoTrocaVet
  //   enviarNotificacaoProprietario / enviarNotificacaoTrocaVet
  // Montavam links /#/veterinarios/solicitacoes/aprovar?token=... para aceitar ou
  // recusar acesso a paciente. Não há mais o que aprovar: o acesso vem da EMPRESA.
  // CONTINUAM existindo, porque NÃO são aprovação: enviarVinculoInformativo (avisa o
  // cliente de que a clínica cadastrou o animal dele) e enviarBoasVindasProprietario.


  // ── Cadastro de animal com notificação ao proprietário ───────────────────────
  // isNewUser=true → exibe bloco de credenciais (conta criada agora)
  // isNewUser=false → email informativo para conta já existente
  async enviarVinculoInformativo({ proprietarioEmail, proprietarioNome, animalNome, vetNome, isNewUser = false, senhaInicial = null }) {
    if (!podeEnviar()) return;

    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const loginUrl = `${appUrl}/#/login`;

    const blocoCredenciais = isNewUser && senhaInicial ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px 24px;margin:24px 0;">
        <p style="margin:0 0 14px;font-weight:700;color:#166534;font-size:15px;">🔐 Seus dados de acesso</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr>
            <td style="padding:6px 0;color:#374151;width:60px;font-weight:500;">E-mail</td>
            <td style="padding:6px 0;color:#111827;font-weight:600;">${proprietarioEmail}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#374151;font-weight:500;">Senha</td>
            <td style="padding:6px 0;">
              <code style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:4px;
                           font-size:14px;font-weight:700;letter-spacing:0.5px;">${senhaInicial}</code>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font-size:13px;color:#dc2626;font-weight:500;">
          ⚠️ Por segurança, você deverá alterar sua senha no primeiro acesso.
        </p>
      </div>
    ` : '';

    const assuntoEmail = isNewUser
      ? `[S2Vet] Sua conta foi criada — ${animalNome} cadastrado`
      : `[S2Vet] ${animalNome} foi cadastrado em sua conta`;

    const corpoPrincipal = isNewUser
      ? `Sua conta no S2Vet foi criada por <strong>${vetNome}</strong>. A partir de agora você
         poderá acompanhar faturas, dietas e evoluções clínicas dos seus animais de forma automática.`
      : `Dr(a). <strong>${vetNome}</strong> cadastrou o animal <strong>${animalNome}</strong>
         no S2Vet. A partir de agora você poderá acompanhar faturas, dietas e evoluções clínicas
         deste animal na plataforma.`;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      proprietarioEmail,
      subject: assuntoEmail,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;font-size:16px;line-height:1.6;margin-top:0;">
              Olá, <strong>${proprietarioNome}</strong>!
            </p>
            <p style="color:#374151;line-height:1.6;">${corpoPrincipal}</p>
            ${blocoCredenciais}
            <div style="background:white;border:1px solid #d1fae5;border-radius:10px;padding:16px 20px;margin:20px 0;">
              <p style="margin:0;font-size:13px;color:#6b7280;">🐾 Animal cadastrado</p>
              <p style="margin:4px 0 0;font-size:17px;font-weight:700;color:#065f46;">${animalNome}</p>
            </div>
            <div style="margin-top:24px;text-align:center;">
              <a href="${loginUrl}"
                 style="background:#059669;color:white;padding:12px 28px;border-radius:8px;
                        text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
                Acessar o S2Vet →
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
              Se não reconhece esta ação, entre em contato com o suporte.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Notificação informativa enviada → ${proprietarioEmail}`);
  },

  // ── Convite de equipe ─────────────────────────────────────────────────────
  async enviarConviteEquipe({ email, cargo, token, vetNome, equipeNome, usuarioCriado = false, senhaInicial = null, especiesNomes = [] }) {
    if (!podeEnviar()) return;

    const appUrl     = process.env.APP_URL || 'http://localhost:5173';
    const loginUrl   = `${appUrl}/#/login`;
    const conviteUrl = `${appUrl}/#/equipe/convite/${token}`;

    const blocoCredenciais = usuarioCriado ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#92400e;">🔐 Credenciais de acesso criadas para você</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;width:80px;">E-mail</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${email}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;">Senha</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${senhaInicial}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:11px;color:#92400e;">⚠️ Você precisa alterar a senha no primeiro acesso.</p>
      </div>
    ` : '';

    const blocoEspecies = especiesNomes.length > 0
      ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:14px 20px;margin:16px 0;">
           <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#065f46;">🐾 Espécies atendidas pela equipe</p>
           <p style="margin:0;font-size:13px;color:#374151;">A equipe <strong>${equipeNome}</strong> atende somente as espécies <strong>${especiesNomes.join(', ')}</strong></p>
         </div>`
      : '';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `[S2Vet] Você foi convidado para a equipe — ${equipeNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Convite para a equipe ${equipeNome}</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá! Dr(a). <strong>${vetNome}</strong> convidou você para fazer parte da equipe
              <strong>${equipeNome}</strong> no S2Vet como <strong>${cargo}</strong>.
            </p>

            ${blocoCredenciais}

            ${blocoEspecies}

            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#166534;">📋 Como aceitar o convite</p>
              <ol style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:2.2;">
                <li>Acesse a plataforma: <a href="${loginUrl}" style="color:#059669;font-weight:600;">${loginUrl}</a></li>
                <li>Faça login com o e-mail e senha informados acima</li>
                <li>Defina uma nova senha quando solicitado</li>
              </ol>
              <p style="margin:14px 0 0;font-size:13px;color:#374151;text-align:center;"><strong>Ou</strong></p>
              <p style="margin:6px 0 0;font-size:12px;color:#6b7280;text-align:center;">Clique no botão abaixo para aceitar o convite</p>
            </div>
            <div style="text-align:center;margin:28px 0 20px;">
              <a href="${conviteUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                ✅ Aceitar convite
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Convite válido por <strong>24 horas</strong>. Se não reconhece este convite, ignore este e-mail.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Convite de equipe enviado → ${email} (usuarioCriado=${usuarioCriado})`);
  },

  // ── Convite ADMIN — Gestor fundador, cria sua própria organização ─────────────
  async enviarConviteAdmin({ email, token, usuarioCriado = false, senhaInicial = null }) {
    if (!podeEnviar()) return;

    const appUrl     = process.env.APP_URL || 'http://localhost:5173';
    const loginUrl   = `${appUrl}/#/login`;
    const conviteUrl = `${appUrl}/#/equipe/convite/${token}`;

    const blocoCredenciais = usuarioCriado ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#92400e;">🔐 Credenciais de acesso criadas para você</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;width:80px;">E-mail</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${email}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;">Senha</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${senhaInicial}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:11px;color:#92400e;">⚠️ Você será obrigado a criar uma nova senha no primeiro acesso.</p>
      </div>
    ` : '';

    const blocoGoogle = `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 20px;margin:16px 0;">
        <p style="margin:0;font-size:13px;color:#1e40af;">
          💡 <strong>Tem conta Google?</strong> Você também pode acessar diretamente com o seu e-mail
          <strong>${email}</strong> pelo botão "Entrar com Google" na tela de login.
        </p>
      </div>
    `;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `[S2Vet] Você foi convidado para acessar a plataforma`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Você foi convidado para o S2Vet!</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá! Você foi convidado para acessar o <strong>S2Vet</strong> e criar a sua organização na plataforma.
              Como gestor, você terá acesso completo para configurar sua equipe, cadastrar animais e gerenciar todo o fluxo clínico.
            </p>

            ${blocoCredenciais}
            ${blocoGoogle}

            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#166534;">📋 Como começar</p>
              <ol style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:2.2;">
                <li>Acesse a plataforma: <a href="${loginUrl}" style="color:#059669;font-weight:600;">${loginUrl}</a></li>
                <li>Faça login com e-mail/senha ou com o Google</li>
                ${usuarioCriado ? '<li>Crie uma nova senha quando solicitado</li>' : ''}
                <li>Aceite o convite e configure sua organização</li>
              </ol>
              <p style="margin:14px 0 6px;font-size:13px;color:#374151;text-align:center;"><strong>Ou acesse diretamente pelo link:</strong></p>
            </div>

            <div style="text-align:center;margin:28px 0 20px;">
              <a href="${conviteUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                ✅ Acessar o S2Vet
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Link válido por <strong>24 horas</strong>. Se não reconhece este convite, ignore este e-mail.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Convite ADMIN enviado → ${email}`);
  },

  // ── Acesso de Gestor criado diretamente pelo ADMIN (sem convite, acesso imediato) ──
  async enviarAcessoGestor({ email, nomeGestor, empresaNome, equipeName, usuarioCriado = false, senhaInicial = null }) {
    if (!podeEnviar()) return;

    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const loginUrl = `${appUrl}/#/login`;

    const blocoCredenciais = usuarioCriado ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#92400e;">🔐 Seus dados de acesso</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;width:80px;">E-mail</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${email}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;">Senha</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${senhaInicial}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:11px;color:#92400e;">⚠️ Você será obrigado a criar uma nova senha no primeiro acesso.</p>
      </div>
    ` : '';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `[S2Vet] Seu acesso de Gestor está pronto`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Olá, ${nomeGestor}!</h2>
            <p style="color:#374151;line-height:1.6;">
              Seu acesso ao <strong>S2Vet</strong> foi configurado com o perfil de <strong>Gestor</strong>
              na organização <strong>${empresaNome}</strong> (equipe: ${equipeName}).
              Você já pode fazer login e gerenciar sua equipe imediatamente.
            </p>

            ${blocoCredenciais}

            <div style="text-align:center;margin:28px 0 20px;">
              <a href="${loginUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                Acessar o S2Vet
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Este é um e-mail informativo. Não é necessária nenhuma ação adicional para ativar o acesso.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] E-mail de acesso gestor enviado → ${email}`);
  },


  // ── Boas-vindas ao proprietário recém-cadastrado ─────────────────────────────
  async enviarBoasVindasProprietario({ destinatarioEmail, destinatarioNome, criadoPorNome, senhaInicial }) {
    if (!podeEnviar()) {
      console.warn('[emailService] Credenciais não configuradas — e-mail de boas-vindas suprimido');
      return;
    }
    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const loginUrl = `${appUrl}/#/login`;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      destinatarioEmail,
      subject: '[S2Vet] Sua conta foi criada — bem-vindo(a)!',
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Olá, ${destinatarioNome}!</h2>
            <p style="color:#374151;line-height:1.6;">
              Sua conta no S2Vet foi criada por <strong>${criadoPorNome}</strong>.
              A partir de agora você poderá acompanhar faturas, dietas e evoluções clínicas
              dos seus animais de forma automática.
            </p>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin:20px 0;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#92400e;">🔐 Seus dados de acesso</p>
              <table style="border-collapse:collapse;width:100%;">
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#78350f;width:80px;">E-mail</td>
                  <td style="font-size:13px;font-weight:600;color:#111;">${destinatarioEmail}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#78350f;">Senha</td>
                  <td style="font-size:13px;font-weight:600;color:#111;">${senhaInicial}</td>
                </tr>
              </table>
            </div>
            <p style="color:#374151;font-size:13px;line-height:1.6;">
              ⚠️ Por segurança, você deverá <strong>alterar sua senha no primeiro acesso</strong>.
            </p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${loginUrl}"
                style="display:inline-block;background:#059669;color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;">
                Acessar o S2Vet
              </a>
            </div>
            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Se não reconhece esta conta, entre em contato com seu veterinário responsável.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Boas-vindas proprietário → ${destinatarioEmail}`);
  },

  // ── Envio de plano de dieta com PDF anexado ───────────────────────────────
  async enviarDieta({ emailDestinatario, nomeProprietario, nomeAnimal, planoNome, pdfBase64 }) {
    if (!podeEnviar()) {
      console.warn('[emailService] Credenciais não configuradas — e-mail de dieta suprimido');
      return;
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      emailDestinatario,
      subject: `[S2Vet] Plano de Dieta — ${nomeAnimal}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Plano de Dieta</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${nomeProprietario}</strong>.
            </p>
            <p style="color:#374151;line-height:1.6;">
              Segue o Plano de Dieta <strong>"${planoNome}"</strong> do animal <strong>${nomeAnimal}</strong>.
            </p>
            <p style="color:#374151;line-height:1.6;">
              O documento em PDF está em anexo neste e-mail.
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">
              Gerado pelo S2Vet — Sistema Hospitalar Veterinário
            </p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename:    `dieta-${nomeAnimal}-${planoNome}.pdf`,
          content:     pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
  },

  // ── Envio GENÉRICO de documento com PDF anexado ───────────────────────────
  // Componente reutilizável: qualquer módulo que precise mandar um PDF por e-mail
  // (laudo, orçamento, fatura…) usa daqui — mesmo espírito do
  // documentoWhatsappService.js do lado do WhatsApp. Falha "não configurado" é
  // PROPAGADA com `.code` para o controller decidir o fallback manual (o e-mail
  // de dieta engolia isso em silêncio, o que não dá para fazer aqui: o chamador
  // precisa saber que nada foi enviado).
  async enviarDocumento({ emailDestinatario, assunto, corpo, nomeArquivo, pdfBase64 }) {
    if (!podeEnviar()) {
      const err = new Error('Envio de e-mail não configurado (EMAIL_USER/EMAIL_PASS ausentes).');
      err.code = 'EMAIL_NAO_CONFIGURADO';
      throw err;
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      emailDestinatario,
      subject: assunto,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;line-height:1.6;white-space:pre-line;">${corpo}</p>
            <p style="color:#374151;line-height:1.6;">O documento em PDF está em anexo neste e-mail.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">Gerado pelo S2Vet — Sistema Hospitalar Veterinário</p>
          </div>
        </div>
      `,
      attachments: [
        { filename: nomeArquivo, content: pdfBuffer, contentType: 'application/pdf' },
      ],
    });
  },

  // ── Inclusão direta de membro na equipe (sem fluxo de aceite) ────────────────
  async enviarInclusaoEquipe({ email, cargo, vetNome, equipeNome, usuarioCriado = false, senhaInicial = null, especiesNomes = [] }) {
    if (!podeEnviar()) return;

    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const loginUrl = `${appUrl}/#/login`;

    const blocoCredenciais = usuarioCriado ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#92400e;">🔐 Credenciais de acesso criadas para você</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;width:80px;">E-mail</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${email}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#78350f;">Senha</td>
            <td style="font-size:13px;font-weight:600;color:#111;">${senhaInicial}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:11px;color:#92400e;">⚠️ Você precisa alterar a senha no primeiro acesso.</p>
      </div>
    ` : '';

    const blocoEspecies = especiesNomes.length > 0
      ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:14px 20px;margin:16px 0;">
           <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#065f46;">🐾 Espécies atendidas pela equipe</p>
           <p style="margin:0;font-size:13px;color:#374151;">A equipe <strong>${equipeNome}</strong> atende somente as espécies <strong>${especiesNomes.join(', ')}</strong></p>
         </div>`
      : '';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `[S2Vet] Você foi adicionado à equipe — ${equipeNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Você foi adicionado à equipe ${equipeNome}</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá! <strong>${vetNome}</strong> adicionou você à equipe
              <strong>${equipeNome}</strong> no S2Vet como <strong>${cargo}</strong>.
              Você já pode acessar a plataforma.
            </p>

            ${blocoCredenciais}

            ${blocoEspecies}

            <div style="text-align:center;margin:28px 0 20px;">
              <a href="${loginUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                Acessar S2Vet
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Se não reconhece este e-mail, entre em contato com o suporte.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Inclusão de equipe notificada → ${email} (usuarioCriado=${usuarioCriado})`);
  },

  // ── Notificação de novo agendamento ao profissional ───────────────────────
  async enviarNotificacaoAgendamentoProfissional({ vetEmail, vetNome, animalNome, proprietarioNome, proprietarioPhone, dataHora, tipo }) {
    if (!podeEnviar()) return;
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const d      = new Date(dataHora);
    const dataFmt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const horaFmt = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const tipoLabel = { CONSULTA: 'Consulta', VACINA: 'Vacina', RETORNO: 'Retorno', EXAME: 'Exame', PROCEDIMENTO: 'Procedimento' }[tipo] ?? tipo;

    const waLink = proprietarioPhone
      ? `https://wa.me/55${proprietarioPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Confirmo meu agendamento com você no dia ${dataFmt} às ${horaFmt} para ${animalNome}.`)}`
      : null;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      vetEmail,
      subject: `[S2Vet] Novo agendamento — ${animalNome} · ${horaFmt}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">📅 Novo agendamento confirmado</h2>
            <p style="color:#374151;">Olá, <strong>${vetNome}</strong>! Um novo agendamento foi registrado para você.</p>

            <div style="background:white;border:2px solid #a7f3d0;border-radius:12px;padding:20px;margin:24px 0;">
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">📋 Tipo</td><td style="font-weight:700;color:#111827;">${tipoLabel}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">📅 Data</td><td style="font-weight:700;color:#111827;">${dataFmt}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">🕐 Horário</td><td style="font-weight:700;color:#111827;font-size:18px;">${horaFmt}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">🐎 Paciente</td><td style="font-weight:700;color:#111827;">${animalNome}</td></tr>
                ${proprietarioNome ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">👤 Proprietário</td><td style="font-weight:700;color:#111827;">${proprietarioNome}</td></tr>` : ''}
                ${proprietarioPhone ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">📱 Telefone</td><td style="font-weight:700;color:#111827;">${proprietarioPhone}</td></tr>` : ''}
              </table>
            </div>

            ${waLink ? `
            <div style="text-align:center;margin:20px 0;">
              <a href="${waLink}" style="background:#25d366;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                💬 Contatar via WhatsApp
              </a>
            </div>` : ''}

            <div style="text-align:center;margin:20px 0;">
              <a href="${appUrl}" style="background:#059669;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                Ver agenda no S2Vet
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Agendamento registrado via S2Vet Portal de Agendamentos.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Notificação de agendamento → ${vetEmail}`);
  },

  // ── Transferência de agenda/consulta para outro profissional ──────────────
  // `itens` = [{ dataHora, animalNome, tipo }] — 1 item (consulta avulsa) ou vários
  // (agenda do dia inteiro). Quem recebe a transferência é notificado aqui e por WhatsApp.
  // `modo`: 'RECEBIDO' (o destinatário ganhou os atendimentos) | 'ASSUMIDO' (o
  // destinatário PERDEU o atendimento, que `deNome` assumiu para si).
  async enviarTransferenciaAgenda({ paraEmail, paraNome, deNome, itens = [], observacao, modo = 'RECEBIDO' }) {
    if (!podeEnviar() || !paraEmail || itens.length === 0) return;
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const fmtData = (dh) => new Date(dh).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const fmtHora = (dh) => new Date(dh).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const rotulo  = (t) => ({ CONSULTA: 'Consulta', VACINA: 'Vacina', RETORNO: 'Retorno', EXAME: 'Exame', PROCEDIMENTO: 'Procedimento' }[t] ?? t ?? 'Atendimento');

    const varios   = itens.length > 1;
    const assumido = modo === 'ASSUMIDO';
    const assunto  = assumido
      ? `[S2Vet] Atendimento assumido por outro profissional — ${itens[0].animalNome ?? 'Paciente'} · ${fmtHora(itens[0].dataHora)}`
      : varios
        ? `[S2Vet] ${itens.length} atendimentos transferidos para você — ${fmtData(itens[0].dataHora)}`
        : `[S2Vet] Atendimento transferido para você — ${itens[0].animalNome ?? 'Paciente'} · ${fmtHora(itens[0].dataHora)}`;

    const linhas = itens.map(i => `
      <tr>
        <td style="padding:8px 0;color:#111827;font-weight:700;">${fmtHora(i.dataHora)}</td>
        <td style="padding:8px 0;color:#374151;">${i.animalNome ?? 'Paciente'}</td>
        <td style="padding:8px 0;color:#6b7280;font-size:13px;">${rotulo(i.tipo)}</td>
      </tr>`).join('');

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      paraEmail,
      subject: assunto,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">
              ${assumido ? '🙋 Atendimento assumido por outro profissional' : `🔄 ${varios ? 'Agenda transferida' : 'Atendimento transferido'} para você`}
            </h2>
            <p style="color:#374151;">
              Olá, <strong>${paraNome ?? 'profissional'}</strong>!
              ${assumido
                ? `${deNome ? `<strong>${deNome}</strong> assumiu` : 'Outro profissional assumiu'} o atendimento abaixo, que saiu da sua agenda.`
                : `${deNome ? `<strong>${deNome}</strong> transferiu` : 'Foi transferido'} ${varios ? `<strong>${itens.length} atendimentos</strong>` : 'um atendimento'} para a sua agenda.`}
            </p>

            <div style="background:white;border:2px solid #a7f3d0;border-radius:12px;padding:20px;margin:24px 0;">
              <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">📅 ${fmtData(itens[0].dataHora)}</p>
              <table style="width:100%;border-collapse:collapse;">${linhas}</table>
            </div>

            ${observacao ? `<p style="color:#374151;font-size:13px;">📝 ${observacao}</p>` : ''}

            <div style="text-align:center;margin:20px 0;">
              <a href="${appUrl}" style="background:#059669;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                Ver minha agenda
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Transferência registrada no S2Vet.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Transferência de agenda → ${paraEmail} (${itens.length} item(ns))`);
  },

  // ── Evolução clínica: assumida por outro profissional / aberta em paralelo ──
  // Mesma comunicação da transferência de agenda, na superfície do atendimento.
  // `modo`:
  //   'ASSUMIDA' → o destinatário PERDEU a evolução: `deNome` assumiu a condução.
  //   'PARALELA' → a evolução do destinatário CONTINUA com ele, mas `deNome` abriu
  //                uma NOVA evolução para o mesmo paciente (atendimento simultâneo).
  async enviarTransferenciaEvolucao({
    paraEmail, paraNome, deNome, animalNome, atendimentoNumero,
    titulo, especialidade, dataInicio, modo = 'ASSUMIDA',
  }) {
    if (!podeEnviar() || !paraEmail) return;
    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const assumida = modo === 'ASSUMIDA';
    const paciente = animalNome ?? 'Paciente';
    const quando   = dataInicio
      ? new Date(dataInicio).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
        })
      : null;

    const assunto = assumida
      ? `[S2Vet] Evolução assumida por outro profissional — ${paciente}`
      : `[S2Vet] Nova evolução aberta em paralelo — ${paciente}`;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      paraEmail,
      subject: assunto,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">
              ${assumida ? '🙋 Evolução assumida por outro profissional' : '👥 Nova evolução aberta em paralelo'}
            </h2>
            <p style="color:#374151;">
              Olá, <strong>${paraNome ?? 'profissional'}</strong>!
              ${assumida
                ? `${deNome ? `<strong>${deNome}</strong> assumiu` : 'Outro profissional assumiu'} a condução da evolução clínica abaixo. Você não é mais o responsável por ela.`
                : `${deNome ? `<strong>${deNome}</strong> abriu` : 'Outro profissional abriu'} uma NOVA evolução para este paciente. A evolução abaixo continua sob sua responsabilidade.`}
            </p>

            <div style="background:white;border:2px solid #a7f3d0;border-radius:12px;padding:20px;margin:24px 0;">
              <p style="margin:0;color:#111827;font-weight:700;font-size:15px;">${paciente}</p>
              ${atendimentoNumero ? `<p style="margin:6px 0 0;color:#059669;font-weight:700;font-size:13px;">${atendimentoNumero}</p>` : ''}
              ${titulo ? `<p style="margin:6px 0 0;color:#374151;font-size:13px;">📝 ${titulo}</p>` : ''}
              ${especialidade ? `<p style="margin:6px 0 0;color:#6b7280;font-size:13px;">🩺 ${especialidade}</p>` : ''}
              ${quando ? `<p style="margin:6px 0 0;color:#6b7280;font-size:13px;">📅 Iniciada em ${quando}</p>` : ''}
            </div>

            <div style="text-align:center;margin:20px 0;">
              <a href="${appUrl}" style="background:#059669;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                Abrir o S2Vet
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              ${assumida ? 'Transferência de responsabilidade registrada no S2Vet.' : 'Atendimento simultâneo registrado no S2Vet.'}
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Evolução (${modo}) → ${paraEmail}`);
  },

  // ── Lembrete 1 dia antes ao proprietário ──────────────────────────────────
  async enviarLembreteDiaAnteriorProprietario({ proprietarioEmail, proprietarioNome, animalNome, vetNome, vetPhone, dataHora, appUrl: appUrlParam }) {
    if (!podeEnviar()) return;
    const appUrl = appUrlParam || process.env.APP_URL || 'http://localhost:5173';
    const d      = new Date(dataHora);
    const dataFmt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const horaFmt = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    const waClinica = vetPhone
      ? `https://wa.me/55${vetPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Referente ao agendamento de ${animalNome} amanhã às ${horaFmt}.`)}`
      : null;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      proprietarioEmail,
      subject: `[S2Vet] Lembrete: consulta de ${animalNome} amanhã às ${horaFmt}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Lembrete de Consulta</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">⏰ Consulta amanhã!</h2>
            <p style="color:#374151;">Olá, <strong>${proprietarioNome}</strong>! Este é um lembrete do agendamento de amanhã.</p>

            <div style="background:white;border:2px solid #fcd34d;border-radius:12px;padding:20px;margin:24px 0;">
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px;">🐎 Paciente</td><td style="font-weight:700;color:#111827;">${animalNome}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">🩺 Veterinário</td><td style="font-weight:700;color:#111827;">${vetNome}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">📅 Data</td><td style="font-weight:700;color:#111827;">${dataFmt}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">🕐 Horário</td><td style="font-weight:700;color:#111827;font-size:18px;">${horaFmt}</td></tr>
              </table>
            </div>

            <p style="color:#374151;font-size:14px;">Por favor, confirme sua presença ou entre em contato em caso de imprevisto.</p>

            ${waClinica ? `
            <div style="text-align:center;margin:20px 0;">
              <a href="${waClinica}" style="background:#25d366;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                💬 Entrar em contato via WhatsApp
              </a>
            </div>` : ''}

            <div style="text-align:center;margin:16px 0;">
              <a href="${appUrl}" style="background:#059669;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                Ver no S2Vet
              </a>
            </div>

            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              S2Vet — Sistema Hospitalar Veterinário. Não responda este email.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Lembrete D-1 → ${proprietarioEmail}`);
  },
};

module.exports = emailService;
