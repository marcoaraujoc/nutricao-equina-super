// backend/src/controllers/UserController.js
'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const prisma = require('../lib/prisma').default;
const { setAuthCookies } = require('../lib/authCookies');
const { normalizeEmail, findUserByEmail } = require('../lib/email');
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { whereProprietarioNoEscopo } = require('./ProprietarioController');
// MESMA função que resolve o escopo em GET /equipes/configuracoes — reusada aqui para
// o `/me` já dizer se a pessoa é dona/gestora, sem o front precisar sondar aquele
// endpoint só para ler o 404. Ver `isGestorEmpresa` no getMe.
const { resolverEscopoConfiguracao, buscarConfiguracao } = require('./EquipeController');
const { parseLocaisTrabalho, gravarLocaisTrabalho, csvParaIds, validarLocaisContraExpedienteEmpresa,
        especialidadesPadraoVeterinario } = require('./EquipeController');
const {
  salvarPerfil: salvarPerfilProprietario,
  aplicarPerfil: aplicarPerfilProprietario,
} = require('../lib/proprietarioPerfil');
// Cadastro do PROFISSIONAL é por empresa (mesma regra do proprietário) — nome, contato,
// endereço e CRMV nunca voltam a ser gravados no User.
const {
  salvarPerfil:  salvarPerfilProfissional,
  aplicarPerfil: aplicarPerfilProfissional,
  obterPerfil:   obterPerfilProfissional,
} = require('../lib/profissionalPerfil');
// Tabela de ligação usuário × empresa — fonte do PERFIL e do cadastro por empresa.
const {
  perfilDaEmpresa,
  aplicarVinculo,
  salvarVinculo,
} = require('../lib/usuarioEmpresa');
const { senhaReutilizada, registrarTrocaSenha, MENSAGEM_REUSO: MENSAGEM_SENHA_REUTILIZADA } = require('../services/passwordHistoryService');

// Remove zeros à esquerda do número CRMV, mantém a UF
// Ex: "00123/SP" → "123/SP" | "13557/RJ" → "13557/RJ"
const normalizarCRMV = (v) => {
  const parts = v.trim().toUpperCase().split('/');
  if (parts.length !== 2) return v.trim().toUpperCase();
  const [num, uf] = parts;
  return `${parseInt(num, 10)}/${uf}`;
};

// Valida/normaliza o expediente de atendimento (dias 0-6 CSV + HH:MM).
// Cada campo: undefined = não altera; ''/[] = limpa (herda o da empresa).
const parseExpedienteBody = (body) => {
  let dias;
  if (body.diasTrabalho !== undefined) {
    const arr = Array.isArray(body.diasTrabalho)
      ? body.diasTrabalho
      : String(body.diasTrabalho).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length === 0) dias = null;
    else {
      const nums = [...new Set(arr.map(Number))].sort((a, b) => a - b);
      if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) return { erro: 'Dias de atendimento inválidos (0=Dom … 6=Sáb).' };
      dias = nums.join(',');
    }
  }
  const parseHora = (v) => {
    if (v === undefined) return undefined;
    const s = String(v).trim();
    if (s === '') return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return '__ERRO__';
    return s;
  };
  const hi = parseHora(body.horaInicioTrabalho);
  const hf = parseHora(body.horaFimTrabalho);
  if (hi === '__ERRO__' || hf === '__ERRO__') return { erro: 'Horário de atendimento inválido — use HH:MM.' };
  if (hi && hf && hi >= hf) return { erro: 'A hora de início do atendimento deve ser menor que a de término.' };
  return { diasTrabalho: dias, horaInicioTrabalho: hi, horaFimTrabalho: hf };
};

