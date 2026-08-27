// backend/src/lib/documentoVariaveis.js
//
// FONTE ÚNICA da resolução de variáveis da Central de Documentos: transforma
// `{{animal.nome}}` no nome do animal DE VERDADE.
//
// POR QUE EXISTE: até 2026-08-26 quem "resolvia" variável era
// `frontend/src/modules/documentos/catalogo.ts#resolverVariaveis`, e ele trocava a
// chave pelo campo `exemplo` do catálogo — `{{animal.nome}}` virava sempre "Thor",
// `{{cliente.nome}}` virava sempre "Haras Boa Vista". Servia para o vet ver a CARA
// da folha enquanto montava o modelo; não servia para emitir nada. O documento
// emitido saía com dado fictício, e a emissão gravava `animalNome: 'Thor'` fixo.
//
// 🔴 QUEM MANDA É O BACKEND. O front continua tendo o modo "exemplo" (para o editor
// sem paciente escolhido), mas assim que há animal selecionado ele passa a usar o
// contexto que ESTE arquivo devolve — e a EMISSÃO resolve sempre aqui, nunca no
// cliente. Resolver no navegador significaria confiar no que o navegador diz que é
// o CRMV do veterinário, num documento que tem valor legal.
//
// ⚠️ NADA DE INVENTAR VALOR. Variável sem dado devolve string VAZIA, e é o render
// que decide o que mostrar no lugar. Preencher com "—", "N/A" ou com o exemplo do
// catálogo colocaria no papel uma afirmação que ninguém fez: um atestado dizendo
// "Pelagem: Castanho" porque o cadastro estava em branco é documento falso.
//
// ⚠️ TENANT. Tudo é lido sob `req.empresaId`: cadastro do cliente por
// `ProprietarioPerfil` (§36 — nome/telefone/documento do cliente NUNCA saem de
// `users` numa tela de empresa) e o do profissional por `UsuarioEmpresa`. O mesmo
// animal atendido por duas clínicas produz documentos com cabeçalhos diferentes, e
// é isso que se espera.
'use strict';

const prisma = require('../lib/prisma').default;
const { formatarHoraNaEmpresa, formatarDataNaEmpresa, fusoDaEmpresa } = require('./fusoEmpresa');
const { aplicarPerfil }   = require('./proprietarioPerfil');
const { lerAssinatura }   = require('./usuarioEmpresa');

// ── Formatação ──────────────────────────────────────────────────────────────

/** Vazio é vazio. Ver a nota "NADA DE INVENTAR VALOR" no topo. */
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

const SEXO = { M: 'Macho', F: 'Fêmea', MACHO: 'Macho', FEMEA: 'Fêmea', 'FÊMEA': 'Fêmea' };

/**
 * Idade por extenso a partir da data de nascimento; sem data, cai no `idadeAnos`
 * digitado à mão no cadastro. Meses só aparecem abaixo de 2 anos — em documento de
 * equino adulto "7 anos e 3 meses" é ruído.
 */
function idadeDe(dataNascimento, idadeAnos) {
  if (!dataNascimento) return idadeAnos ? `${idadeAnos} ano${idadeAnos > 1 ? 's' : ''}` : '';
  const nasc = new Date(dataNascimento);
  if (Number.isNaN(nasc.getTime())) return '';
  const hoje = new Date();
  let meses = (hoje.getFullYear() - nasc.getFullYear()) * 12 + (hoje.getMonth() - nasc.getMonth());
  if (hoje.getDate() < nasc.getDate()) meses -= 1;
  if (meses < 0) return '';
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos === 0) return `${resto} ${resto === 1 ? 'mês' : 'meses'}`;
  if (anos < 2 && resto > 0) return `${anos} ano e ${resto} ${resto === 1 ? 'mês' : 'meses'}`;
  return `${anos} ano${anos > 1 ? 's' : ''}`;
}

function documentoDe(pessoa) {
  return txt(pessoa?.cnpj) || txt(pessoa?.cpf);
}

/**
 * Resenha descritiva do equino — a identificação que a Res. CFMV 1.321/2020 exige no
 * atestado e que o manual de confecção de resenhas descreve (pelagem + marcas).
 * Monta a partir do que o cadastro tem; sem nada, devolve vazio (não inventa marca).
 */
function resenhaDe(animal) {
  return [
    txt(animal.pelagem),
    txt(animal.altura) && `altura ${txt(animal.altura)}`,
    txt(animal.numeroChip) && `chip ${txt(animal.numeroChip)}`,
  ].filter(Boolean).join(', ');
}

