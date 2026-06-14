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

  // ── Solicitação de vínculo para o VET (proprietário indicou um vet) ───────
  async enviarSolicitacaoVinculo({ vetEmail, vetNome, animalNome, proprietarioNome, token }) {
    if (!podeEnviar()) {
      console.warn('[emailService] Credenciais não configuradas — email suprimido');
      return;
    }

    const appUrl      = process.env.APP_URL || 'http://localhost:5173';
    const approvalUrl = `${appUrl}/#/veterinarios/solicitacoes/aprovar?token=${token}&acao=aceitar`;
    const rejectUrl   = `${appUrl}/#/veterinarios/solicitacoes/aprovar?token=${token}&acao=recusar`;


    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      vetEmail,
      subject: `[S2Vet] Solicitação de vínculo — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Solicitação de vínculo</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${vetNome}</strong>.<br/>
              O(a) proprietário(a) <strong>${proprietarioNome}</strong> solicitou que você
              seja o veterinário responsável por:
            </p>
            <div style="background:white;border:2px solid #a7f3d0;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
              <div style="font-size:40px;">🐎</div>
              <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#065f46;">${animalNome}</p>
              <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">Aguardando seu aceite</p>
            </div>
            <div style="margin:32px 0;text-align:center;">
              <a href="${approvalUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin-right:12px;">
                ✅ Aceitar vínculo
              </a>
              <a href="${rejectUrl}"
                 style="background:white;color:#dc2626;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;
                        border:2px solid #dc2626;">
                ✕ Recusar
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
              Link válido por <strong>7 dias</strong>. Você também pode responder em
              <a href="${appUrl}" style="color:#059669;">${appUrl}</a>.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Solicitação de vínculo enviada → ${vetEmail}`);
  },

  // ── Solicitação ao PROPRIETÁRIO (vet cadastrou animal e pede autorização) ─
  async enviarSolicitacaoVinculoProprietario({
    proprietarioEmail, proprietarioNome, animalNome, vetNome, token,
    isNewUser = false, senhaInicial,
  }) {
    if (!podeEnviar()) {
      console.warn('[emailService] Credenciais não configuradas — email suprimido');
      return;
    }

    const appUrl     = process.env.APP_URL || 'http://localhost:5173';
    const aceitarUrl = `${appUrl}/#/proprietario/aprovar-vinculo?token=${token}&acao=aceitar`;
    const recusarUrl = `${appUrl}/#/proprietario/aprovar-vinculo?token=${token}&acao=recusar`;
    const loginUrl   = `${appUrl}/login`;

    // Bloco de conta nova — exibido apenas quando o proprietário foi criado agora
    const blocoNovaConta = (isNewUser && senhaInicial) ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px;margin:24px 0;">
        <p style="margin:0 0 10px;font-weight:700;color:#166534;font-size:15px;">
          🔐 Sua conta foi criada no S2Vet
        </p>
        <p style="margin:0 0 6px;color:#374151;font-size:14px;">
          Use os dados abaixo para acessar a plataforma:
        </p>
        <p style="margin:0;color:#374151;font-size:14px;">
          <strong>E-mail:</strong> ${proprietarioEmail}
        </p>
        <p style="margin:4px 0 0;color:#374151;font-size:14px;">
          <strong>Senha inicial:</strong>
          <code style="background:#dcfce7;padding:2px 8px;border-radius:4px;font-size:14px;">
            ${senhaInicial}
          </code>
        </p>
        <p style="margin:12px 0 0;color:#dc2626;font-size:13px;">
          ⚠️ Ao fazer login pela primeira vez, você será solicitado(a) a criar uma senha pessoal.
        </p>
        <p style="margin:10px 0 0;">
          <a href="${loginUrl}"
             style="color:#059669;font-weight:600;font-size:14px;">
            Acessar o S2Vet →
          </a>
        </p>
      </div>
    ` : '';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      proprietarioEmail,
      subject: `[S2Vet] Dr(a). ${vetNome} quer ser responsável por ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Solicitação de responsabilidade veterinária</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${proprietarioNome}</strong>.<br/>
              Dr(a). <strong>${vetNome}</strong> cadastrou o animal <strong>${animalNome}</strong>
              no S2Vet e gostaria de ser o veterinário responsável.
            </p>
            ${blocoNovaConta}
            <div style="background:white;border:2px solid #a7f3d0;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
              <div style="font-size:40px;">🐎</div>
              <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#065f46;">${animalNome}</p>
              <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">Aguardando sua autorização</p>
            </div>
            <div style="margin:32px 0;text-align:center;">
              <a href="${aceitarUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin-right:12px;">
                ✅ Autorizar
              </a>
              <a href="${recusarUrl}"
                 style="background:white;color:#dc2626;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;
                        border:2px solid #dc2626;">
                ✕ Recusar
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
              Link válido por <strong>7 dias</strong>. Se não reconhece esta solicitação, ignore este e-mail.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Solicitação ao proprietário enviada → ${proprietarioEmail}`);
  },

  // ── Confirmação de aceite/recusa para o vet ───────────────────────────────
  async enviarConfirmacaoVinculo({ proprietarioEmail, proprietarioNome, animalNome, vetNome, aceito }) {
    if (!podeEnviar()) return;

    const cor    = aceito ? '#059669' : '#dc2626';
    const status = aceito ? 'aceito'  : 'recusado';
    const emoji  = aceito ? '✅'       : '❌';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      proprietarioEmail,
      subject: `[S2Vet] Vínculo veterinário ${status} — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:${cor};padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Vínculo ${status} ${emoji}</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${proprietarioNome}</strong>.<br/>
              Dr(a). <strong>${vetNome}</strong> <strong>${status}</strong> o vínculo
              como veterinário responsável por <strong>${animalNome}</strong>.
            </p>
            ${!aceito ? '<p style="color:#6b7280;font-size:14px;">Você pode atribuir outro veterinário editando o cadastro do animal.</p>' : ''}
          </div>
        </div>
      `,
    });
  },

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

  // ── Solicitação de DESVINCULO para o VET (proprietário quer remover acesso) ──
  async enviarSolicitacaoDesvinculo({ vetEmail, vetNome, animalNome, proprietarioNome, token }) {
    if (!podeEnviar()) return;

    const appUrl      = process.env.APP_URL || 'http://localhost:5173';
    const acceptUrl   = `${appUrl}/#/veterinarios/solicitacoes/aprovar?token=${token}&acao=aceitar`;
    const rejectUrl   = `${appUrl}/#/veterinarios/solicitacoes/aprovar?token=${token}&acao=recusar`;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      vetEmail,
      subject: `[S2Vet] Solicitação de remoção de acesso — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#d97706;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#fef3c7;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Solicitação de remoção de acesso</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, Dr(a). <strong>${vetNome}</strong>.<br/>
              O(a) proprietário(a) <strong>${proprietarioNome}</strong> solicitou a <strong>remoção do seu acesso</strong> ao animal:
            </p>
            <div style="background:white;border:2px solid #fde68a;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
              <div style="font-size:40px;">🐎</div>
              <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#92400e;">${animalNome}</p>
            </div>
            <p style="color:#374151;line-height:1.6;">Você pode aceitar a remoção ou manter seu acesso:</p>
            <div style="display:flex;gap:12px;margin:24px 0;flex-wrap:wrap;">
              <a href="${acceptUrl}" style="flex:1;min-width:140px;background:#dc2626;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;text-align:center;">
                ✅ Aceitar remoção
              </a>
              <a href="${rejectUrl}" style="flex:1;min-width:140px;background:#059669;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;text-align:center;">
                🔒 Manter meu acesso
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;">
              Link válido por <strong>24 horas</strong>. Sem resposta, a remoção será aceita automaticamente.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Solicitação de desvinculo enviada → ${vetEmail}`);
  },

  // ── Solicitação de DESVINCULO para o PROPRIETÁRIO (vet quer se remover) ─────────
  async enviarSolicitacaoDesvinculoProprietario({ proprietarioEmail, proprietarioNome, animalNome, vetNome, token }) {
    if (!podeEnviar()) return;

    const appUrl    = process.env.APP_URL || 'http://localhost:5173';
    const aceitarUrl = `${appUrl}/#/proprietario/aprovar-vinculo?token=${token}&acao=aceitar`;
    const recusarUrl = `${appUrl}/#/proprietario/aprovar-vinculo?token=${token}&acao=recusar`;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      proprietarioEmail,
      subject: `[S2Vet] Veterinário quer se desvincular — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#d97706;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#fef3c7;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Solicitação de desvinculação</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${proprietarioNome}</strong>.<br/>
              Dr(a). <strong>${vetNome}</strong> solicitou se <strong>desvincular</strong> do animal:
            </p>
            <div style="background:white;border:2px solid #fde68a;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
              <div style="font-size:40px;">🐎</div>
              <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#92400e;">${animalNome}</p>
              <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">Aguardando sua decisão</p>
            </div>
            <div style="margin:32px 0;text-align:center;">
              <a href="${aceitarUrl}"
                 style="background:#dc2626;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin-right:12px;">
                ✅ Aceitar remoção
              </a>
              <a href="${recusarUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                🔒 Manter vínculo
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
              Link válido por <strong>24 horas</strong>. Sem resposta, o desvinculo será aceito automaticamente.<br/>
              Acesse a plataforma em <a href="${appUrl}" style="color:#059669;">${appUrl}</a>.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Solicitação de desvinculo (vet→prop) enviada → ${proprietarioEmail}`);
  },

  // ── Solicitação de TROCA_VET para o vet atual (proprietário quer trocar de vet) ──
  async enviarSolicitacaoTrocaVet({
    vetEmail, vetNome, novoVetNome, animalNome,
    proprietarioNome, proprietarioEmail, proprietarioPhone, token,
  }) {
    if (!podeEnviar()) return;

    const appUrl    = process.env.APP_URL || 'http://localhost:5173';
    const acceptUrl = `${appUrl}/#/veterinarios/solicitacoes/aprovar?token=${token}&acao=aceitar`;
    const rejectUrl = `${appUrl}/#/veterinarios/solicitacoes/aprovar?token=${token}&acao=recusar`;

    const contatoHtml = [
      proprietarioEmail ? `<p style="margin:4px 0;color:#374151;font-size:14px;"><strong>E-mail:</strong> ${proprietarioEmail}</p>` : '',
      proprietarioPhone ? `<p style="margin:4px 0;color:#374151;font-size:14px;"><strong>Telefone:</strong> ${proprietarioPhone}</p>` : '',
    ].join('');

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      vetEmail,
      subject: `[S2Vet] Solicitação de troca de veterinário — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#d97706;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#fef3c7;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">🔄 Solicitação de Alteração de Veterinário</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, Dr(a). <strong>${vetNome}</strong>.<br/>
              O(a) proprietário(a) <strong>${proprietarioNome}</strong> solicitou a <strong>troca do veterinário responsável</strong> pelo animal:
            </p>
            <div style="background:white;border:2px solid #fde68a;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
              <div style="font-size:40px;">🐎</div>
              <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#92400e;">${animalNome}</p>
              <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">Novo veterinário indicado: Dr(a). <strong>${novoVetNome}</strong></p>
            </div>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:0 0 24px;">
              <p style="margin:0 0 8px;font-weight:700;color:#92400e;font-size:14px;">Dados do proprietário:</p>
              <p style="margin:4px 0;color:#374151;font-size:14px;"><strong>Nome:</strong> ${proprietarioNome}</p>
              ${contatoHtml}
            </div>
            <p style="color:#374151;line-height:1.6;">Você pode aceitar a troca ou manter seu acesso:</p>
            <div style="margin:24px 0;text-align:center;">
              <a href="${acceptUrl}"
                 style="background:#d97706;color:white;padding:14px 28px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:14px;display:inline-block;margin-right:10px;">
                ✅ Aceitar troca
              </a>
              <a href="${rejectUrl}"
                 style="background:#059669;color:white;padding:14px 28px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                🔒 Manter meu acesso
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;">
              Sem resposta em <strong>24 horas</strong>, a troca será aceita automaticamente.
              Você também pode responder em <a href="${appUrl}" style="color:#059669;">${appUrl}</a>.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Solicitação de TROCA_VET enviada → ${vetEmail}`);
  },

  // ── Notificação ao proprietário — mensagens específicas por cenário ─────────
  // cenario: 'VINCULO_ACEITO' | 'VINCULO_RECUSADO' | 'DESVINCULO_ACEITO' |
  //          'DESVINCULO_RECUSADO' | 'TROCA_STEP1_ACEITO' | 'TROCA_STEP1_RECUSADO'
  async enviarNotificacaoProprietario({
    proprietarioEmail, proprietarioNome, animalNome, vetNome, novoVetNome = null, cenario,
  }) {
    if (!podeEnviar()) return;

    const configs = {
      VINCULO_ACEITO: {
        cor: '#059669', emoji: '✅',
        assunto: `Veterinário vinculado — ${animalNome}`,
        titulo: 'Vínculo confirmado!',
        corpo: `Dr(a). <strong>${vetNome}</strong> é agora o(a) veterinário(a) responsável pelo cavalo <strong>${animalNome}</strong>.`,
      },
      VINCULO_RECUSADO: {
        cor: '#dc2626', emoji: '❌',
        assunto: `Solicitação recusada — ${animalNome}`,
        titulo: 'Solicitação recusada',
        corpo: `Dr(a). <strong>${vetNome}</strong> não aceitou ser o(a) responsável pelo cavalo <strong>${animalNome}</strong>. Você pode indicar outro veterinário editando o cadastro do animal.`,
      },
      DESVINCULO_ACEITO: {
        cor: '#6b7280', emoji: '🔓',
        assunto: `Veterinário removido — ${animalNome}`,
        titulo: 'Remoção confirmada',
        corpo: `Dr(a). <strong>${vetNome}</strong> deixou de ser responsável pelo cavalo <strong>${animalNome}</strong>.`,
      },
      DESVINCULO_RECUSADO: {
        cor: '#d97706', emoji: '🔒',
        assunto: `Solicitação de remoção recusada — ${animalNome}`,
        titulo: 'Remoção não aceita',
        corpo: `Dr(a). <strong>${vetNome}</strong> não aceitou deixar de ser responsável pelo cavalo <strong>${animalNome}</strong>. O acesso permanece inalterado.`,
      },
      TROCA_STEP1_ACEITO: {
        cor: '#d97706', emoji: '🔄',
        assunto: `Troca aceita — aguardando novo veterinário — ${animalNome}`,
        titulo: 'Primeira etapa da troca concluída',
        corpo: `Dr(a). <strong>${vetNome}</strong> aceitou a troca. Aguardando a confirmação de Dr(a). <strong>${novoVetNome}</strong> para assumir a responsabilidade pelo cavalo <strong>${animalNome}</strong>.`,
      },
      TROCA_STEP1_RECUSADO: {
        cor: '#dc2626', emoji: '❌',
        assunto: `Troca de veterinário recusada — ${animalNome}`,
        titulo: 'Troca não aceita',
        corpo: `Dr(a). <strong>${vetNome}</strong> não aceitou deixar de ser responsável pelo cavalo <strong>${animalNome}</strong>. O acesso permanece inalterado.`,
      },
    };

    const cfg = configs[cenario];
    if (!cfg) return;

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      proprietarioEmail,
      subject: `[S2Vet] ${cfg.assunto}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:${cfg.cor};padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">${cfg.emoji} ${cfg.titulo}</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${proprietarioNome}</strong>.<br/>${cfg.corpo}
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Notificação proprietário (${cenario}) → ${proprietarioEmail}`);
  },

  // ── Notificação ao vet quando proprietário troca ou remove o vínculo ────────
  // novoVetNome: nome do novo vet (troca) | null (remoção)
  async enviarNotificacaoTrocaVet({ vetEmail, vetNome, animalNome, proprietarioNome, novoVetNome = null }) {
    if (!podeEnviar()) return;

    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const isTroca  = !!novoVetNome;
    const subject  = isTroca
      ? `[S2Vet] Animal sendo trocado para outro veterinário — ${animalNome}`
      : `[S2Vet] Remoção de acesso ao animal — ${animalNome}`;

    const mensagemPrincipal = isTroca
      ? `Animal sendo trocado para o veterinário <strong>${novoVetNome}</strong>`
      : `Proprietário quer remover o seu acesso ao animal <strong>${animalNome}</strong>`;

    const corHeader  = isTroca ? '#d97706' : '#6b7280';
    const corAviso   = isTroca ? '#fef3c7' : '#fee2e2';
    const corBorda   = isTroca ? '#fde68a' : '#fecaca';
    const corTexto   = isTroca ? '#92400e' : '#991b1b';
    const icone      = isTroca ? '🔄' : '🚫';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      vetEmail,
      subject,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:${corHeader};padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#fff;opacity:.8;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;line-height:1.6;">
              Olá, Dr(a). <strong>${vetNome}</strong>.
            </p>
            <p style="color:#374151;line-height:1.6;">
              O(a) proprietário(a) <strong>${proprietarioNome}</strong> realizou uma alteração
              no vínculo do animal <strong>${animalNome}</strong>:
            </p>
            <div style="background:${corAviso};border:1px solid ${corBorda};border-radius:8px;padding:16px;margin:20px 0;">
              <p style="margin:0;color:${corTexto};font-size:15px;font-weight:600;">
                ${icone} ${mensagemPrincipal}
              </p>
            </div>
            <p style="color:#6b7280;font-size:13px;line-height:1.5;">
              Caso acredite que isso seja um engano, entre em contato diretamente com o proprietário.<br/>
              Acesse a plataforma em <a href="${appUrl}" style="color:#059669;">${appUrl}</a>.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Notificação de vínculo enviada → ${vetEmail}`);
  },

  // ── Notificação para gestores — autorização de vínculo concedida ───────────────
  async notificarGestoresAutorizacaoConcedida({ gestorEmail, gestorNome, animalNome, proprietarioNome, vetNome }) {
    if (!podeEnviar()) return;
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      gestorEmail,
      subject: `[S2Vet] Autorização concedida — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">✅ Autorização concedida</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, <strong>${gestorNome}</strong>.<br/>
              O(a) proprietário(a) <strong>${proprietarioNome}</strong> autorizou o(a) Dr(a).
              <strong>${vetNome}</strong> como responsável pelo animal <strong>${animalNome}</strong>.
            </p>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
              <p style="margin:0;font-size:13px;color:#166534;">
                O animal <strong>${animalNome}</strong> agora está liberado para atendimentos e cuidados clínicos.
              </p>
            </div>
            <div style="text-align:center;margin:28px 0 20px;">
              <a href="${appUrl}" style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                     text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                Acessar o S2Vet
              </a>
            </div>
            <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-bottom:0;">
              Este é um e-mail automático. Não responda a esta mensagem.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`[emailService] Notificação de autorização enviada → ${gestorEmail}`);
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