// Resolve o MembroEquipe do CONTEXTO ATIVO: equipe selecionada > equipe dentro da
// empresa ativa > primeiro vínculo do usuário. Assim o expediente editado/exibido é
// sempre o da empresa/equipe em que o usuário está trabalhando (não um vínculo aleatório).
// `cargo` vem junto: quem decide se há especialidade/tempo de consulta é o CARGO na
// equipe (o GESTOR tem userType VETERINARIO mas não preenche dados profissionais).
const resolverMembroDoContexto = async (userId, req) => {
  if (req.equipeId) {
    const m = await prisma.membroEquipe.findFirst({ where: { userId, equipeId: Number(req.equipeId) }, select: { id: true, cargo: true } });
    if (m) return m;
  }
  if (req.empresaId) {
    const m = await prisma.membroEquipe.findFirst({
      where:   { userId, equipe: { empresaId: Number(req.empresaId) } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, cargo: true },
    });
    // Contexto ativo SEM vínculo: não cai em outro vínculo. Cair no mais antigo
    // trazia o cargo (e o expediente/locais) de OUTRA clínica para esta tela.
    return m ?? null;
  }
  // Só sem contexto nenhum (1º login, cliente não-navegador) é que se usa o vínculo
  // mais antigo como palpite.
  return prisma.membroEquipe.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true, cargo: true } });
};