// ── Coleta ──────────────────────────────────────────────────────────────────

const ANIMAL_SELECT = {
  id: true, nome: true, peso: true, sexo: true, dataNascimento: true, idadeAnos: true,
  pelagem: true, altura: true, numeroChip: true, registroPassaporte: true,
  baia: true, local: true, empresaId: true,
  especie:     { select: { nome: true } },
  raca:        { select: { nome: true } },
  // ⚠️ `LocalizacaoAnimal` NÃO tem cidade/estado — só `endereco` e `cep`. O município
  // da propriedade sai do cadastro do CLIENTE, que os tem.
  localizacao: { select: { nome: true, endereco: true, cep: true } },
  user: {
    select: {
      id: true, fullName: true, email: true, phone: true, phone2: true,
      cpf: true, cnpj: true, cep: true, endereco: true, bairro: true,
      cidade: true, estado: true,
    },
  },
};

/**
 * Configuração da empresa no MESMO escopo que `EquipeController` usa (empresa com
 * CNPJ → equipeId null; empresa pessoal/CPF → por equipe). Replicado aqui em vez de
 * importado porque aquele helper é privado do controller — e um `require` cruzado
 * entre controller e lib fecharia um ciclo com `EquipeController → ... → esta lib`.
 */
async function configDaEmpresa(empresaId, equipeId) {
  const empresa = await prisma.empresa.findUnique({
    where:  { id: empresaId },
    select: { id: true, nome: true, cnpj: true, telefone: true, endereco: true, cidade: true, estado: true, cep: true },
  });
  if (!empresa) return { empresa: null, config: null };

  let escopoEquipe = null;
  if (!empresa.cnpj) {
    escopoEquipe = equipeId ?? (await prisma.equipe.findFirst({
      where: { empresaId }, orderBy: { id: 'asc' }, select: { id: true },
    }))?.id ?? null;
  }
  const config = await prisma.empresaConfiguracao.findFirst({
    where: { empresaId, equipeId: escopoEquipe },
    select: { logoUrl: true },
  });
  return { empresa, config };
}

/** Dados do profissional que assina, NESTA empresa (§36-f: nunca de `users`). */
async function profissionalDaEmpresa(userId, empresaId) {
  if (!userId) return null;
  const [vinculo, assinaturaUrl] = await Promise.all([
    empresaId
      ? prisma.usuarioEmpresa.findFirst({
          where:  { userId, empresaId },
          select: { fullName: true, phone: true, crmv: true },
        }).catch(() => null)
      : null,
    empresaId ? lerAssinatura(userId, empresaId) : null,
  ]);
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { fullName: true, phone: true, email: true },
  });
  return {
    // O vínculo é AUTORIDADE quando existe; sem ele (ADMIN de plataforma, vet
    // autônomo) cai no `users`, que é o comportamento legado.
    nome:  txt(vinculo?.fullName) || txt(user?.fullName),
    crmv:  txt(vinculo?.crmv),
    phone: txt(vinculo?.phone) || txt(user?.phone),
    email: txt(user?.email),
    assinaturaUrl: assinaturaUrl ?? null,
  };
}

/**
 * Últimos fatos clínicos usados pelas variáveis de consulta/vacina/exame. Uma
 * consulta por bloco de variável, todas em paralelo e com `take` curto — o
 * documento cita o ÚLTIMO evento, não a série inteira.
 */
async function fatosClinicos(animalId, evolucaoId) {
  const [evolucao, ultimaVacina, examesAbertos, ultimaPrescricao, proximoAgendamento] = await Promise.all([
    evolucaoId
      ? prisma.evolucaoClinica.findUnique({
          where:  { id: evolucaoId },
          select: { id: true, titulo: true, especialidade: true, texto: true, dataInicio: true },
        })
      : prisma.evolucaoClinica.findFirst({
          where:   { animalId, ativo: true, status: { in: ['EM_ANDAMENTO', 'FINALIZADA'] } },
          orderBy: { dataInicio: 'desc' },
          select:  { id: true, titulo: true, especialidade: true, texto: true, dataInicio: true },
        }),
    prisma.vacinaClinica.findFirst({
      where:   { animalId, ativo: true },
      orderBy: { dataAplicacao: 'desc' },
      select:  { nome: true, dataAplicacao: true, dataReforco: true },
    }),
    prisma.exameClinico.findMany({
      where:   { animalId, ativo: true },
      orderBy: { dataSolicitacao: 'desc' },
      take:    5,
      select:  { tipo: true, descricao: true, resultado: true },
    }),
    prisma.prescricaoGrupo.findFirst({
      where:   { animalId, status: { in: ['FINALIZADO', 'EXECUTADO'] } },
      orderBy: { createdAt: 'desc' },
      select:  { itens: { where: { ativo: true }, select: { medicamento: true, dosagem: true, unidade: true, via: true, frequencia: true, duracaoDias: true, tipo: true }, take: 12 } },
    }),
    prisma.agendamentoClinico.findFirst({
      where:   { animalId, ativo: true, dataHora: { gte: new Date() }, status: { in: ['AGENDADO', 'ATRASADA'] } },
      orderBy: { dataHora: 'asc' },
      select:  { dataHora: true, veterinario: { select: { fullName: true } } },
    }),
  ]);
  return { evolucao, ultimaVacina, examesAbertos, ultimaPrescricao, proximoAgendamento };
}

