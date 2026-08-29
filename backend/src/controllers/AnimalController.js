// backend/src/controllers/AnimalController.js
'use strict';

const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');
const { storage }      = require('../storage');
const { getEmpresaIdDoVet, getContextoDoVet, getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { animalVisivelNaEmpresa, ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { resolverLogoPorAnimal } = require('../lib/logoEmpresaUtils');
const { garantirFaturaAberta } = require('../services/FaturaService');
const { registrarAuditoria } = require('../lib/auditoria');
const { registrarHistoricoAnimal } = require('../lib/animalHistorico');
const { ehGestorNoContexto } = require('../middlewares/permissao.middleware');
const {
  marcarInativo, marcarAtivo, animalEstaInativo,
  anexarInativo, anexarInativoEmLista,
} = require('../lib/animalInativo');
const {
  registrarAtivacao: registrarAtivacaoAnimal,
  registrarDesativacao,
  anexarTrilhaEmLista: anexarTrilhaAtivacaoEmLista,
} = require('../lib/animalAtivacao');
const { cancelarPendenciasDoAnimal } = require('../lib/cancelamentoPendencias');
const { validarMotivoTipo, exigeDescricao } = require('../lib/motivosInativacao');
const { transferirPropriedadeAnimal } = require('../lib/transferenciaPropriedadeAnimal');

const prisma = require('../lib/prisma').default;
const { normalizeEmail, findUserByEmail } = require('../lib/email');
const {
  garantirPerfil: garantirPerfilProprietario,
  salvarPerfil: salvarPerfilProprietario,
  aplicarPerfil: aplicarPerfilProprietario,
  aplicarPerfilEmRelacao: aplicarPerfilProprietarioEmRelacao,
} = require('../lib/proprietarioPerfil');

async function notificarGestoresDaEmpresa(empresaId, { animalNome, proprietarioNome, vetNome }) {
  if (!empresaId) return;
  const gestores = await prisma.membroEquipe.findMany({
    where:   { equipe: { empresaId }, cargo: 'GESTOR' },
    include: { user: { select: { email: true, fullName: true } } },
  });
  for (const gestor of gestores) {
    if (gestor.user?.email) {
      emailService.notificarGestoresAutorizacaoConcedida({
        gestorEmail:       gestor.user.email,
        gestorNome:        gestor.user.fullName || 'Gestor',
        animalNome,
        proprietarioNome,
        vetNome,
      }).catch(() => {});
    }
  }
}

const ANIMAL_INCLUDE = {
  especie:     true,
  raca:        true,
  // `phone2` entra aqui porque a tela do animal edita os DOIS telefones do cliente;
  // sem ele o campo abriria vazio e o segundo número se perderia ao salvar.
  user:        { select: { id: true, fullName: true, email: true, phone: true, phone2: true, cpf: true } },
  localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
  tratador:    { select: { id: true, nome: true, telefone: true } },
  // ⚠️ FASE 3 DO MULTI-TENANCY — `solicitacoes` saiu do include.
  // Ele vinha em TODA leitura de animal e era a fonte dos selos "Pendente"/"Remoção
  // pendente"/"Troca pendente" e do seletor de veterinário responsável. Sem vínculo não
  // há estado a exibir — o responsável é o campo `veterinarioNome` do próprio animal.
  // Junto saíram `gerarToken`/`gerarExpiracao`, que só serviam ao token de aprovação
  // de 24h dos e-mails de vínculo/desvínculo.
};

const obterUserType = async (userId) => {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  return { userType: u?.userType ?? 'PROPRIETARIO', role: u?.role ?? 'USER' };
};

// ⚠️ FASE 3 DO MULTI-TENANCY — os helpers `criarSolicitacaoPendente` e
// `vincularVetDireto` foram REMOVIDOS daqui, junto de todos os seus chamadores.
//
// O primeiro criava a solicitação PENDENTE (VINCULO/TROCA_VET) com token de aprovação
// e disparava o e-mail ao veterinário ou ao proprietário; o segundo criava o vínculo
// já ACEITO e, de quebra, MOVIA o animal para a empresa do vet escolhido.
//
// Não existe mais acesso individual a paciente para conceder, pedir ou retirar: quem
// dá acesso é a EMPRESA a que o animal pertence. Não reintroduzir.

// ─── Regra de baia ───────────────────────────────────────────────────────────
// Baia única por LOCAL, dentro do que o usuário PODE VER.
//
// O escopo NÃO é `empresaId` cru: um vet pode atender legitimamente um animal cujo
// registro pertence a outra clínica (premissa multi-empresa). Escopar por empresa
// deixaria a baia desse animal aparecer como livre para o próprio vet que o atende.
// Por isso usamos `buildAnimalScopeWhere` — a MESMA fonte de verdade da listagem de
// pacientes. Consequência: a checagem jamais lê um animal que o usuário não poderia
// ver de qualquer forma (nenhum dado atravessa a fronteira entre empresas), e ao
// mesmo tempo enxerga os animais que ele de fato atende.
//
// O local casa por localizacaoId (FK, confiável); cai no texto `local` para legado.
function escopoLocalBaia({ localizacaoId, local }) {
  if (localizacaoId) return { localizacaoId: Number(localizacaoId) };
  const txt = local?.trim();
  return txt ? { local: { equals: txt, mode: 'insensitive' } } : { local: null };
}

// Procura quem ocupa a baia dentro do escopo visível de `req`.
// `ignorarId` exclui o próprio registro (edição).
async function acharOcupanteDaBaia(req, { baia, localizacaoId, local, ignorarId }) {
  const { where: escopoVisivel } = await buildAnimalScopeWhere(req);
  return prisma.animal.findFirst({
    where: {
      AND: [
        escopoVisivel,
        {
          baia:  { equals: String(baia).trim(), mode: 'insensitive' },
          ativo: true,
          ...escopoLocalBaia({ localizacaoId, local }),
          ...(ignorarId && !isNaN(ignorarId) ? { id: { not: Number(ignorarId) } } : {}),
        },
      ],
    },
    select: { id: true, nome: true },
  });
}

// Passaporte/registro único por EMPRESA (clínica). Ao contrário da baia
// (acharOcupanteDaBaia, que usa buildAnimalScopeWhere — o que o VET VÊ, inclusive de
// outras empresas), aqui o escopo é sempre `empresaId` cru: a regra é "dentro da mesma
// clínica", não "dentro do que o usuário enxerga". Ignora animal com ativo:false —
// exclusão lógica (CLAUDE.md §5) libera o passaporte para reuso na mesma empresa.
async function acharAnimalComMesmoPassaporte({ empresaId, registroPassaporte, ignorarId }) {
  const valor = String(registroPassaporte ?? '').trim();
  if (!valor || !empresaId) return null;
  return prisma.animal.findFirst({
    where: {
      empresaId: Number(empresaId),
      ativo:     true,
      registroPassaporte: { equals: valor, mode: 'insensitive' },
      ...(ignorarId && !isNaN(ignorarId) ? { id: { not: Number(ignorarId) } } : {}),
    },
    select: { id: true, nome: true },
  });
}

class AnimalController {

  // ── GET /api/animais/buscar-por-nome?nome=X ──────────────────────────────
  // DEVE ser registrado ANTES de /:id nas rotas

  // GET /api/animais/verificar-baia?baia=&local=&localizacaoId=&animalId=
  // Checagem em tempo de preenchimento (não altera nada). Usa a MESMA regra de
  // criar/atualizar: baia única por LOCAL (ver escopoLocalBaia). `animalId` exclui
  // o próprio registro, para a edição não acusar conflito consigo mesma.
  async verificarBaia(req, res) {
    try {
      const baia = String(req.query.baia ?? '').trim();
      // Sem baia informada não há o que validar
      if (!baia) return res.json({ sucesso: true, dados: { disponivel: true } });

      const ocupante = await acharOcupanteDaBaia(req, {
        baia,
        localizacaoId: req.query.localizacaoId || null,
        local:         String(req.query.local ?? '').trim() || null,
        ignorarId:     req.query.animalId || null,
      });

      return res.json({
        sucesso: true,
        dados: ocupante
          ? { disponivel: false, ocupadaPor: ocupante.nome }
          : { disponivel: true },
      });
    } catch (error) {
      console.error('[AnimalController.verificarBaia]', error);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao verificar disponibilidade da baia' });
    }
  }

  async buscarPorNome(req, res) {
      const { nome } = req.query;
      if (!nome?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome obrigatório' });
      }

      try {
        const animais = await prisma.animal.findMany({
          // ANIMAL_VISIVEL (não a variante por empresa): a busca cruza empresas de
          // propósito (detecção de duplicata) e não é o caso de aplicar o `ativo`
          // POR EMPRESA do dono, que só faz sentido comparado à empresa do PRÓPRIO
          // animal, não à de quem pesquisa.
          where:   { nome: { contains: nome.trim(), mode: 'insensitive' }, ...ANIMAL_VISIVEL },
          include: {
            user:        { select: { id: true, fullName: true, email: true, phone: true } },
            especie:     { select: { id: true, nome: true } },
            raca:        { select: { id: true, nome: true } },
            localizacao: { select: { id: true, nome: true } },
            tratador:    { select: { id: true, nome: true } },
          },
          take: 10,
        });

        if (animais.length === 0) {
          return res.json({ sucesso: true, dados: null });
        }

        // Prioriza o registro da EMPRESA ATIVA: com o mesmo nome cadastrado em mais de
        // uma clínica, o que interessa aqui é o desta — pegar o de outra empresa
        // esconderia um conflito real e traria dados de fora do escopo.
        const empresaAtivaId = req.empresaId ? Number(req.empresaId) : null;
        const nomeExato = (a) => a.nome.toLowerCase() === nome.trim().toLowerCase();
        const daEmpresa = (a) => empresaAtivaId != null && a.empresaId === empresaAtivaId;

        const animal =
          animais.find(a => daEmpresa(a) && nomeExato(a))
          ?? animais.find(daEmpresa)
          ?? animais.find(nomeExato)
          ?? animais[0];

        // ── O animal já é da minha clínica? ────────────────────────────────
        // A pergunta é de EMPRESA, e SÓ de empresa. O cadastro do animal (e o do
        // proprietário) é isolado por empresa, então
        //   • animal DESTA empresa   → é da casa, não se duplica;
        //   • animal de OUTRA        → independente, sempre. Não importa o cargo que o
        //     vet do animal tenha aqui nem o que eu tenha lá (posso ser prestador na
        //     clínica dele e gestor na minha, ou o contrário).
        //
        // ⚠️ FASE 3 DO MULTI-TENANCY — saíram daqui `temVet` e `vetDaMinhaEquipe`, que
        // liam `VetAnimalSolicitacao` para responder "existe vet ativo?" e "esse vet é
        // da minha equipe?". Eram a pergunta ERRADA: quem responde por um paciente é a
        // clínica, não a pessoa. Um animal desta empresa sem vet designado voltava como
        // "sem_vet" e era DUPLICADO por quem o cadastrasse de novo.
        const mesmaEmpresa = empresaAtivaId != null && animal.empresaId === empresaAtivaId;
        const outraEmpresa = empresaAtivaId != null && animal.empresaId != null
          && animal.empresaId !== empresaAtivaId;

        // Animal LEGADO (sem `empresaId`) não pertence a clínica nenhuma que se possa
        // provar — trata-se como NÃO sendo desta, para que o cadastro siga. O caminho
        // inverso travaria o registro sem nenhuma saída na tela.
        const jaCadastradoAqui = mesmaEmpresa;

        // IDENTIDADE do animal: atributos do próprio bicho, iguais em qualquer clínica.
        // Podem pré-preencher o cadastro mesmo vindo de outra empresa.
        const identidade = {
          id:              animal.id,
          nome:            animal.nome,
          dataNascimento:  animal.dataNascimento  ?? null,
          idadeAnos:       animal.idadeAnos       ?? null,
          sexo:            animal.sexo            ?? null,
          especieId:       animal.especieId       ?? null,
          racaId:          animal.racaId          ?? null,
          especie:         animal.especie         ?? null,
          raca:            animal.raca            ?? null,
          pelagem:         animal.pelagem         ?? null,
          altura:          animal.altura          ?? null,
          registroPassaporte: animal.registroPassaporte ?? null,
          numeroChip:      animal.numeroChip      ?? null,
        };

        // CADASTRO OPERACIONAL: o que descreve como AQUELA clínica trata o animal.
        // `tratador` e `localizacao` são linhas de tb_tratadores / tb_localizacoes_animal,
        // que têm `empresaId` próprio — devolvê-las entregava um cadastro inteiro de
        // outra empresa (nome do tratador, haras onde o animal está) para quem só
        // digitou um nome na busca. Junto vão baia, peso, foto, seguradora, finalidade
        // e categoria/exercício: são a operação e o contrato comercial da outra clínica,
        // não a identidade do animal.
        const operacional = outraEmpresa ? {} : {
          photoUrl:           animal.photoUrl        ?? null,
          peso:               animal.peso            ?? null,
          categoriaAnimal:    animal.categoriaAnimal ?? null,
          tipoExercicio:      animal.tipoExercicio   ?? null,
          baia:               animal.baia            ?? null,
          local:              animal.local           ?? null,
          localizacaoId:      animal.localizacaoId   ?? null,
          localizacao:        animal.localizacao     ?? null,
          tratadorId:         animal.tratadorId      ?? null,
          tratador:           animal.tratador        ?? null,
          finalidade:         animal.finalidade      ?? null,
          seguradora:         animal.seguradora      ?? null,
        };

        res.json({
          sucesso: true,
          dados: {
            ...identidade,
            ...operacional,
            jaCadastradoAqui,
            // NÃO devolvemos o proprietário do registro de origem: o cadastro em
            // outra empresa é isolado (animal e proprietário), e devolver aqui
            // vazaria o cliente de outra clínica para quem só pesquisou um nome.
          },
        });
      } catch (error) {
        console.error('[AnimalController.buscarPorNome]', error);
        res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
      }
    }

  // ⚠️ FASE 3 DO MULTI-TENANCY — MÉTODOS DE VÍNCULO REMOVIDOS:
  //   proprietarioAprovar     (rota PÚBLICA por token do e-mail)
  //   minhasSolicitacoes      (polling do proprietário)
  //   vincularVet / desvincularVet
  //   cancelarSolicitacao / responderSolicitacaoVet
  // As rotas já haviam saído de routes/animais.js; estes eram os corpos órfãos.
  // Não recriar: o acesso ao paciente vem de ele pertencer à EMPRESA.

  async listar(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado' });

      // Escopo base × convidado (fonte única — lib/animalScope). O veterinário vinculado
      // (convidado) só vê os seus animais + os liberados por outros vets na empresa ativa.
      const { where } = await buildAnimalScopeWhere(req);

      // EXCLUSÃO LÓGICA (lib/visibilidade.js): o animal inativado some, e o do CLIENTE
      // inativado some junto — nem como "inativo" ele aparece. `animalVisivelNaEmpresa`
      // aplica também o `ativo` POR EMPRESA do cliente (§36): inativado numa clínica,
      // ele continua visível nas outras.
      //
      // Exceção: a aba Ativos/Inativos/Todos da tela de Pacientes precisa enxergar
      // `ativo:false` — mas SÓ para gestor/admin do contexto, senão a aba vazaria
      // pacientes excluídos para qualquer perfil que soubesse mandar `?ativo=`.
      const visivel = animalVisivelNaEmpresa(req.empresaId);
      let whereAtivo = visivel;
      if (ehGestorNoContexto(req) && req.query.ativo !== undefined) {
        const { ativo: _ignorado, ...visivelSemAtivo } = visivel;
        if (req.query.ativo === 'all') whereAtivo = visivelSemAtivo;
        else whereAtivo = { ...visivelSemAtivo, ativo: req.query.ativo === 'true' };
      }

      let animais = await prisma.animal.findMany({
        where: { ...where, ...whereAtivo },
        include:  ANIMAL_INCLUDE,
        orderBy:  { dataCadastro: 'desc' },
      });

      // Nome/telefone do proprietário conforme o cadastro DESTA empresa
      await anexarInativoEmLista(animais);
      // Trilha de ativação/desativação (quem, quando) — abas Ativos/Inativos da tela.
      // ⚠️ `anexarTrilhaEmLista` (animalAtivacao.js) devolve uma lista NOVA (`.map`),
      // ao contrário de `anexarInativoEmLista` (que muta os itens in-place) — sem
      // reatribuir aqui, a trilha era calculada e descartada, e a coluna "Ativado
      // em/por" e "Inativado em/por" da tela de Pacientes nunca recebia dado nenhum.
      animais = await anexarTrilhaAtivacaoEmLista(animais);
      res.json({
        sucesso: true,
        dados:   await aplicarPerfilProprietarioEmRelacao(animais, 'user', req.empresaId),
      });
    } catch (error) {
      console.error('[AnimalController.listar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar animais' });
    }
  }

  // ── GET /api/animais/:id ─────────────────────────────────────────────────

  async obterPorId(req, res) {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ sucesso: false, mensagem: 'ID inválido' });
    }
    try {
      const animal = await prisma.animal.findUnique({
        where:   { id },
        include: ANIMAL_INCLUDE,
      });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });

      // Exclusão lógica (Animal.ativo — "some de tudo"): só o gestor/admin pode abrir
      // o cadastro de um animal desativado (revisar antes de reativar, na tela de
      // Pacientes). Para qualquer outro perfil, um animal desativado é 404 — mesmo
      // com acesso de tenant/vínculo ao registro.
      if (!animal.ativo && !ehGestorNoContexto(req)) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      // Controle de acesso centralizado — cobre PROPRIETARIO, empresa (gestores), e vínculo direto
      if (req.user?.id) {
        const acesso = await verificarAcessoAnimal({ animalId: id, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
        if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
        if (!acesso)        return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });
      }

      await anexarInativo(animal);
      res.json({
        sucesso: true,
        dados:   animal?.user
          ? { ...animal, user: await aplicarPerfilProprietario(animal.user, req.empresaId) }
          : animal,
      });
    } catch (error) {
      console.error('[AnimalController.obterPorId]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar animal' });
    }
  }

  // ── GET /api/animais/:id/logo-empresa ────────────────────────────────────
  // Logo da empresa/equipe do animal — usado nos relatórios/impressões (dieta,
  // evolução, prescrição, exame etc.) em vez da marca S2Vet. Acesso liberado para
  // qualquer perfil com acesso ao animal (não só GESTOR — diferente de
  // /equipes/configuracoes, que é gestor-only).
  async obterLogoEmpresa(req, res) {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ sucesso: false, mensagem: 'ID inválido' });
    }
    try {
      const acesso = await verificarAcessoAnimal({ animalId: id, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)        return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Mesma trava de `obterPorId`: animal desativado só é alcançável pelo gestor.
      if (!ehGestorNoContexto(req)) {
        const alvo = await prisma.animal.findUnique({ where: { id }, select: { ativo: true } });
        if (!alvo?.ativo) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      const logoUrl = await resolverLogoPorAnimal(id);
      res.json({ dados: { logoUrl } });
    } catch (error) {
      console.error('[AnimalController.obterLogoEmpresa]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar logo' });
    }
  }

  // ── POST /api/animais ────────────────────────────────────────────────────

  async criar(req, res) {
    const {
      nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      proprietarioId, veterinarioUserId, local, baia, localizacaoId, tratadorId,
      pelagem, altura, registroPassaporte, numeroChip, finalidade, seguradora,
    } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const { userType, role } = await obterUserType(req.user.id);
      const isVet             = userType === 'VETERINARIO';
      const isAdminCriando    = role === 'ADMIN' && userType !== 'PROPRIETARIO';

      // Busca nome completo do vet no banco (não está no JWT)
      const vetLogado = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: { fullName: true },
      });
      const vetNomeCompleto = vetLogado?.fullName || 'Veterinário';
      // Obtido aqui para estar disponível em todos os caminhos do vet (nao_encontrado, sem_vet, etc.)
      const vetCtx = isVet
        ? await getContextoDoVet(req.user.id, req.empresaId, req.equipeId)
        : { empresaId: null, equipeId: null };
      const vetEmpresaId = vetCtx.empresaId;
      const vetEquipeId  = vetCtx.equipeId;

      // ⚠️ FASE 3 DO MULTI-TENANCY — o ramo "vet vincula animal JÁ EXISTENTE" foi
      // REMOVIDO daqui (req.body.animalExistenteId + pedirAutorizacao). Ele criava
      // `VetAnimalSolicitacao` (PENDENTE ou ACEITO direto), marcava o animal como
      // `bloqueado: AGUARDANDO_APROVACAO` e disparava e-mail de vínculo ao proprietário.
      //
      // Nada disso existe mais: animal de OUTRA empresa é INDEPENDENTE, e o cadastro
      // aqui cria um registro próprio desta clínica (buscarPorNome devolve
      // `jaCadastradoAqui`, e a tela só bloqueia quando ele já é desta empresa).
      // O frontend já não enviava nenhum dos dois campos — não reintroduzir.

      // ── Criação de novo animal ──────────────────────────────────────────

      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );
      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      let targetUserId              = req.user.id;
      let proprietarioNomeParaEmail = 'Proprietário';
      let proprietarioEmailParaEmail = null;
      let isNewProprietario = false;

            // Somente ADMIN pode redirecionar a criação para outro proprietário
            if (proprietarioId && isAdminCriando) {
              targetUserId = Number(proprietarioId);
              const prop = await prisma.user.findUnique({
                where:  { id: Number(proprietarioId) },
                select: { fullName: true, email: true },
              });
              proprietarioNomeParaEmail  = prop?.fullName || 'Proprietário';
              proprietarioEmailParaEmail = prop?.email    || null;

            } else if (req.body.proprietario) {
              const propData = typeof req.body.proprietario === 'string'
                ? JSON.parse(req.body.proprietario)
                : req.body.proprietario;

              if (propData?.email) {
                const emailProp = normalizeEmail(propData.email);
                let prop = await findUserByEmail(prisma, emailProp);
                if (!prop) {
                  prop = await prisma.user.create({
                    data: {
                      fullName:           propData.fullName || 'Proprietário',
                      email:              emailProp,
                      phone:              propData.phone  || null,
                      phone2:             propData.phone2 || null,
                      passwordHash:       await bcrypt.hash('Inicial#001', 10),
                      role:               'USER',
                      userType:           'PROPRIETARIO',
                      mustChangePassword: true,
                      empresaId:          vetEmpresaId || null,
                      equipeId:           vetEquipeId  || null,
                    },
                  });
                  isNewProprietario = true;
                }

                // Cadastro do cliente NESTA empresa. Se o proprietário já existe
                // (atendido por outra clínica), esta empresa passa a ter o próprio
                // perfil com os dados que o vet digitou — sem herdar nem alterar o
                // cadastro da outra. Já existindo perfil aqui, ele é preservado.
                if (vetEmpresaId) {
                  await garantirPerfilProprietario(prisma, prop.id, vetEmpresaId, {
                    fullName: propData.fullName || prop.fullName || 'Proprietário',
                    phone:    propData.phone  || null,
                    phone2:   propData.phone2 || null,
                    ativo:    true,
                  });

                  // 🔴 REATIVA o cliente NESTA empresa. `garantirPerfil` só aplica o
                  // seed (com `ativo:true`) na CRIAÇÃO; se o cliente já tinha cadastro
                  // aqui e foi INATIVADO antes (ex.: `removerDaEmpresa`), o perfil é
                  // preservado como está — `ativo=false`. O animal nasceria ATIVO com
                  // DONO INATIVO, quebrando o invariante "dono de animal ativo é cliente
                  // ativo da empresa", e o filtro de visibilidade (§36) o esconderia da
                  // lista — sintoma exato do Horse1 (paciente cadastrado que não aparece).
                  // Só toca `ativo`; nome/telefone/documento seguem preservados.
                  await salvarPerfilProprietario(prisma, prop.id, vetEmpresaId, { ativo: true });

                  // Cliente que JÁ tinha cadastro nesta empresa: `garantirPerfil`
                  // preserva o perfil, então o telefone digitado aqui seria descartado
                  // em silêncio. O contato é o único campo que esta tela atualiza —
                  // nome e documento continuam sendo assunto do Cadastro de Cliente.
                  // Só grava o que veio PREENCHIDO: campo vazio no formulário do animal
                  // não pode APAGAR o telefone que a clínica já tem.
                  const contato = {};
                  const phoneNovo  = String(propData.phone  ?? '').trim();
                  const phone2Novo = String(propData.phone2 ?? '').trim();
                  if (phoneNovo)  contato.phone  = phoneNovo;
                  if (phone2Novo) contato.phone2 = phone2Novo;
                  if (Object.keys(contato).length) {
                    await salvarPerfilProprietario(prisma, prop.id, vetEmpresaId, contato);
                  }
                }

                targetUserId               = prop.id;
                proprietarioNomeParaEmail  = propData.fullName || prop.fullName;
                proprietarioEmailParaEmail = prop.email;
              }
            } else {
              const prop = await prisma.user.findUnique({
                where:  { id: Number(targetUserId) },
                select: { fullName: true, email: true },
              });
              proprietarioNomeParaEmail  = prop?.fullName || 'Proprietário';
              proprietarioEmailParaEmail = prop?.email    || null;
            }

      // Contexto de DONO do arquivo — é o que /api/midia usa para autorizar. Na
      // CRIAÇÃO o animal ainda não existe, então o arquivo nasce com a empresa e é
      // amarrado ao animal logo após o insert (ver `vincularFotoAoAnimal`).
      let photoUrl = req.file
        ? await storage.upload(req.file, 'animais', { empresaId: req.empresaId ?? null, criadoPorId: req.user?.id ?? null })
        : null;

      // Duplicação de animal existente (novo registro para outro vet): sem foto
      // nova enviada, reaproveita a foto do animal de origem
      if (!photoUrl && req.body.animalOrigemId) {
        const origem = await prisma.animal.findUnique({
          where:  { id: Number(req.body.animalOrigemId) },
          select: { photoUrl: true },
        });
        photoUrl = origem?.photoUrl ?? null;
      }

      const criadoParaSiMesmo = isVet && Number(targetUserId) === Number(req.user.id);

      // Validação de baia: única por LOCAL dentro do escopo visível — ver acharOcupanteDaBaia.
      if (baia?.trim()) {
        const localNorm = local?.trim() || null;
        const ocupante  = await acharOcupanteDaBaia(req, {
          baia: baia.trim(), localizacaoId, local: localNorm,
        });
        if (ocupante) {
          const localLabel = localNorm ? ` (${localNorm})` : '';
          return res.status(409).json({ sucesso: false, mensagem: `A baia "${baia.trim()}"${localLabel} já está ocupada por ${ocupante.nome}` });
        }
      }

      // 🔴 GUARDA ANTI-ÓRFÃO: todo animal PRECISA de empresa (`tb_animais.empresa_id` é
      // NOT NULL desde a fase 5). Sem `vetEmpresaId` resolvido, `empresaId: undefined`
      // omitia o campo e o INSERT dava HTTP 500 do Postgres — e, se a coluna aceitasse,
      // nasceria um paciente SEM DONO, o registro órfão que a arquitetura proíbe. Falha
      // aqui, com mensagem clara, em vez de deixar o banco recusar de forma opaca.
      if (!vetEmpresaId) {
        return res.status(400).json({
          error: 'Não foi possível resolver a empresa do contexto para cadastrar o animal. Selecione a clínica ativa e tente novamente.',
          code:  'EMPRESA_NAO_RESOLVIDA',
        });
      }

      // Passaporte/registro único por empresa — ver acharAnimalComMesmoPassaporte.
      if (registroPassaporte?.trim()) {
        const duplicata = await acharAnimalComMesmoPassaporte({
          empresaId: vetEmpresaId,
          registroPassaporte,
        });
        if (duplicata) {
          return res.status(409).json({
            sucesso:  false,
            mensagem: `O registro/passaporte "${registroPassaporte.trim()}" já está cadastrado para ${duplicata.nome} nesta clínica`,
          });
        }
      }

      const animal = await prisma.animal.create({
        data: {
          nome:            nome.trim(),
          peso:            parseFloat(peso) || 0,
          dataNascimento:  dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:       dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          local:          local?.trim() || null,
          baia:           baia?.trim()  || null,
          localizacaoId:  localizacaoId ? Number(localizacaoId) : null,
          tratadorId:     tratadorId    ? Number(tratadorId)    : null,
          pelagem:            pelagem?.trim()            || null,
          altura:             altura?.trim()             || null,
          registroPassaporte: registroPassaporte?.trim() || null,
          numeroChip:         numeroChip?.trim()         || null,
          finalidade:         finalidade?.trim()         || null,
          seguradora:         seguradora?.trim()         || null,
          photoUrl,
          especieId:  Number(especieId),
          racaId:     Number(racaId),
          userId:     Number(targetUserId),
          empresaId:  vetEmpresaId ?? undefined,
          equipeId:   vetEquipeId  ?? undefined,
        },
      });

      // Ponto de partida do histórico de peso/local/baia (gráfico em AnimalDetail).
      await registrarHistoricoAnimal(prisma, {
        animalId: animal.id,
        antes:    null,
        depois:   { peso: animal.peso, localizacaoId: animal.localizacaoId, local: animal.local, baia: animal.baia },
        criadoPorId: req.user?.id ?? null,
      });

      // Janela ABERTA de propriedade — ponto de partida para a Transferência de
      // Propriedade e para a Exportação por período (ver lib/transferenciaPropriedadeAnimal.js).
      await prisma.animalProprietarioHistorico.create({
        data: {
          animalId:       animal.id,
          proprietarioId: Number(targetUserId),
          dataInicio:     animal.dataCadastro,
          empresaId:      animal.empresaId,
          criadoPorId:    req.user?.id ?? null,
        },
      });

      // Animal nasce ativo=true (default do schema): registra a trilha de ativação
      // também na CRIAÇÃO, senão "Ativado em/por" (Pacientes.tsx) fica vazio até
      // alguém desativar e reativar o registro — quem o criou não aparecia ali.
      if (req.user?.id) {
        await registrarAtivacaoAnimal(prisma, animal.id, req.user.id);
      }

      if (isVet) {
        // ⚠️ FASE 3 DO MULTI-TENANCY — o `VetAnimalSolicitacao` que nascia aqui (VINCULO
        // ACEITO, nos dois ramos) foi REMOVIDO. Ele não autorizava nada: o animal já é
        // criado com `empresaId`/`equipeId` do contexto do vet (ver o `create` acima), e
        // é a EMPRESA que dá acesso ao paciente. O vínculo só duplicava essa informação
        // numa segunda tabela — e era essa cópia que, lida como "meu paciente
        // independente de empresa", abria o registro de uma clínica para outra.
        if (criadoParaSiMesmo) {
          await garantirFaturaAberta(Number(targetUserId));
        } else {
          // PREMISSA MULTI-EMPRESA: um animal pode ser atendido por mais de uma empresa
          // e um proprietário pode estar em mais de uma. Cadastrar um animal que já
          // existe gera um REGISTRO NOVO, que pertence a quem cadastrou — por isso ele
          // NUNCA nasce bloqueado aguardando aprovação: a empresa precisa atendê-lo de
          // imediato. O proprietário é apenas informado por e-mail.
          const empIdNovo = vetEmpresaId;
          let clinicaNomeNovo = null;
          if (empIdNovo) {
            const empresaNova = await prisma.empresa.findUnique({ where: { id: empIdNovo }, select: { nome: true } });
            clinicaNomeNovo = empresaNova?.nome ?? null;
          }

          // `veterinarioNome`/`veterinarioClinica` são apenas os campos de EXIBIÇÃO do
          // responsável — não concedem acesso a nada.
          await prisma.animal.update({
            where: { id: animal.id },
            data:  {
              veterinarioNome:    vetNomeCompleto,
              veterinarioClinica: clinicaNomeNovo,
            },
          });

          await garantirFaturaAberta(Number(targetUserId));

          // E-mail meramente informativo ao proprietário (sem link de aprovação).
          // Proprietário recém-criado recebe também a senha inicial de acesso.
          if (proprietarioEmailParaEmail) {
            emailService.enviarVinculoInformativo({
              proprietarioEmail: proprietarioEmailParaEmail,
              proprietarioNome:  proprietarioNomeParaEmail,
              animalNome:        animal.nome,
              vetNome:           vetNomeCompleto,
              isNewUser:         isNewProprietario,
              senhaInicial:      isNewProprietario ? 'Inicial#001' : undefined,
            })
              .then(() => console.log(`[emailService] Email informativo enviado → ${proprietarioEmailParaEmail}`))
              .catch(err => console.error('[emailService] FALHA ao enviar informativo:', err?.message ?? err));
          } else {
            console.warn('[emailService] Proprietário sem email — notificação informativa não enviada');
          }
        }
      }

      // ⚠️ FASE 3 — `veterinarioUserId` não é mais lido no cadastro. Ele existia para o
      // PROPRIETÁRIO escolher um veterinário, e `vincularVetDireto` então MOVIA o animal
      // para a empresa daquele vet (`empresaId: ctx.empresaId`). Era uma parte colocando
      // o registro dentro do tenant da outra, sem que a clínica decidisse nada — o oposto
      // do isolamento por empresa. O campo saiu junto do seletor na tela.

      res.status(201).json({ sucesso: true, dados: animal });
    } catch (error) {
      console.error('[AnimalController.criar]', error);
      // (o tratamento de VET_MEMBRO_SEM_RESPONSABILIDADE saiu com `vincularVetDireto`,
      //  único ponto que lançava esse erro)
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao criar animal' });
    }
  }

  // ── PUT /api/animais/:id ─────────────────────────────────────────────────

  async atualizar(req, res) {
    const animalId = Number(req.params.id);
    const {
      nome, especieId, racaId, peso, dataNascimento, idadeAnos, sexo,
      categoriaAnimal, tipoExercicio, veterinarioNome, veterinarioClinica,
      veterinarioUserId, local, baia, localizacaoId, tratadorId,
      pelagem, altura, registroPassaporte, numeroChip, finalidade, seguradora,
      removerFoto,
    } = req.body;

    if (!nome?.trim())                    return res.status(400).json({ sucesso: false, mensagem: 'Nome do animal é obrigatório' });
    if (!especieId)                       return res.status(400).json({ sucesso: false, mensagem: 'Espécie é obrigatória' });
    if (!racaId || isNaN(Number(racaId))) return res.status(400).json({ sucesso: false, mensagem: 'Raça é obrigatória' });
    if (!dataNascimento && !idadeAnos)    return res.status(400).json({ sucesso: false, mensagem: 'Informe a data de nascimento ou a idade' });

    try {
      const acessoAtu = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acessoAtu === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acessoAtu)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Paciente INATIVO é somente leitura — nem o próprio cadastro pode ser editado.
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({
          sucesso: false, mensagem: 'Paciente inativo — reative com o gestor antes de editar o cadastro.',
          code: 'PACIENTE_INATIVO',
        });
      }

      const especie  = await prisma.especie.findUnique({ where: { id: Number(especieId) } });
      const isEquino = especie && (
        especie.nome.toLowerCase().includes('equino') ||
        especie.nome.toLowerCase().includes('cavalo')
      );
      if (isEquino && (!categoriaAnimal || !tipoExercicio)) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Categoria e tipo de exercício são obrigatórios para equinos',
        });
      }

      // ⚠️ FASE 3 DO MULTI-TENANCY — saiu daqui a máquina de TROCA de veterinário:
      // a leitura do vínculo ACEITO atual, `vetMudou` (que chamava `vincularVetDireto` e
      // movia o animal para a empresa do vet escolhido) e `vetRemovido` (que criava um
      // DESVINCULO PENDENTE com token de 24h e mandava e-mail ao veterinário pedindo que
      // aceitasse perder o acesso). O acesso ao paciente é da EMPRESA: não há acesso
      // individual para conceder nem para retirar, logo não há o que aprovar.
      const animalAtual = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: {
          userId: true, empresaId: true, photoUrl: true,
          peso: true, localizacaoId: true, local: true, baia: true,
          user: { select: { fullName: true, email: true, phone: true } },
        },
      });

      // Validação de baia: única por LOCAL dentro do escopo visível — ver acharOcupanteDaBaia.
      if (baia?.trim()) {
        const localNorm = local?.trim() || null;
        const ocupante  = await acharOcupanteDaBaia(req, {
          baia: baia.trim(), localizacaoId, local: localNorm, ignorarId: animalId,
        });
        if (ocupante) {
          const localLabel = localNorm ? ` (${localNorm})` : '';
          return res.status(409).json({ sucesso: false, mensagem: `A baia "${baia.trim()}"${localLabel} já está ocupada por ${ocupante.nome}` });
        }
      }

      // Passaporte/registro único por empresa — ver acharAnimalComMesmoPassaporte.
      if (registroPassaporte?.trim()) {
        const duplicata = await acharAnimalComMesmoPassaporte({
          empresaId: animalAtual?.empresaId,
          registroPassaporte,
          ignorarId: animalId,
        });
        if (duplicata) {
          return res.status(409).json({
            sucesso:  false,
            mensagem: `O registro/passaporte "${registroPassaporte.trim()}" já está cadastrado para ${duplicata.nome} nesta clínica`,
          });
        }
      }

      // Contato do proprietário editado na própria tela do animal. É o ÚNICO dado do
      // cliente que ela grava — nome, documento e endereço seguem sendo do Cadastro de
      // Cliente, e o dono do animal não se troca por aqui. Grava no cadastro DESTA
      // empresa (CLAUDE.md §36), nunca no `users`. Campo vazio é IGNORADO: salvar o
      // animal com o telefone em branco não pode apagar o número que a clínica tem.
      if (req.empresaId && req.body.proprietario && animalAtual?.userId) {
        const propData = typeof req.body.proprietario === 'string'
          ? JSON.parse(req.body.proprietario)
          : req.body.proprietario;
        const contato = {};
        const phoneNovo  = String(propData?.phone  ?? '').trim();
        const phone2Novo = String(propData?.phone2 ?? '').trim();
        if (phoneNovo)  contato.phone  = phoneNovo;
        if (phone2Novo) contato.phone2 = phone2Novo;
        if (Object.keys(contato).length) {
          // ⚠️ `garantirPerfil` ANTES do `salvarPerfil`: cliente LEGADO pode não ter
          // perfil nesta empresa, e um upsert só com o telefone criaria a linha com
          // `fullName` nulo — que, pela regra do §36 (null = vazio NAQUELA empresa,
          // não cai de volta no User), APAGARIA o nome do cliente na clínica.
          await garantirPerfilProprietario(prisma, animalAtual.userId, req.empresaId, {
            fullName: animalAtual.user?.fullName ?? null,
            phone:    animalAtual.user?.phone    ?? null,
            ativo:    true,
          });
          await salvarPerfilProprietario(prisma, animalAtual.userId, req.empresaId, contato);
        }
      }

      // `undefined` = não mexe no que já está gravado (padrão do spread condicional
      // abaixo). Só os dois casos explícitos abaixo tocam a coluna: arquivo novo
      // (troca, apagando o antigo do storage) ou remoção pedida pela tela (botão
      // "Remover foto" em Animal.tsx) — mesmo padrão do logo da empresa em
      // EquipeController.salvarConfiguracao.
      let photoUrl;
      if (req.file) {
        photoUrl = await storage.upload(req.file, 'animais', {
          empresaId:   req.empresaId ?? null,
          animalId,
          criadoPorId: req.user?.id ?? null,
        });
        if (animalAtual?.photoUrl) await storage.delete(animalAtual.photoUrl);
      } else if (removerFoto === 'true' || removerFoto === true) {
        if (animalAtual?.photoUrl) await storage.delete(animalAtual.photoUrl);
        photoUrl = null;
      }

      const animal = await prisma.animal.update({
        where: { id: animalId },
        data: {
          nome:            nome.trim(),
          peso:            parseFloat(peso) || 0,
          dataNascimento:  dataNascimento ? new Date(dataNascimento) : null,
          idadeAnos:       dataNascimento ? null : (Number(idadeAnos) || null),
          sexo,
          categoriaAnimal: isEquino ? (categoriaAnimal || null) : null,
          tipoExercicio:   isEquino ? (tipoExercicio   || null) : null,
          veterinarioNome:    veterinarioNome    || null,
          veterinarioClinica: veterinarioClinica || null,
          local:          local?.trim() || null,
          baia:           baia?.trim()  || null,
          localizacaoId:  localizacaoId !== undefined ? (localizacaoId ? Number(localizacaoId) : null) : undefined,
          tratadorId:     tratadorId    !== undefined ? (tratadorId    ? Number(tratadorId)    : null) : undefined,
          pelagem:            pelagem?.trim()            ?? null,
          altura:             altura?.trim()             ?? null,
          registroPassaporte: registroPassaporte?.trim() ?? null,
          numeroChip:         numeroChip?.trim()         ?? null,
          finalidade:         finalidade?.trim()         ?? null,
          seguradora:         seguradora?.trim()         ?? null,
          especieId: Number(especieId),
          racaId:    Number(racaId),
          ...(photoUrl !== undefined && { photoUrl }),
        },
      });

      // Histórico de peso/local/baia (gráfico em AnimalDetail) — só grava quando algo
      // dos três realmente mudou (ver registrarHistoricoAnimal).
      await registrarHistoricoAnimal(prisma, {
        animalId,
        antes:  { peso: animalAtual.peso, localizacaoId: animalAtual.localizacaoId, local: animalAtual.local, baia: animalAtual.baia },
        depois: { peso: animal.peso, localizacaoId: animal.localizacaoId, local: animal.local, baia: animal.baia },
        criadoPorId: req.user?.id ?? null,
      });

      const animalAtualizado = await prisma.animal.findUnique({
        where:   { id: animalId },
        include: ANIMAL_INCLUDE,
      });
      res.json({ sucesso: true, dados: animalAtualizado });
    } catch (error) {
      console.error('[AnimalController.atualizar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao atualizar animal' });
    }
  }

  // ── DELETE /api/animais/:id — soft delete (ativo=false), preserva histórico ─

  async excluir(req, res) {
    const animalId = Number(req.params.id);
    const { motivo, motivoTipo } = req.body ?? {};
    try {
      // CATEGORIA da inativação — coluna própria e indexada, é o que o relatório
      // agrupa. Recusar valor fora da lista é o que mantém o agrupamento confiável:
      // um typo não quebra nada hoje, só vira fatia órfã no gráfico meses depois.
      const { tipo: tipoValidado, erro: erroTipo } = validarMotivoTipo(motivoTipo);
      if (erroTipo) {
        return res.status(400).json({ sucesso: false, mensagem: erroTipo, code: 'MOTIVO_TIPO_INVALIDO' });
      }

      const descricao = String(motivo ?? '').trim();

      // ⚠️ A ordem importa: o tipo é validado ANTES de exigir a descrição, porque a
      // CATEGORIA sozinha já é justificativa suficiente ("Falecimento" diz tudo).
      // Exigir texto livre mesmo com o motivo escolhido no seletor obrigaria o vet a
      // redigitar o que acabou de selecionar.
      if (!descricao && !tipoValidado) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da exclusão' });
      }
      // "Outro" é a exceção: sozinho não informa nada — a descrição é o conteúdo dele.
      if (exigeDescricao(tipoValidado) && descricao.length < 3) {
        return res.status(400).json({
          sucesso: false, code: 'DESCRICAO_OBRIGATORIA',
          mensagem: 'Descreva o motivo quando escolher "Outro".',
        });
      }

      // A AUDITORIA é um registro para LER, não uma dimensão de relatório: ali as duas
      // partes vão juntas, em texto, como sempre foram.
      const motivoAuditoria = [tipoValidado, descricao].filter(Boolean).join(' — ');

      const acessoExc = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acessoExc === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acessoExc)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { nome: true, especie: { select: { nome: true } } },
      });

      const pendencias = await prisma.$transaction(async (tx) => {
        await registrarDesativacao(tx, animalId, req.user.id, descricao || null, tipoValidado);
        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'ANIMAL',
          entidadeId: animalId,
          animalId,
          motivo:     motivoAuditoria,
          detalhes:   `${animal?.nome ?? 'Animal'}${animal?.especie?.nome ? ` (${animal.especie.nome})` : ''}`,
        });

        // Paciente inativado some de toda tela do sistema — a fila de Execução de
        // Prescrição inclusive. Sem isto, agendamento/vacina/prescrição/exame/
        // encaminhamento pendentes ficavam "fantasmas": sumidos das telas, mas com
        // status de "em aberto" ainda gravado — e voltavam a aparecer normalmente
        // se o animal fosse reativado depois.
        return cancelarPendenciasDoAnimal(
          tx, animalId, req,
          `Cancelado automaticamente: paciente inativado — ${motivo}`,
        );
      });

      res.json({ sucesso: true, mensagem: 'Animal inativado com sucesso', pendenciasCanceladas: pendencias });
    } catch (error) {
      console.error('[AnimalController.excluir]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir animal' });
    }
  }

  // ── PATCH /api/animais/:id/reativar — desfaz a exclusão lógica (Animal.ativo)
  // ⚠️ NÃO confundir com `ativar` (abaixo): aquele desfaz o BLOQUEIO de somente-
  // leitura (Animal.inativo, paciente sempre visível). Este desfaz a EXCLUSÃO
  // (Animal.ativo=false, paciente sumido de tudo) — sempre gestor/admin, mesmo
  // que a matriz conceda `animais.ativar` a outro perfil (mesma regra fixa do
  // `ativar` original: quem pode excluir não necessariamente pode trazer de volta).

  async reativarExcluido(req, res) {
    const animalId = Number(req.params.id);
    const { motivo } = req.body ?? {};
    try {
      if (!motivo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da reativação' });
      }
      if (!ehGestorNoContexto(req)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas o gestor pode reativar um paciente excluído.' });
      }

      const animal = await prisma.animal.findUnique({ where: { id: animalId }, select: { nome: true, ativo: true } });
      if (!animal) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (animal.ativo) return res.status(400).json({ sucesso: false, mensagem: 'Este paciente já está ativo.' });

      // Mesmo escopo de tenant que as demais ações — sem isso, um gestor de OUTRA
      // empresa poderia reativar paciente alheio só por saber o id.
      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      await prisma.$transaction(async (tx) => {
        await registrarAtivacaoAnimal(tx, animalId, req.user.id);
        await registrarAuditoria(tx, req, {
          categoria:  'ALTERACAO',
          entidade:   'ANIMAL',
          entidadeId: animalId,
          animalId,
          motivo,
          detalhes:   `Paciente reativado — ${animal.nome}`,
        });
      });

      res.json({ sucesso: true, mensagem: 'Paciente reativado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.reativarExcluido]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao reativar paciente' });
    }
  }

  // ── PATCH /api/animais/:id/inativar — paciente vira SOMENTE LEITURA ─────────
  // ⚠️ NÃO É soft delete (isso é `excluir`, `Animal.ativo`): o paciente CONTINUA
  // aparecendo em /animais-vet. O que trava é a criação/edição de qualquer registro
  // ligado a ele — ver `animalEstaInativo` nos demais controllers do atendimento.

  async inativar(req, res) {
    const animalId = Number(req.params.id);
    const { motivo } = req.body ?? {};
    try {
      if (!motivo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da inativação' });
      }

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { nome: true, ativo: true },
      });
      if (!animal?.ativo) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Este paciente já está inativo.' });
      }

      await prisma.$transaction(async (tx) => {
        await marcarInativo(tx, animalId, { motivo, porId: req.user.id });
        await registrarAuditoria(tx, req, {
          categoria:  'CANCELAMENTO',
          entidade:   'ANIMAL',
          entidadeId: animalId,
          animalId,
          motivo,
          detalhes:   `Paciente inativado — ${animal.nome}`,
        });
      });

      res.json({ sucesso: true, mensagem: 'Paciente inativado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.inativar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao inativar paciente' });
    }
  }

  // ── PATCH /api/animais/:id/ativar — reverte a inativação ────────────────────
  // ⚠️ SEMPRE gestor/admin, mesmo que a matriz conceda `animais.ativar` a outro
  // perfil (esse slug só governa quem pode INATIVAR — reativar é regra fixa).

  async ativar(req, res) {
    const animalId = Number(req.params.id);
    const { motivo } = req.body ?? {};
    try {
      if (!motivo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da reativação' });
      }
      if (!ehGestorNoContexto(req)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas o gestor pode reativar um paciente.' });
      }

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({ where: { id: animalId }, select: { nome: true } });
      if (!(await animalEstaInativo(animalId))) {
        return res.status(400).json({ sucesso: false, mensagem: 'Este paciente já está ativo.' });
      }

      await prisma.$transaction(async (tx) => {
        await marcarAtivo(tx, animalId);
        await registrarAuditoria(tx, req, {
          categoria:  'CANCELAMENTO',
          entidade:   'ANIMAL',
          entidadeId: animalId,
          animalId,
          motivo,
          detalhes:   `Paciente reativado — ${animal?.nome ?? ''}`,
        });
      });

      res.json({ sucesso: true, mensagem: 'Paciente reativado com sucesso' });
    } catch (error) {
      console.error('[AnimalController.ativar]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao reativar paciente' });
    }
  }

  // ── POST /api/animais/vincular-vet ───────────────────────────────────────
  // Uso restrito: vínculo direto ACEITO (apenas quando vet cria animal para si mesmo)

  // ── POST /api/animais/:id/transferir-propriedade ─────────────────────────
  // Troca o DONO de um animal já cadastrado (Doação/Venda/Aluguel). Regra BASAL,
  // não configurável na Matriz de Perfis — mesma família de "só o gestor
  // transfere agenda para outro" (CLAUDE.md §12 28-b/28-c): decidir quem passa a
  // responder pelo animal é decisão de quem coordena a equipe, não uma ação
  // clínica do dia a dia. `Animal.userId` já é a fonte de verdade de TODOS os
  // pontos de acesso do proprietário (buildAnimalScopeWhere/verificarAcessoAnimal)
  // — trocá-lo aqui já faz o dono ANTERIOR perder acesso a tudo nas telas normais,
  // sem nenhum código extra; o que ele retém é só o direito de exportar o próprio
  // período (ver ExportacaoController/exportacaoPaciente.js).
  async transferirPropriedade(req, res) {
    const animalId = Number(req.params.id);
    const { motivo, novoProprietario } = req.body;

    if (!ehGestorNoContexto(req)) {
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas o gestor da equipe pode transferir a propriedade do animal.' });
    }

    const MOTIVOS_VALIDOS = ['DOACAO', 'VENDA', 'ALUGUEL'];
    if (!MOTIVOS_VALIDOS.includes(motivo)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Selecione o motivo da transferência (Doação, Venda ou Aluguel).' });
    }

    const dados = novoProprietario || {};
    if (!dados.fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome completo do novo proprietário é obrigatório.' });
    if (!dados.email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail do novo proprietário é obrigatório.' });
    if (!dados.phone?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'Telefone do novo proprietário é obrigatório.' });
    const diaVenc = Number(dados.diaVencimentoFatura);
    if (!Number.isInteger(diaVenc) || diaVenc < 1 || diaVenc > 25) {
      return res.status(400).json({ sucesso: false, mensagem: 'Dia de vencimento da fatura deve ser um número entre 1 e 25.' });
    }
    if (!Array.isArray(dados.localidades) || dados.localidades.length === 0) {
      return res.status(400).json({ sucesso: false, mensagem: 'Informe ao menos uma localidade atendida pelo novo proprietário.' });
    }

    try {
      const animal = await prisma.animal.findUnique({
        where:  { id: animalId },
        select: { id: true, nome: true, userId: true, empresaId: true, equipeId: true, ativo: true, inativo: true },
      });
      if (!animal)                          return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado.' });
      if (animal.empresaId !== req.empresaId) return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal.' });
      if (!animal.ativo)                    return res.status(400).json({ sucesso: false, mensagem: 'Paciente inativo — não é possível transferir a propriedade.' });
      if (animal.inativo)                   return res.status(400).json({ sucesso: false, mensagem: 'Paciente bloqueado — não é possível transferir a propriedade.' });

      const resultado = await prisma.$transaction((tx) =>
        transferirPropriedadeAnimal(tx, req, { animal, motivo, novoProprietario: dados }),
      );

      const empresa = await prisma.empresa.findUnique({ where: { id: animal.empresaId }, select: { nome: true } });
      emailService.enviarTransferenciaPropriedade({
        destinatarioEmail: resultado.emailNovoProprietario,
        destinatarioNome:  resultado.nomeNovoProprietario,
        nomeAnimal:        animal.nome,
        criadoPorNome:     req.user?.fullName || 'a equipe',
        nomeEmpresa:       empresa?.nome || 'a clínica',
      }).catch(() => { /* fire-and-forget — falha de e-mail nunca derruba a transferência */ });

      const animalAtualizado = await prisma.animal.findUnique({ where: { id: animalId }, include: ANIMAL_INCLUDE });
      res.json({ sucesso: true, dados: animalAtualizado });
    } catch (error) {
      console.error('[AnimalController.transferirPropriedade]', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao transferir a propriedade do animal.' });
    }
  }

}

module.exports = new AnimalController();