const UserController = {

  /**
   * GET /api/users/me
   * Busca os dados do usuário usando o e-mail do token JWT
   */
  getMe: async (req, res) => {
    try {
      const { email } = req.user;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id:                 true,
          fullName:           true,
          email:              true,
          phone:              true,
          role:               true,
          userType:           true,
          mustChangePassword: true,
          cep:         true,
          endereco:    true,
          complemento: true,
          bairro:      true,
          cidade:      true,
          estado:      true,
          createdAt:   true,
          ativo:       true,
          vetPerfil: {
            select: {
              crmv:    true,
              especies:          { select: { especieId: true } },
              subespecialidades: { select: { nome: true } },
            },
          },
          // Especialidade é por empresa; sem contexto (vet autônomo) lê todas as dele.
          // Legado (empresaId null) continua visível para o próprio dono do cadastro.
          especialidades: {
            where:  req.empresaId ? { OR: [{ empresaId: Number(req.empresaId) }, { empresaId: null }] } : {},
            select: { especialidadeId: true },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
      }

      // isConvidado via SQL raw — campo novo, ainda pode não estar no cliente Prisma gerado
      let isConvidado = false;
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "isConvidado" FROM schs2vet.users WHERE id = $1`,
          user.id,
        );
        isConvidado = rows[0]?.isConvidado ?? false;
      } catch { /* campo ainda não existe no DB legado — ignora */ }

      // Convite pendente (onboarding de convidado)
      const convitePendente = await prisma.conviteEquipe.findFirst({
        where:   { email: user.email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
        include: { equipe: { select: { nome: true } } },
        orderBy: { createdAt: 'desc' },
      });

      // Expediente de atendimento do profissional. Lê o do vínculo do CONTEXTO ATIVO.
      let expediente = { diasTrabalho: null, horaInicioTrabalho: null, horaFimTrabalho: null };
      const membroExp = await resolverMembroDoContexto(user.id, req);
      try {
        if (membroExp) {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT "diasTrabalho","horaInicioTrabalho","horaFimTrabalho" FROM schs2vet.tb_membros_equipe WHERE id=$1`,
            membroExp.id,
          );
          if (rows[0]) expediente = rows[0];
        }
        // Vínculo do contexto sem expediente: herda de OUTRO vínculo do profissional
        // NA MESMA EMPRESA (ele pode ter mais de uma equipe nela). NUNCA de outra
        // empresa — o cadastro profissional é por empresa (ver ProfissionalPerfil).
        if (!expediente.diasTrabalho && !expediente.horaInicioTrabalho && !expediente.horaFimTrabalho && req.empresaId) {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT m."diasTrabalho", m."horaInicioTrabalho", m."horaFimTrabalho"
               FROM schs2vet.tb_membros_equipe m
               JOIN schs2vet.tb_equipes e ON e.id = m."equipeId"
              WHERE m."userId" = $1 AND e."empresaId" = $2
                AND (m."diasTrabalho" IS NOT NULL OR m."horaInicioTrabalho" IS NOT NULL OR m."horaFimTrabalho" IS NOT NULL)
              ORDER BY m.id DESC LIMIT 1`,
            user.id, Number(req.empresaId),
          );
          if (rows[0]) expediente = rows[0];
        }
      } catch { /* colunas ainda não migradas — ignora */ }

      // Locais de trabalho já cadastrados (pelo gestor, ao incluir o membro, ou pelo
      // próprio profissional) — o Cadastro Pessoal abre com eles preenchidos.
      let locaisTrabalho = [];
      if (membroExp) {
        const rows = await prisma.membroLocalTrabalho.findMany({
          where:   { membroEquipeId: membroExp.id },
          include: { localizacao: { select: { id: true, nome: true } } },
          orderBy: { id: 'asc' },
        });
        locaisTrabalho = rows.map(r => ({
          localizacaoId:      r.localizacaoId,
          localizacaoNome:    r.localizacao?.nome ?? null,
          diasTrabalho:       r.diasTrabalho,
          horaInicioTrabalho: r.horaInicioTrabalho,
          horaFimTrabalho:    r.horaFimTrabalho,
          especialidadeIds:   csvParaIds(r.especialidadesIds),
          // SEM isto o Cadastro Pessoal reabria sem o tempo de consulta e o salvava
          // vazio — apagando o que o gestor tinha configurado na inclusão do membro.
          temposConsulta:     r.temposConsulta ?? {},
        }));
      }

      const { vetPerfil, especialidades, ...userBruto } = user;
      // TIPO POR EMPRESA: o que ela é na clínica ATIVA (cargo ali, ou cliente ali) —
      // resolvido pelo `authenticate` (lib/tipoContexto.js). O `userType` do login
      // fica em `userTypeGlobal`, só como identidade/legado. É isto que faz a MESMA
      // pessoa ser gestora numa empresa, veterinária na outra, estagiária na terceira
      // e PROPRIETÁRIA na quarta, cada uma com seu cadastro.
      const tipoNoContexto = req.user?.userType ?? userBruto.userType;
      const ehClienteAqui  = tipoNoContexto === 'PROPRIETARIO';

      // Cadastro da EMPRESA ATIVA. FONTE: tb_usuario_empresa (tabela de ligação —
      // nome, telefone, documento, endereço, CRMV e condição comercial por empresa).
      // Sem vínculo lá (legado ainda não migrado), cai nas tabelas antigas.
      const vinculoEmpresa = await perfilDaEmpresa(user.id, req.empresaId);
      const userData = vinculoEmpresa
        ? await aplicarVinculo(userBruto, req.empresaId)
        : (ehClienteAqui
            ? await aplicarPerfilProprietario(userBruto, req.empresaId)
            : await aplicarPerfilProfissional(userBruto, req.empresaId));
      const perfilProf = vinculoEmpresa
        ? { crmv: vinculoEmpresa.crmv }
        : (ehClienteAqui ? null : await obterPerfilProfissional(user.id, req.empresaId));

      // Confirmação do cadastro NESTA empresa: o gestor ter preenchido o endereço na
      // inclusão NÃO libera os módulos — quem confirma é o próprio profissional,
      // salvando o Cadastro Pessoal aqui. Coluna nova lida por SQL cru (o client
      // Prisma pode estar desatualizado — mesmo padrão do `isConvidado`).
      // Sem empresa no contexto não há o que confirmar (vet autônomo, usuário sem
      // vínculo, chamada antes do seletor resolver). Travar aqui criava DEADLOCK: o
      // gate pedia o cadastro, e salvar não confirmava nada — a gravação também
      // depende de `req.empresaId`. Nesse caso, vale o cadastro em si.
      let cadastroConfirmado = !req.empresaId;
      if (req.empresaId) {
        try {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT cadastro_confirmado_em FROM schs2vet.tb_usuario_empresa
              WHERE user_id = $1 AND empresa_id = $2 LIMIT 1`,
            user.id, Number(req.empresaId),
          );
          const vinculoExiste = rows?.length > 0;
          // Sem linha de vínculo nesta empresa também não há o que confirmar —
          // não é caso de bloquear (é legado/ADMIN olhando outra empresa).
          cadastroConfirmado = vinculoExiste ? !!rows[0].cadastro_confirmado_em : true;
        } catch { cadastroConfirmado = true; /* coluna ainda não migrada — não bloqueia */ }
      }

      // É dona/gestora da empresa do contexto? Resolvido pela MESMA função de
      // GET /equipes/configuracoes (ownerId ou cargo GESTOR), para a resposta ser
      // idêntica à daquele endpoint. O front lia isso sondando aquela rota e
      // interpretando o 404 como "não é gestor" — funcionava, mas gerava um 404 no
      // DevTools a cada login, e o navegador loga a requisição na camada de rede,
      // antes de qualquer tratamento em JS. Agora vem junto do /me, sem round-trip.
      // `empresaConfigurada` acompanha porque saía do MESMO endpoint (`configurado`
      // = já existe registro salvo) e alimenta o gate de primeiro acesso do gestor.
      // Para quem não é gestor vale `true`: esse gate nunca se aplica a ele.
      let isGestorEmpresa   = false;
      let empresaConfigurada = true;
      try {
        const escopoCfg = await resolverEscopoConfiguracao(req);
        isGestorEmpresa = !!escopoCfg;
        if (escopoCfg) empresaConfigurada = !!(await buscarConfiguracao(escopoCfg));
      } catch { isGestorEmpresa = false; empresaConfigurada = true; }

      return res.status(200).json({
        ...userData,
        cadastroConfirmado,
        isGestorEmpresa,
        empresaConfigurada,
        userType:       tipoNoContexto,
        userTypeGlobal: userBruto.userType,
        isConvidado,
        // Cargo do vínculo do CONTEXTO ATIVO. Antes vinha do vínculo mais ANTIGO do
        // usuário (`findFirst` sem filtro de empresa): quem é GESTOR na própria
        // clínica aparecia como "Gestor(a)" — com os dados profissionais travados —
        // ao entrar em outra empresa onde é estagiário/veterinário.
        cargoEquipe: membroExp?.cargo ?? null,
        temEquipe:   !!membroExp,
        diasTrabalho:       expediente.diasTrabalho,
        horaInicioTrabalho: expediente.horaInicioTrabalho,
        horaFimTrabalho:    expediente.horaFimTrabalho,
        locaisTrabalho,
        // CRMV do cadastro DESTA empresa; sem perfil (legado/autônomo) cai no VetPerfil
        crmv:              perfilProf?.crmv ?? vetPerfil?.crmv ?? null,
        especiesAtendidas: vetPerfil?.especies.map(e => e.especieId) ?? [],
        subespecialidades: vetPerfil?.subespecialidades.map(s => s.nome) ?? [],
        especialidadeIds:  especialidades?.map(e => e.especialidadeId) ?? [],
        profileComplete:   !!(user.phone && user.fullName && user.fullName.trim()),
        pendingInvite:     convitePendente
          ? { id: convitePendente.id, cargo: convitePendente.cargo, equipeNome: convitePendente.equipe?.nome ?? '' }
          : null,
      });

    } catch (error) {
      console.error('Erro em getMe:', error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar usuário' });
    }
  },

  /**
   * PUT /api/users/me
   * Atualiza o cadastro pessoal usando o e-mail do token
   * Se for veterinário, salva também CRMV e espécies atendidas no VetPerfil
   */
  updateMe: async (req, res) => {
    try {
      const { email } = req.user;

      const {
        fullName,
        phone,
        cep,
        endereco,
        complemento,
        bairro,
        cidade,
        estado,
        userType,
        crmv,
        especiesAtendidas,
        subespecialidades,
        especialidadeIds,
        diasTrabalho,
        horaInicioTrabalho,
        horaFimTrabalho,
        locaisTrabalho,
      } = req.body;

      // (o antigo flag `isConvidado` deixou de decidir a troca de tipo — quem decide
      // é o vínculo no contexto ativo, logo abaixo)

      // O tipo de usuário DENTRO de uma empresa é o CARGO que o gestor atribuiu
      // (MembroEquipe.cargo, que é por equipe/empresa). Logo, quem tem vínculo no
      // contexto ativo NÃO altera o `userType` global daqui — o campo é somente
      // leitura na tela e o body é ignorado. Antes bastava ser dono/gestor de
      // QUALQUER empresa para liberar a troca: a profissional que tem a própria
      // clínica podia, de dentro da empresa onde é estagiária, reescrever o tipo
      // que vale para todas as empresas.
      // Continuam podendo: quem não tem vínculo no contexto (cadastro direto) e o
      // DONO da empresa ativa (caso documentado: fornecedora convidada que assinou a
      // aplicação, virou gestora da própria clínica e se declara Médica Veterinária).
      let effectiveUserType = undefined;
      if (userType) {
        const membroDoContexto = await resolverMembroDoContexto(Number(req.user.id), req);
        let podeAlterarTipo = !membroDoContexto;
        if (membroDoContexto && req.empresaId) {
          const donoDaAtiva = await prisma.empresa.findFirst({
            where:  { id: Number(req.empresaId), ownerId: Number(req.user.id) },
            select: { id: true },
          });
          podeAlterarTipo = !!donoDaAtiva;
        }

        if (!podeAlterarTipo) {
          effectiveUserType = undefined; // mantém o tipo definido pela equipe
        } else {
          const TIPOS_PERMITIDOS = ['PROPRIETARIO', 'VETERINARIO'];
          if (!TIPOS_PERMITIDOS.includes(userType)) {
            return res.status(400).json({
              success: false,
              error: 'Tipo de usuário inválido. Apenas Proprietário e Médico Veterinário estão disponíveis para cadastro direto.',
            });
          }
          effectiveUserType = userType;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          fullName:    fullName    || undefined,
          phone:       phone       || undefined,
          cep:         cep         || undefined,
          endereco:    endereco    || undefined,
          complemento: complemento || undefined,
          bairro:      bairro      || undefined,
          cidade:      cidade      || undefined,
          estado:      estado      || undefined,
          userType:    effectiveUserType,
        },
      });

      // Editando os próprios dados: reflete no cadastro que a EMPRESA ATIVA mantém
      // dele — é esse o cadastro que a clínica enxerga, e o da outra clínica não muda.
      // Sem contexto de empresa (profissional autônomo), fica só no User.
      if (req.empresaId) {
        const dadosCadastro = {
          ...(fullName    !== undefined ? { fullName }    : {}),
          ...(phone       !== undefined ? { phone }       : {}),
          ...(cep         !== undefined ? { cep }         : {}),
          ...(endereco    !== undefined ? { endereco }    : {}),
          ...(complemento !== undefined ? { complemento } : {}),
          ...(bairro      !== undefined ? { bairro }      : {}),
          ...(cidade      !== undefined ? { cidade }      : {}),
          ...(estado      !== undefined ? { estado }      : {}),
        };
        const ehCliente = (req.user?.userType ?? updatedUser.userType) === 'PROPRIETARIO';
        const dadosProf = {
          ...dadosCadastro,
          ...(crmv !== undefined ? { crmv: crmv ? normalizarCRMV(crmv) : null } : {}),
        };

        // FONTE NOVA: tabela de ligação usuário × empresa. O perfil não é tocado aqui
        // (quem define é o gestor); só o cadastro daquela empresa.
        await salvarVinculo(prisma, updatedUser.id, req.empresaId, ehCliente ? dadosCadastro : dadosProf);

        // É AQUI que o cadastro daquela empresa passa a valer como confirmado pelo
        // próprio usuário — e só então os módulos são liberados para ele ali.
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE schs2vet.tb_usuario_empresa
                SET cadastro_confirmado_em = COALESCE(cadastro_confirmado_em, CURRENT_TIMESTAMP)
              WHERE user_id = $1 AND empresa_id = $2`,
            updatedUser.id, Number(req.empresaId),
          );
        } catch { /* coluna ainda não migrada */ }

        // Legado (mantido em sincronia enquanto as tabelas antigas existirem)
        if (ehCliente) {
          await salvarPerfilProprietario(prisma, updatedUser.id, req.empresaId, dadosCadastro);
        } else {
          await salvarPerfilProfissional(prisma, updatedUser.id, req.empresaId, dadosProf);
        }
      }

      // Salvar dados do veterinário
      if (userType === 'VETERINARIO' && crmv !== undefined) {
        const crmvNormalizado = normalizarCRMV(crmv);

        const vetPerfil = await prisma.vetPerfil.upsert({
          where:  { userId: updatedUser.id },
          create: { userId: updatedUser.id, crmv: crmvNormalizado },
          update: { crmv: crmvNormalizado },
        });

        // Recria lista de espécies (delete + insert)
        if (Array.isArray(especiesAtendidas)) {
          await prisma.vetEspecie.deleteMany({
            where: { vetPerfilId: vetPerfil.id },
          });

          if (especiesAtendidas.length > 0) {
            await prisma.vetEspecie.createMany({
              data: especiesAtendidas.map(eid => ({
                vetPerfilId: vetPerfil.id,
                especieId:   Number(eid),
              })),
              skipDuplicates: true,
            });
          }
        }

        // Recria lista de subespecialidades (delete + insert)
        if (Array.isArray(subespecialidades)) {
          await prisma.vetSubespecialidade.deleteMany({
            where: { vetPerfilId: vetPerfil.id },
          });
          if (subespecialidades.length > 0) {
            await prisma.vetSubespecialidade.createMany({
              data: subespecialidades.map(nome => ({
                vetPerfilId: vetPerfil.id,
                nome:        String(nome).slice(0, 100),
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      // Expediente de atendimento (dias/horários) — "o MEU horário": grava em TODOS os
      // vínculos do profissional, para valer em qualquer empresa/equipe/agenda.
      if (diasTrabalho !== undefined || horaInicioTrabalho !== undefined || horaFimTrabalho !== undefined) {
        const exp = parseExpedienteBody({ diasTrabalho, horaInicioTrabalho, horaFimTrabalho });
        if (exp.erro) return res.status(400).json({ success: false, error: exp.erro });
        const sets = [], vals = [];
        let i = 1;
        if (exp.diasTrabalho       !== undefined) { sets.push(`"diasTrabalho"=$${i++}`);       vals.push(exp.diasTrabalho); }
        if (exp.horaInicioTrabalho !== undefined) { sets.push(`"horaInicioTrabalho"=$${i++}`); vals.push(exp.horaInicioTrabalho); }
        if (exp.horaFimTrabalho    !== undefined) { sets.push(`"horaFimTrabalho"=$${i++}`);    vals.push(exp.horaFimTrabalho); }
        if (sets.length > 0) {
          vals.push(updatedUser.id);
          await prisma.$executeRawUnsafe(`UPDATE schs2vet.tb_membros_equipe SET ${sets.join(', ')} WHERE "userId"=$${i}`, ...vals);
        }
      }

      // Locais de trabalho (local + dias + horário). Diferente do expediente único,
      // ficam no vínculo do CONTEXTO ATIVO — a localização pertence à empresa. Usa o
      // mesmo parser da tela de Equipe, então a regra de horários que não podem
      // coincidir vale igual aqui.
      // Especialidade só existe para VETERINARIO e FORNECEDOR. O vet que não informar
      // nenhuma assume Clínica Médica; o fornecedor pode ficar sem. Demais perfis não
      // têm especialidade nem tempo de consulta — inclusive o GESTOR, que tem userType
      // VETERINARIO mas não preenche dados profissionais (mesma regra do formulário).
      const membroCtx  = await resolverMembroDoContexto(updatedUser.id, req);
      const ehGestor   = membroCtx?.cargo === 'GESTOR';
      const ehVet      = updatedUser.userType === 'VETERINARIO' && !ehGestor;
      const perfilComEspecialidade = ehVet || updatedUser.userType === 'FORNECEDOR';
      const especPadrao = ehVet
        // Fallback nas espécies que ELE informou: o vet autônomo pode não ter empresa
        // com espécies configuradas, mas acabou de escolher as que atende.
        ? await especialidadesPadraoVeterinario(req, null,
            Array.isArray(especiesAtendidas) ? especiesAtendidas : [])
        : [];

      if (locaisTrabalho !== undefined) {
        const { locais, erro } = parseLocaisTrabalho({ locaisTrabalho }, {
          especialidadesPadrao: especPadrao,
          semEspecialidade:     !perfilComEspecialidade,
        });
        if (erro) return res.status(400).json({ success: false, error: erro });
        // Todo membro fica restrito ao dia/horário da empresa (EmpresaConfiguracao)
        const erroExp = await validarLocaisContraExpedienteEmpresa(req, locais);
        if (erroExp) return res.status(400).json({ success: false, error: erroExp });
        if (membroCtx) await gravarLocaisTrabalho(prisma, membroCtx.id, locais);
      }

      // Especialidades (catálogo por espécie) — fonte única para VET e FORNECEDOR e
      // escopadas por EMPRESA: o que ele exerce na outra clínica não é tocado aqui.
      // Sem contexto de empresa (autônomo), mexe só nos vínculos sem empresa.
      const escopoEspec = req.empresaId
        ? { empresaId: Number(req.empresaId) }
        : { empresaId: null };
      if (Array.isArray(especialidadeIds)) {
        let ids = perfilComEspecialidade
          ? [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger)
          : [];
        if (perfilComEspecialidade && ids.length === 0) ids = [...especPadrao];
        await prisma.usuarioEspecialidade.deleteMany({ where: { userId: updatedUser.id, ...escopoEspec } });
        if (ids.length > 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: ids.map(especialidadeId => ({ userId: updatedUser.id, especialidadeId, ...escopoEspec })),
            skipDuplicates: true,
          });
        }
      }

      // Garantia: veterinário nunca fica sem especialidade NESTA empresa — Clínica Médica.
      // (Cobre o caso em que especialidadeIds nem foi enviado, ex.: o cadastro define
      // a especialidade por local e o profissional não marcou nenhuma.)
      if (ehVet && especPadrao.length > 0) {
        const jaTem = await prisma.usuarioEspecialidade.count({
          where: { userId: updatedUser.id, ...escopoEspec },
        });
        if (jaTem === 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: especPadrao.map(especialidadeId => ({ userId: updatedUser.id, especialidadeId, ...escopoEspec })),
            skipDuplicates: true,
          });
        }
      }

      console.log('✅ Cadastro Pessoal atualizado - Email:', email);

      const novoToken = jwt.sign(
        {
          id:       updatedUser.id,
          email:    updatedUser.email,
          fullName: updatedUser.fullName,
          role:     updatedUser.role,
          userType: updatedUser.userType, // ← agora correto
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Atualiza o cookie HttpOnly de acesso com o token que reflete o novo userType
      setAuthCookies(res, { accessToken: novoToken });

      return res.status(200).json({
        success: true,
        message: 'Cadastro pessoal salvo com sucesso!',
        user:    updatedUser,
        token:   novoToken, // ← novo token com userType atualizado (compat)
      });

    } catch (error) {
      console.error('Erro ao atualizar cadastro pessoal:', error);

      // Violação de unicidade: diz QUAL campo colidiu, em vez de "erro interno".
      // `meta.target` pode vir como array de colunas ou como string (nome do índice).
      if (error.code === 'P2002') {
        const alvo = Array.isArray(error.meta?.target)
          ? error.meta.target.join(',')
          : String(error.meta?.target ?? '');
        if (/crmv/i.test(alvo)) {
          return res.status(409).json({
            success: false,
            code:  'CRMV_DUPLICADO',
            error: 'Este CRMV já está cadastrado para outro usuário. Confira o número e a UF; '
                 + 'se o CRMV é seu, fale com o administrador para liberar o cadastro anterior.',
          });
        }
        if (/email/i.test(alvo)) {
          return res.status(409).json({
            success: false,
            code:  'EMAIL_DUPLICADO',
            error: 'Este e-mail já está cadastrado para outro usuário.',
          });
        }
        return res.status(409).json({
          success: false,
          code:  'REGISTRO_DUPLICADO',
          error: `Já existe um cadastro com este dado${alvo ? ` (${alvo})` : ''}.`,
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Erro interno ao salvar cadastro pessoal',
      });
    }
  },

  // Busca de proprietário por e-mail para o cadastro de animal.
  // ESCOPADA À EMPRESA ATIVA: o proprietário só é considerado "encontrado" quando
  // já pertence ao escopo de quem está consultando (mesmo critério da listagem de
  // proprietários). Cliente cadastrado em OUTRA empresa não é devolvido — o vet
  // preenche os dados do zero, e cada empresa mantém os seus próprios, do mesmo
  // jeito que o animal é isolado por empresa.
  buscarProprietarioPorEmail: async (req, res) => {
    const email = normalizeEmail(req.query.email);
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
    try {
      const user = await findUserByEmail(prisma, email, {
        select: { id: true, fullName: true, phone: true, userType: true },
      });
      if (!user) return res.json({ encontrado: false });

      // ADMIN global enxerga qualquer proprietário
      if (req.user?.role !== 'ADMIN') {
        if (!req.empresaId) return res.json({ encontrado: false });
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        const noEscopo = await prisma.user.findFirst({
          where:  { id: user.id, ...whereProprietarioNoEscopo(req.empresaId, equipeScope) },
          select: { id: true },
        });
        if (!noEscopo) return res.json({ encontrado: false });
      }

      return res.json({ encontrado: true, fullName: user.fullName, phone: user.phone ?? '' });
    } catch (err) {
      console.error('[UserController.buscarProprietarioPorEmail]', err);
      return res.status(500).json({ error: 'Erro interno' });
    }
  },

alterarSenha: async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 8) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 8 caracteres' });
    }
    if (!/[A-Z]/.test(novaSenha)) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos uma letra maiúscula' });
    }
    if (!/[0-9]/.test(novaSenha)) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 número' });
    }
    if (!/[^A-Za-z0-9]/.test(novaSenha)) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 caractere especial' });
    }

    try {
      const user = await prisma.user.findUnique({
        where:  { email: req.user.email },
        select: { passwordHash: true, mustChangePassword: true },
      });

      if (!user) {
        return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      }

      // Troca obrigatória: dispensa senhaAtual se DB, JWT ou flag explícita indicarem.
      // req.body.obrigatoria=true é enviado por AlterarSenhaObrigatoria (fluxo de 1º login);
      // cobre o caso em que o JWT foi renovado sem mustChangePassword ou o DB já foi atualizado
      // por um PATCH anterior bem-sucedido mas cujo refreshUser subsequente falhou.
      const isObrigatoria = !!user.mustChangePassword || !!req.user.mustChangePassword || req.body.obrigatoria === true;
      if (!isObrigatoria) {
        if (!senhaAtual) {
          return res.status(400).json({ sucesso: false, mensagem: 'Senha atual é obrigatória' });
        }
        const valida = await bcrypt.compare(senhaAtual, user.passwordHash);
        if (!valida) {
          return res.status(401).json({ sucesso: false, mensagem: 'Senha atual incorreta' });
        }
      }

      if (await senhaReutilizada(req.user.id, novaSenha, user.passwordHash)) {
        return res.status(400).json({ sucesso: false, mensagem: MENSAGEM_SENHA_REUTILIZADA });
      }

      const hash = await bcrypt.hash(novaSenha, 10);

      await prisma.user.update({
        where: { email: req.user.email },
        data:  { passwordHash: hash, mustChangePassword: false },
      });
      await registrarTrocaSenha(req.user.id, user.passwordHash);

      return res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
    } catch (error) {
      console.error('Erro em alterarSenha:', error);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = UserController;