// ── Contexto ────────────────────────────────────────────────────────────────

/**
 * Monta o contexto de variáveis de UM animal.
 *
 * ⚠️ NÃO autoriza nada — quem chama é responsável por ter passado por
 * `verificarAcessoAnimal`. Isolar assim é deliberado: a mesma função serve à
 * pré-visualização (GET) e à emissão (POST), e duplicar o gate nos dois lugares é
 * como ele acaba divergindo.
 *
 * @returns {Promise<{ variaveis: Record<string,string>, marca: object, animal: object }>}
 */
async function montarContexto(req, { animalId, evolucaoId = null } = {}) {
  const empresaId = req.empresaId ?? null;
  const fuso      = empresaId ? await fusoDaEmpresa(empresaId).catch(() => undefined) : undefined;

  const animal = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: ANIMAL_SELECT });
  if (!animal) return null;

  const [cliente, { empresa, config }, profissional, fatos] = await Promise.all([
    // §36: o cadastro do cliente é POR EMPRESA. `aplicarPerfil` sobrepõe o `users`
    // com o `ProprietarioPerfil` da empresa do contexto — sem isso o atestado sairia
    // com o telefone que OUTRA clínica cadastrou.
    animal.user ? aplicarPerfil(animal.user, empresaId) : null,
    empresaId ? configDaEmpresa(empresaId, req.equipeId ?? null) : { empresa: null, config: null },
    profissionalDaEmpresa(req.user?.id ?? null, empresaId),
    fatosClinicos(Number(animalId), evolucaoId ? Number(evolucaoId) : null),
  ]);

  const agora = new Date();
  const dataFmt = (d) => (d ? formatarDataNaEmpresa(d, fuso) : '');

  const medicamentos = (fatos.ultimaPrescricao?.itens ?? []).filter(i => i.tipo !== 'PROCEDIMENTO');
  const posologia = medicamentos
    .map(i => [i.medicamento, i.dosagem && `${i.dosagem}${i.unidade ?? ''}`, i.via, i.frequencia].filter(Boolean).join(' · '))
    .join('; ');

  const localidade = animal.localizacao;

  const variaveis = {
    // ── Veterinário (quem assina) ──
    'veterinario.nome':      txt(profissional?.nome),
    'veterinario.crmv':      txt(profissional?.crmv),
    'veterinario.clinica':   txt(empresa?.nome),
    'veterinario.telefone':  txt(profissional?.phone) || txt(empresa?.telefone),

    // ── Cliente (proprietário) ──
    'cliente.nome':          txt(cliente?.fullName),
    'cliente.documento':     documentoDe(cliente),
    'cliente.telefone':      txt(cliente?.phone) || txt(cliente?.phone2),
    'cliente.email':         txt(cliente?.email),

    // ── Propriedade (onde o animal está) ──
    'propriedade.nome':      txt(localidade?.nome) || txt(animal.local),
    'propriedade.endereco':  txt(localidade?.endereco) || txt(cliente?.endereco),
    'propriedade.municipio': [txt(cliente?.cidade), txt(cliente?.estado)].filter(Boolean).join(' / '),
    // Inscrição estadual da propriedade rural não é cadastrada em lugar nenhum hoje.
    // Fica VAZIA — ver "NADA DE INVENTAR VALOR" no topo. O bloco correspondente do
    // atestado sanitário vira uma linha para preencher à mão.
    'propriedade.inscricao': '',

    // ── Animal ──
    'animal.nome':      txt(animal.nome),
    'animal.idade':     idadeDe(animal.dataNascimento, animal.idadeAnos),
    'animal.raca':      txt(animal.raca?.nome),
    'animal.especie':   txt(animal.especie?.nome),
    'animal.sexo':      SEXO[String(animal.sexo ?? '').toUpperCase()] ?? txt(animal.sexo),
    'animal.pelagem':   txt(animal.pelagem),
    'animal.peso':      animal.peso ? `${animal.peso} kg` : '',
    'animal.resenha':   resenhaDe(animal),
    'animal.microchip': txt(animal.numeroChip),
    'animal.registro':  txt(animal.registroPassaporte),

    // ── Consulta (a evolução em curso, ou a última) ──
    'consulta.data':        dataFmt(fatos.evolucao?.dataInicio),
    'consulta.hora':        fatos.evolucao?.dataInicio ? formatarHoraNaEmpresa(fatos.evolucao.dataInicio, fuso) : '',
    'consulta.motivo':      txt(fatos.evolucao?.especialidade),
    'consulta.anamnese':    txt(fatos.evolucao?.texto),
    // Diagnóstico e conduta não são campos próprios da evolução (o texto é livre) —
    // ficam vazios em vez de recortar o texto no chute.
    'consulta.diagnostico': '',
    'consulta.conduta':     '',

    // ── Agenda ──
    'agenda.proximaVisita': dataFmt(fatos.proximoAgendamento?.dataHora),
    'agenda.profissional':  txt(fatos.proximoAgendamento?.veterinario?.fullName) || txt(profissional?.nome),

    // ── Clínico ──
    'medicamentos.lista':     medicamentos.map(i => i.medicamento).filter(Boolean).join(', '),
    'medicamentos.posologia': posologia,
    'vacinas.ultima':         fatos.ultimaVacina ? `${txt(fatos.ultimaVacina.nome)}${fatos.ultimaVacina.dataAplicacao ? ` — ${dataFmt(fatos.ultimaVacina.dataAplicacao)}` : ''}` : '',
    'vacinas.proximaDose':    dataFmt(fatos.ultimaVacina?.dataReforco),
    'exames.solicitados':     fatos.examesAbertos.map(e => txt(e.descricao) || txt(e.tipo)).filter(Boolean).join(', '),
    'exames.resultado':       txt(fatos.examesAbertos.find(e => txt(e.resultado))?.resultado),

    // ── Internação / reprodução / financeiro ──
    // Não há módulo de internação nem de reprodução no S2Vet: as variáveis existem no
    // catálogo do editor (o vet as vê e as insere), mas resolvem VAZIO — mostrar o
    // exemplo do catálogo aqui seria escrever ficção no prontuário.
    'internacao.entrada':  '',
    'internacao.baia':     txt(animal.baia),
    'reproducao.cobertura':    '',
    'reproducao.dg':           '',
    'reproducao.previsaoParto': '',
    'financeiro.valor':         '',
    'financeiro.vencimento':    '',
    'financeiro.formaPagamento': '',

    // ── Sistema ──
    'sistema.dataEmissao':    dataFmt(agora),
    // Preenchido na EMISSÃO, quando o número é sorteado. Na pré-visualização fica
    // vazio de propósito: o documento ainda não tem número.
    'sistema.numeroDocumento': '',
    'sistema.urlValidacao':    '',
  };

  return {
    variaveis,
    // O que o render precisa e que NÃO é texto: a logomarca da clínica e a imagem da
    // assinatura. Ficam fora de `variaveis` porque não são substituíveis em `{{...}}`
    // — são elementos gráficos posicionados pelo próprio bloco.
    marca: {
      logoUrl:       config?.logoUrl ?? null,
      empresaNome:   txt(empresa?.nome),
      assinaturaUrl: profissional?.assinaturaUrl ?? null,
      crmv:          txt(profissional?.crmv),
      assinanteNome: txt(profissional?.nome),
    },
    animal: {
      id: animal.id, nome: animal.nome, empresaId: animal.empresaId,
      clienteNome: txt(cliente?.fullName),
    },
    evolucaoId: fatos.evolucao?.id ?? null,
  };
}

