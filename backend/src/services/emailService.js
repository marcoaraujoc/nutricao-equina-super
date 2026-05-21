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
    const approvalUrl = `${appUrl}/veterinarios/solicitacoes/aprovar?token=${token}&acao=aceitar`;
    const rejectUrl   = `${appUrl}/veterinarios/solicitacoes/aprovar?token=${token}&acao=recusar`;

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
    const aceitarUrl = `${appUrl}/proprietario/aprovar-vinculo?token=${token}&acao=aceitar`;
    const recusarUrl = `${appUrl}/proprietario/aprovar-vinculo?token=${token}&acao=recusar`;
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

  // ── Convite de equipe ─────────────────────────────────────────────────────
  async enviarConviteEquipe({ email, cargo, token, vetNome, equipeNome }) {
    if (!podeEnviar()) return;

    const appUrl     = process.env.APP_URL || 'http://localhost:5173';
    const conviteUrl = `${appUrl}/equipe/convite/${token}`;

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
            <h2 style="color:#111827;margin-top:0;">Convite de equipe</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá! Dr(a). <strong>${vetNome}</strong> convidou você para fazer parte da equipe
              <strong>${equipeNome}</strong> no S2Vet como <strong>${cargo}</strong>.
            </p>
            <div style="text-align:center;margin:32px 0;">
              <a href="${conviteUrl}"
                 style="background:#059669;color:white;padding:14px 32px;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                ✅ Aceitar convite
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;">
              Link válido por <strong>7 dias</strong>. Se não reconhece este convite, ignore este e-mail.
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[emailService] Convite de equipe enviado → ${email}`);
  },

  // ── Notificação ao vet anterior quando proprietário troca de vet ──────────
  async enviarNotificacaoTrocaVet({ vetEmail, vetNome, animalNome, proprietarioNome }) {
    if (!podeEnviar()) return;

    const appUrl = process.env.APP_URL || 'http://localhost:5173';

    await createTransporter().sendMail({
      from:    `"S2Vet" <${process.env.EMAIL_USER}>`,
      to:      vetEmail,
      subject: `[S2Vet] Paciente transferido — ${animalNome}`,
      html: `
        <div style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#6b7280;padding:24px 32px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">🐴 S2Vet</h1>
            <p style="color:#e5e7eb;margin:4px 0 0;font-size:13px;">Sistema Hospitalar Veterinário</p>
          </div>
          <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <h2 style="color:#111827;margin-top:0;">Paciente transferido</h2>
            <p style="color:#374151;line-height:1.6;">
              Olá, Dr(a). <strong>${vetNome}</strong>.
            </p>
            <p style="color:#374151;line-height:1.6;">
              Informamos que o(a) proprietário(a) <strong>${proprietarioNome}</strong>
              optou por transferir o paciente <strong>${animalNome}</strong> para outro
              veterinário responsável.
            </p>
            <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:20px 0;">
              <p style="margin:0;color:#92400e;font-size:14px;">
                ⚠️ O animal <strong>${animalNome}</strong> foi removido da sua lista de pacientes
                na plataforma S2Vet.
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

    console.log(`[emailService] Notificação de transferência enviada → ${vetEmail}`);
  },
};

module.exports = emailService;