// ── Aplicação nos blocos ────────────────────────────────────────────────────

const RE_VAR = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * LACUNA: `[[Rótulo]]` — um campo que o SISTEMA NÃO TEM e que a pessoa preenche na
 * hora de emitir (tatuagem, brinco, nº da partida da vacina, hora do óbito...).
 *
 * POR QUE EXISTE, e por que não é uma variável: variável é dado que o cadastro já
 * tem e o sistema resolve sozinho. Isto é o oposto — é o campo em branco do papel.
 * Antes eles eram literalmente `______` dentro da string do bloco, o que os tornava
 * INVISÍVEIS para o código: não dava para listar "o que falta preencher", que é
 * justamente a tela de emissão.
 *
 * ⚠️ O RÓTULO É A CHAVE. Duas lacunas com o mesmo rótulo no mesmo documento são o
 * MESMO campo e recebem o mesmo valor — é o que se quer quando "Tatuagem" aparece no
 * cabeçalho e no rodapé. Para campos distintos, use rótulos distintos.
 * ⚠️ A pessoa NUNCA digita `[[...]]`: quem os escreve é o modelo (o seed do CFMV ou o
 * botão "Campo para preencher" do editor). Na tela ela vê o rótulo e um campo.
 */
const RE_LACUNA = /\[\[\s*([^\]]+?)\s*\]\]/g;

/** Normaliza o rótulo para chave — é o que faz "Tatuagem" e " tatuagem " casarem. */
function chaveDaLacuna(rotulo) {
  return String(rotulo ?? '').trim().toLowerCase();
}

/**
 * Troca `{{chave}}` pelo valor do contexto e `[[Rótulo]]` pelo que foi preenchido.
 *
 * Chave de variável desconhecida vira string vazia (ver "NADA DE INVENTAR VALOR" no
 * topo). Lacuna não preenchida também: no papel ela vira o espaço em branco que
 * sempre foi — imprimir "[[Tatuagem]]" seria pior que imprimir nada.
 */
function aplicarEmTexto(texto, variaveis, preenchimento = null) {
  if (!texto || typeof texto !== 'string') return texto;
  return texto
    .replace(RE_VAR, (_todo, chave) => variaveis[chave] ?? '')
    .replace(RE_LACUNA, (_todo, rotulo) => (preenchimento?.[chaveDaLacuna(rotulo)] ?? ''));
}

/**
 * Percorre os blocos resolvendo TODO campo textual.
 *
 * ⚠️ Cobre `texto`, `rotulo`, `variavel`, `itens[]`, `colunas[]` e `linhas[][]` — a
 * variável pode estar dentro de uma célula de tabela ou de um item de checklist, e
 * resolver só `conteudo.texto` deixaria `{{animal.nome}}` cru no papel.
 *
 * ⚠️ `campoAuto` é o caso especial: o bloco guarda a CHAVE em `conteudo.variavel` e o
 * render mostra "rótulo: valor". Aqui a chave resolvida vai para `conteudo.texto`,
 * preservando `variavel` — sem isso o documento emitido perderia a informação de qual
 * variável originou aquele valor, que é o que permite auditar o papel depois.
 */
function aplicarEmBlocos(blocos, variaveis, preenchimento = null) {
  if (!Array.isArray(blocos)) return [];

  // PREENCHER UMA VEZ VALE PARA O DOCUMENTO INTEIRO.
  //
  // Um `campoAuto` cuja variável não resolveu vira campo na tela de emissão, chaveado
  // pelo RÓTULO ("Município / UF"). Mas a MESMA variável costuma aparecer também em
  // texto corrido — no anexo XI, `{{propriedade.municipio}}` está no campo E na linha
  // "Local e data: ..., 26/08/2026". Sem esta passada, o vet preenchia o município e
  // a linha do rodapé continuava com a vírgula solta, como se ele não tivesse
  // preenchido nada.
  //
  // Então: o que ele digita para um campo automático volta a ser o VALOR DA VARIÁVEL,
  // e alcança todo lugar onde ela é usada.
  const variaveisEfetivas = { ...variaveis };
  if (preenchimento) {
    for (const b of blocos) {
      if (b?.tipo !== 'campoAuto') continue;
      const chaveVar = String(b?.conteudo?.variavel ?? '').replace(/[{}]/g, '').trim();
      if (!chaveVar) continue;
      // Só quando o cadastro NÃO tinha o dado: o cadastro manda sobre o digitado.
      if (String(variaveisEfetivas[chaveVar] ?? '').trim()) continue;
      const digitado = preenchimento[chaveDaLacuna(b?.conteudo?.rotulo)];
      if (digitado && digitado.trim()) variaveisEfetivas[chaveVar] = digitado.trim();
    }
  }

  const ap = (t) => aplicarEmTexto(t, variaveisEfetivas, preenchimento);

  return blocos.map((b) => {
    const c = { ...(b?.conteudo ?? {}) };
    if (typeof c.texto  === 'string') c.texto  = ap(c.texto);
    // ⚠️ O RÓTULO NÃO recebe o preenchimento: ele é o NOME do campo ("Tatuagem"), e
    // resolver a lacuna dentro dele apagaria justamente o rótulo que a identifica.
    if (typeof c.rotulo === 'string') c.rotulo = aplicarEmTexto(c.rotulo, variaveisEfetivas);
    if (typeof c.url    === 'string') c.url    = ap(c.url);
    if (Array.isArray(c.itens))   c.itens   = c.itens.map(ap);
    if (Array.isArray(c.colunas)) c.colunas = c.colunas.map(ap);
    if (Array.isArray(c.linhas))  c.linhas  = c.linhas.map(l => (Array.isArray(l) ? l.map(ap) : l));

    if (b?.tipo === 'campoAuto' && typeof c.variavel === 'string') {
      const resolvido = aplicarEmTexto(c.variavel, variaveisEfetivas);
      // Campo automático que o cadastro NÃO tinha (animal sem microchip, cliente sem
      // documento) vira um campo da tela de emissão, chaveado pelo próprio rótulo —
      // é assim que "Microchip" em branco deixa de ser um buraco no papel.
      c.texto = resolvido || (preenchimento?.[chaveDaLacuna(c.rotulo)] ?? '');
    }
    // `observacoes` é área livre: o texto vem inteiro da tela de emissão quando o
    // modelo não traz nada escrito.
    if (b?.tipo === 'observacoes' && !String(c.texto ?? '').trim()) {
      c.texto = preenchimento?.[chaveDaLacuna(c.rotulo)] ?? '';
    }
    return { ...b, conteudo: c };
  });
}

/**
 * Lista os campos que a pessoa precisa preencher para emitir ESTE documento.
 *
 * Três origens, e as três aparecem na mesma tela porque, para quem emite, são a
 * mesma coisa — "o que falta no papel":
 *   1. LACUNA `[[Rótulo]]` em qualquer texto do bloco;
 *   2. `campoAuto` cuja variável resolveu VAZIA (o cadastro não tinha o dado);
 *   3. `observacoes` sem texto no modelo.
 *
 * ⚠️ `campoAuto` que RESOLVEU não entra: já está preenchido, e pedir de novo o nome
 * do animal que o sistema acabou de escrever é atrito puro.
 *
 * A ordem é a da FOLHA, e cada campo carrega a `secao` (o `subtitulo` mais próximo
 * acima dele) — é o que permite à tela agrupar os campos como eles aparecem impressos,
 * em vez de despejar uma lista plana de 12 inputs.
 */
function coletarCampos(blocos, variaveis) {
  const campos = [];
  const vistos = new Set();
  let secao = null;

  const registrar = (rotulo, origem, multilinha = false) => {
    const chave = chaveDaLacuna(rotulo);
    if (!chave || vistos.has(chave)) return;   // rótulo repetido = MESMO campo
    vistos.add(chave);
    campos.push({ chave, rotulo: String(rotulo).trim(), secao, origem, multilinha });
  };

  const varrerTexto = (t) => {
    if (typeof t !== 'string') return;
    for (const m of t.matchAll(RE_LACUNA)) registrar(m[1], 'LACUNA');
  };

  for (const b of Array.isArray(blocos) ? blocos : []) {
    const c = b?.conteudo ?? {};
    if (b?.tipo === 'subtitulo') secao = String(c.texto ?? '').trim() || secao;

    varrerTexto(c.texto);
    varrerTexto(c.rotulo);
    (c.itens ?? []).forEach(varrerTexto);
    (c.colunas ?? []).forEach(varrerTexto);
    (c.linhas ?? []).forEach(l => (Array.isArray(l) ? l.forEach(varrerTexto) : null));

    if (b?.tipo === 'campoAuto' && typeof c.variavel === 'string') {
      const resolvido = aplicarEmTexto(c.variavel, variaveis);
      if (!resolvido.trim() && c.rotulo) registrar(c.rotulo, 'CADASTRO');
    }
    if (b?.tipo === 'observacoes' && !String(c.texto ?? '').trim() && c.rotulo) {
      registrar(c.rotulo, 'OBSERVACAO', true);
    }
  }
  return campos;
}

module.exports = {
  montarContexto,
  aplicarEmTexto,
  aplicarEmBlocos,
  coletarCampos,
  chaveDaLacuna,
  RE_LACUNA,
  // exportados para teste
  idadeDe,
  resenhaDe,
};
