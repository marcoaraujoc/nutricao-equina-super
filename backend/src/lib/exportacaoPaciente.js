// backend/src/lib/exportacaoPaciente.js
//
// Exportação COMPLETA do prontuário de um paciente — Administração > Exportação.
// Reúne tudo que o app já sabe mostrar sobre o animal (evolução, prescrição, vacina,
// exame + resultado + imagens, encaminhamento, exame/relatório nutricional, dieta,
// agendamentos, histórico de peso/local) num relatório HTML legível + as mídias reais
// (fotos, laudos, imagens de exame) como arquivos, para o `ExportacaoController`
// empacotar num ZIP.
//
// ⚠️ RESPEITA MULTI-TENANT/RLS POR CONSTRUÇÃO: usa o client `prisma` (o ESTENDIDO —
// `require('./prisma').default`, nunca `prismaSemTenant`), que carimba `app.empresa_id`
// sozinho a partir do contexto que `authenticate` já resolveu para a requisição (ver
// `lib/prismaTenant.js`). Nenhuma consulta aqui roda fora desse tenant — não é preciso
// (nem se deve) repetir `empresaId` nos `where`. As buscas por FILHO do animal reusam
// os MESMOS filtros de segregação multi-clínica que `HistoricoController` já usa
// (`escopoEvolucaoWhere`/`escopoFilhoEvolucaoWhere`/`escopoPrescricaoGrupoWhere`) —
// fonte única, não duplicar a regra aqui.
'use strict';

const prisma = require('./prisma').default;
const { chaveDaUrl } = require('../storage/DbStorageProvider');
const { escopoEvolucaoWhere, escopoFilhoEvolucaoWhere, escopoPrescricaoGrupoWhere } = require('./clinicalScope');
const { aplicarPerfilEmRelacao } = require('./proprietarioPerfil');

const VET_SELECT = { select: { id: true, fullName: true } };

// ── Datas em pt-BR, sem depender de fuso do servidor para o "dia" ──────────────
function fmtData(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}
function fmtDataHora(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Nome de arquivo seguro para entrada de ZIP — sem separador de caminho nem caractere de controle. */
function nomeArquivoSeguro(s, maxLen = 120) {
  return String(s ?? 'arquivo')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, '-')
    .trim().slice(0, maxLen) || 'arquivo';
}

/** Busca metadados + bytes de uma mídia a partir da URL relativa (`/api/midia/<chave>`)
 *  gravada em `photoUrl`/`arquivoUrl`/`url`. `null` quando a URL não é desse formato
 *  ou o registro não existe mais (mídia legada, ou já removida). */
async function buscarMidiaDeUrl(url) {
  const chave = chaveDaUrl(url);
  if (!chave) return null;
  return prisma.midiaArquivo.findUnique({
    where:  { chave },
    select: { nomeOriginal: true, mimeType: true, tamanho: true, conteudo: true },
  });
}

/**
 * Resolve a JANELA de exportação para um `proprietarioId` — incondicional, ao
 * contrário do corte de `lib/animalPropriedadeCorte.js`: a Exportação é sempre
 * "para enviar ao dono", então TODA exportação (mesmo acionada por um GESTOR)
 * respeita a janela de posse do proprietário-alvo.
 *   - omitido ou = dono ATUAL → janela aberta: `{ gte: animal.propriedadeDesde }`
 *   - dono ANTERIOR → uma ou mais janelas FECHADAS (`AnimalProprietarioHistorico`
 *     com `dataFim` preenchido); nunca antes de `dataInicio`, nunca depois de `dataFim`
 * @returns {Promise<{ campo: string => object }|{erro:string}>} builder por campo, ou erro
 */
async function resolverJanelaExportacao(animal, proprietarioId) {
  const alvo = proprietarioId != null ? Number(proprietarioId) : animal.userId;

  let ranges;
  if (alvo === animal.userId) {
    ranges = [{ dataInicio: animal.propriedadeDesde, dataFim: null }];
  } else {
    const janelas = await prisma.animalProprietarioHistorico.findMany({
      where: { animalId: animal.id, proprietarioId: alvo, dataFim: { not: null } },
      select: { dataInicio: true, dataFim: true },
    });
    if (janelas.length === 0) return { erro: 'proprietario_nunca_foi_dono' };
    ranges = janelas;
  }

  // Constrói, para um CAMPO de data qualquer, o fragmento de `where` que restringe
  // àquelas janelas — um único range vira `{ gte, lt }` direto; mais de um vira `OR`.
  const paraCampo = (campo) => {
    const clausulas = ranges.map(r => ({
      [campo]: { gte: r.dataInicio, ...(r.dataFim ? { lt: r.dataFim } : {}) },
    }));
    return clausulas.length === 1 ? clausulas[0] : { OR: clausulas };
  };

  return { paraCampo };
}

/**
 * Coleta TODO o prontuário de um animal, já dentro do escopo RLS da requisição,
 * restrito à JANELA de posse de `proprietarioId` (atual por padrão — ver
 * `resolverJanelaExportacao`).
 * @param {object} req  request autenticado (empresaId/equipeId/membroCargo já resolvidos)
 * @param {number} animalId
 * @param {number} [proprietarioId]  dono (atual ou anterior) para quem se exporta
 * @returns {Promise<object|null|{erro:string}>} `null` = animal fora do escopo;
 *   `{erro}` = `proprietarioId` nunca foi dono deste animal
 */
async function coletarProntuario(req, animalId, proprietarioId) {
  const id = Number(animalId);

  const animal = await prisma.animal.findFirst({
    where:   { id, ativo: true, user: { ativo: true } }, // ANIMAL_VISIVEL (lib/visibilidade.js)
    include: {
      especie: true,
      raca:    true,
      user:    { select: { id: true, fullName: true, email: true, phone: true, phone2: true, cpf: true, cnpj: true } },
      localizacao: { select: { nome: true } },
      tratador:    { select: { nome: true, telefone: true } },
    },
  });
  if (!animal) return null;
  await aplicarPerfilEmRelacao([animal], 'user', req.empresaId ?? null);

  const janela = await resolverJanelaExportacao(animal, proprietarioId);
  if (janela.erro) return janela;
  const { paraCampo } = janela;

  const whereAtivo = { animalId: id, ativo: true };
  const escopoEvo   = escopoEvolucaoWhere(req);
  const escopoFilho = escopoFilhoEvolucaoWhere(req);
  const escopoPresc = escopoPrescricaoGrupoWhere(req);

  const [
    evolucoes, grupos, vacinas, exames, encaminhamentos,
    examesNutricionais, planosDieta, relatorios, agendamentos, historico,
  ] = await Promise.all([
    prisma.evolucaoClinica.findMany({
      where:   { ...whereAtivo, AND: [escopoEvo, paraCampo('dataInicio')] },
      include: { veterinario: VET_SELECT, midias: true },
      orderBy: { dataInicio: 'desc' },
    }),
    prisma.prescricaoGrupo.findMany({
      where:   { animalId: id, AND: [escopoPresc, paraCampo('createdAt')] },
      include: { veterinario: VET_SELECT, itens: { where: { ativo: true }, orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vacinaClinica.findMany({
      where:   { ...whereAtivo, AND: [escopoFilho, paraCampo('dataAplicacao')] },
      include: { veterinario: VET_SELECT },
      orderBy: { dataAplicacao: 'desc' },
    }),
    prisma.exameClinico.findMany({
      where:   { ...whereAtivo, AND: [escopoFilho, paraCampo('dataSolicitacao')] },
      include: {
        veterinario:    VET_SELECT,
        resultadoItens: { orderBy: { ordem: 'asc' } },
        imagens:        true,
      },
      orderBy: { dataSolicitacao: 'desc' },
    }),
    prisma.encaminhamentoClinico.findMany({
      where:   { ...whereAtivo, AND: [escopoFilho, paraCampo('dataEncaminhamento')] },
      include: { veterinario: VET_SELECT, prestador: VET_SELECT },
      orderBy: { dataEncaminhamento: 'desc' },
    }),
    prisma.exameNutricional.findMany({
      where:   { animalId: id, AND: [paraCampo('dataExame')] },
      include: { nutriente: { select: { nome: true } } },
      orderBy: { dataExame: 'desc' },
    }),
    prisma.planoDieta.findMany({
      where:   { animalId: id, AND: [paraCampo('dataCriacao')] },
      include: { itens: { include: { alimento: { select: { nome: true } } }, orderBy: { id: 'asc' } } },
      orderBy: { dataCriacao: 'desc' },
    }),
    prisma.relatorioSalvo.findMany({
      where:   { animalId: id, AND: [paraCampo('geradoEm')] },
      orderBy: { geradoEm: 'desc' },
    }),
    prisma.agendamentoClinico.findMany({
      // Sem recorte de escopo aplicado aqui de propósito: `tb_agendamentos_clinicos`
      // já tem RLS por empresa (fase 7c) — o filtro por tenant acontece no banco,
      // não precisa ser repetido no `where` (e não há helper de escopo para ele,
      // ao contrário dos filhos de evolução, que herdam por FK).
      where:   { animalId: id, ativo: true, AND: [paraCampo('dataHora')] },
      include: { veterinario: VET_SELECT },
      orderBy: { dataHora: 'desc' },
    }),
    prisma.animalHistorico.findMany({
      where:   { animalId: id, AND: [paraCampo('registradoEm')] },
      orderBy: { registradoEm: 'desc' },
    }),
  ]);

  return {
    animal, evolucoes, grupos, vacinas, exames, encaminhamentos,
    examesNutricionais, planosDieta, relatorios, agendamentos, historico,
  };
}

/**
 * Resolve as MÍDIAS reais (bytes) ligadas ao prontuário já coletado — foto do
 * animal, anexos de evolução, laudo/imagens de exame. Devolve uma lista pronta
 * para o `archiver` gravar em `midias/<nomeNoZip>`, mais o data URI da foto (para
 * embutir no cabeçalho do relatório).
 */
async function coletarMidias(dados) {
  const arquivos = []; // { nomeNoZip, mimeType, conteudo }
  let fotoDataUri = null;

  if (dados.animal.photoUrl) {
    const m = await buscarMidiaDeUrl(dados.animal.photoUrl);
    if (m) {
      arquivos.push({ nomeNoZip: `foto-animal-${nomeArquivoSeguro(m.nomeOriginal || 'foto')}`, mimeType: m.mimeType, conteudo: m.conteudo });
      // Só a foto do animal é embutida no HTML — as demais ficam só como arquivo
      // (embutir laudo/anexo de evolução também infla o relatório sem necessidade:
      // quem quiser ver, abre o arquivo na pasta `midias/`).
      if (m.conteudo?.length < 3 * 1024 * 1024) { // evita relatório gigante com foto fora do padrão
        fotoDataUri = `data:${m.mimeType};base64,${m.conteudo.toString('base64')}`;
      }
    }
  }

  for (const ev of dados.evolucoes) {
    for (const midia of ev.midias) {
      const m = await buscarMidiaDeUrl(midia.url);
      if (m) arquivos.push({ nomeNoZip: `evolucao-${ev.id}-${nomeArquivoSeguro(m.nomeOriginal || midia.nome)}`, mimeType: m.mimeType, conteudo: m.conteudo });
    }
  }

  for (const ex of dados.exames) {
    if (ex.arquivoUrl) {
      const m = await buscarMidiaDeUrl(ex.arquivoUrl);
      if (m) arquivos.push({ nomeNoZip: `exame-${ex.id}-laudo-${nomeArquivoSeguro(m.nomeOriginal || 'laudo')}`, mimeType: m.mimeType, conteudo: m.conteudo });
    }
    for (const img of ex.imagens) {
      const m = await buscarMidiaDeUrl(img.arquivoUrl);
      if (m) arquivos.push({ nomeNoZip: `exame-${ex.id}-${nomeArquivoSeguro(m.nomeOriginal || img.nome || 'imagem')}`, mimeType: m.mimeType, conteudo: m.conteudo });
    }
  }

  return { arquivos, fotoDataUri };
}

// ── HTML do relatório ───────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 24px; }
  h1 { font-size: 20px; color: #059669; margin: 0 0 4px; }
  h2 { font-size: 14px; color: #065f46; text-transform: uppercase; letter-spacing: .04em; margin: 28px 0 8px; border-bottom: 2px solid #d1fae5; padding-bottom: 4px; }
  .sub { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
  .cabecalho { display: flex; gap: 16px; align-items: center; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 18px; }
  .foto { width: 84px; height: 84px; border-radius: 8px; object-fit: cover; border: 1px solid #e5e7eb; flex-shrink: 0; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; flex: 1; }
  .lbl { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; }
  .val { font-size: 12px; font-weight: 600; color: #111; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { background: #f0fdf4; color: #065f46; font-size: 10px; text-transform: uppercase; text-align: left; padding: 6px 8px; border: 1px solid #d1fae5; }
  td { padding: 6px 8px; border: 1px solid #e5e7eb; vertical-align: top; font-size: 11px; }
  .registro { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
  .registro-topo { display: flex; justify-content: space-between; font-size: 10px; color: #6b7280; margin-bottom: 6px; }
  .badge { display: inline-block; background: #d1fae5; color: #065f46; font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; }
  .texto { white-space: pre-wrap; font-size: 11px; line-height: 1.5; }
  .vazio { color: #9ca3af; font-style: italic; font-size: 11px; }
  .rodape { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; }
`;

function secaoTabela(titulo, colunas, linhas) {
  if (linhas.length === 0) return `<h2>${esc(titulo)}</h2><p class="vazio">Nenhum registro.</p>`;
  return `
    <h2>${esc(titulo)} (${linhas.length})</h2>
    <table>
      <thead><tr>${colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map(l => `<tr>${l.map(v => `<td>${v ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function montarHtmlRelatorio(dados, fotoDataUri, nomeEmpresa) {
  const a = dados.animal;
  const idade = a.dataNascimento
    ? `${Math.floor((Date.now() - new Date(a.dataNascimento).getTime()) / (365.25 * 24 * 3600 * 1000))} anos`
    : (a.idadeAnos != null ? `${a.idadeAnos} anos` : '—');

  const evolucoesHtml = dados.evolucoes.length === 0
    ? '<p class="vazio">Nenhuma evolução registrada.</p>'
    : dados.evolucoes.map(e => `
      <div class="registro">
        <div class="registro-topo">
          <span><span class="badge">${esc(e.especialidade)}</span> ${esc(e.titulo || '')}</span>
          <span>${fmtDataHora(e.dataInicio)} · ${esc(e.veterinario?.fullName ?? '—')} · ${esc(e.status)}</span>
        </div>
        <div class="texto">${esc(e.texto)}</div>
        ${e.midias.length > 0 ? `<p class="vazio">Mídias anexadas: ${e.midias.length} (ver pasta midias/)</p>` : ''}
      </div>`).join('');

  const prescricoesHtml = dados.grupos.length === 0
    ? '<p class="vazio">Nenhuma prescrição registrada.</p>'
    : dados.grupos.map(g => `
      <div class="registro">
        <div class="registro-topo">
          <span><span class="badge">Prescrição nº ${String(g.numero).padStart(3, '0')}</span></span>
          <span>${fmtDataHora(g.createdAt)} · ${esc(g.veterinario?.fullName ?? '—')} · ${esc(g.status)}</span>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Tipo</th><th>Dosagem</th><th>Via</th><th>Frequência</th><th>Duração (d)</th><th>Observação</th></tr></thead>
          <tbody>${g.itens.map(i => `<tr>
            <td>${esc(i.medicamento)}</td><td>${esc(i.tipo)}</td>
            <td>${esc(i.dosagem)}${i.unidade ? ' ' + esc(i.unidade) : ''}</td>
            <td>${esc(i.via)}</td><td>${esc(i.frequencia)}</td><td>${i.duracaoDias}</td>
            <td>${esc(i.observacao)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`).join('');

  const vacinasHtml = secaoTabela('Vacinas', ['Vacina', 'Fabricante', 'Lote', 'Dose', 'Via', 'Aplicação', 'Reforço', 'Status', 'Responsável'],
    dados.vacinas.map(v => [esc(v.nome), esc(v.fabricante), esc(v.lote), esc(v.dose), esc(v.via), fmtData(v.dataAplicacao), fmtData(v.dataReforco), esc(v.status), esc(v.veterinario?.fullName)]));

  const examesHtml = dados.exames.length === 0
    ? '<p class="vazio">Nenhum exame registrado.</p>'
    : dados.exames.map(x => `
      <div class="registro">
        <div class="registro-topo">
          <span><span class="badge">${esc(x.tipo)}</span> ${esc(x.descricao)}</span>
          <span>${fmtData(x.dataSolicitacao)} · ${esc(x.veterinario?.fullName ?? '—')} · ${esc(x.status)}</span>
        </div>
        ${x.resultado ? `<div class="texto">${esc(x.resultado)}</div>` : ''}
        ${x.resultadoItens.length > 0 ? `<table><thead><tr><th>Parâmetro</th><th>Valor</th><th>Unidade</th><th>Referência</th></tr></thead>
          <tbody>${x.resultadoItens.map(it => `<tr><td>${esc(it.parametro)}</td><td>${esc(it.valor)}</td><td>${esc(it.unidade)}</td><td>${esc(it.referencia)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${(x.arquivoUrl || x.imagens.length > 0) ? `<p class="vazio">Arquivos anexados: ${(x.arquivoUrl ? 1 : 0) + x.imagens.length} (ver pasta midias/)</p>` : ''}
      </div>`).join('');

  const encaminhamentosHtml = secaoTabela('Encaminhamentos', ['Especialidade', 'Motivo', 'Urgência', 'Status', 'Destino', 'Data'],
    dados.encaminhamentos.map(e => [esc(e.especialidade), esc(e.motivo), esc(e.urgencia), esc(e.status), esc(e.prestador?.fullName ?? e.clinicaDestino ?? e.veterinarioDestino ?? 'Externo'), fmtData(e.dataEncaminhamento)]));

  const examesNutriHtml = secaoTabela('Exames Nutricionais', ['Nutriente', 'Valor', 'Unidade', 'Referência', 'Data'],
    dados.examesNutricionais.map(n => [esc(n.nutriente?.nome), n.valorEncontrado, esc(n.unidade), `${n.valorMinRef ?? '—'} a ${n.valorMaxRef ?? '—'}`, fmtData(n.dataExame)]));

  const dietaHtml = dados.planosDieta.length === 0
    ? '<p class="vazio">Nenhum plano de dieta cadastrado.</p>'
    : dados.planosDieta.map(p => `
      <div class="registro">
        <div class="registro-topo">
          <span><span class="badge">${p.ativo ? 'Ativo' : 'Inativo'}</span> ${esc(p.nome)}</span>
          <span>${fmtData(p.dataCriacao)}</span>
        </div>
        <table><thead><tr><th>Alimento</th><th>Qtd/dia</th><th>Periodicidade</th><th>Horário</th></tr></thead>
          <tbody>${p.itens.map(i => `<tr><td>${esc(i.alimento?.nome)}</td><td>${i.qtdGramasDia} ${esc(i.unidade)}</td><td>${esc(i.periodicidade)}</td><td>${esc(i.horario)}</td></tr>`).join('')}</tbody>
        </table>
      </div>`).join('');

  const relatoriosHtml = secaoTabela('Relatórios Nutricionais Salvos', ['Gerado em', 'Fonte', 'Peso calculado', 'Categoria'],
    dados.relatorios.map(r => [fmtDataHora(r.geradoEm), esc(r.fonteCalculo), r.pesoCalculado != null ? `${r.pesoCalculado} kg` : '—', esc(r.categoriaUsada)]));

  const agendamentosHtml = secaoTabela('Agendamentos', ['Título', 'Tipo', 'Data/Hora', 'Status', 'Profissional'],
    dados.agendamentos.map(ag => [esc(ag.titulo), esc(ag.tipo), fmtDataHora(ag.dataHora), esc(ag.status), esc(ag.veterinario?.fullName)]));

  const historicoHtml = secaoTabela('Histórico de Peso / Local / Baia', ['Data', 'Peso', 'Local', 'Baia'],
    dados.historico.map(h => [fmtDataHora(h.registradoEm), h.peso != null ? `${h.peso} kg` : '—', esc(h.local), esc(h.baia)]));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Prontuário — ${esc(a.nome)}</title><style>${CSS}</style></head>
<body>
  <h1>Prontuário completo — ${esc(a.nome)}</h1>
  <p class="sub">${esc(nomeEmpresa)} · Exportado em ${fmtDataHora(new Date())}</p>

  <div class="cabecalho">
    ${fotoDataUri ? `<img class="foto" src="${fotoDataUri}" alt="${esc(a.nome)}">` : ''}
    <div class="grid">
      <div><div class="lbl">Espécie / Raça</div><div class="val">${esc(a.especie?.nome)} ${a.raca ? '· ' + esc(a.raca.nome) : ''}</div></div>
      <div><div class="lbl">Sexo</div><div class="val">${esc(a.sexo)}</div></div>
      <div><div class="lbl">Peso</div><div class="val">${a.peso} kg</div></div>
      <div><div class="lbl">Idade</div><div class="val">${idade}</div></div>
      <div><div class="lbl">Pelagem</div><div class="val">${esc(a.pelagem) || '—'}</div></div>
      <div><div class="lbl">Nº Chip / Passaporte</div><div class="val">${esc(a.numeroChip) || esc(a.registroPassaporte) || '—'}</div></div>
      <div><div class="lbl">Local / Baia</div><div class="val">${esc(a.localizacao?.nome || a.local) || '—'} ${a.baia ? '· ' + esc(a.baia) : ''}</div></div>
      <div><div class="lbl">Tratador</div><div class="val">${esc(a.tratador?.nome) || '—'}</div></div>
      <div><div class="lbl">Proprietário</div><div class="val">${esc(a.user?.fullName)}</div></div>
      <div><div class="lbl">Contato</div><div class="val">${esc(a.user?.phone) || '—'}</div></div>
      <div><div class="lbl">E-mail</div><div class="val">${esc(a.user?.email) || '—'}</div></div>
      <div><div class="lbl">Documento</div><div class="val">${esc(a.user?.cpf) || esc(a.user?.cnpj) || '—'}</div></div>
    </div>
  </div>

  <h2>Evoluções Clínicas (${dados.evolucoes.length})</h2>
  ${evolucoesHtml}

  <h2>Prescrições (${dados.grupos.length})</h2>
  ${prescricoesHtml}

  ${vacinasHtml}

  <h2>Exames Clínicos (${dados.exames.length})</h2>
  ${examesHtml}

  ${encaminhamentosHtml}
  ${examesNutriHtml}

  <h2>Planos de Dieta (${dados.planosDieta.length})</h2>
  ${dietaHtml}

  ${relatoriosHtml}
  ${agendamentosHtml}
  ${historicoHtml}

  <div class="rodape">Documento gerado automaticamente pelo S2Vet — contém dados clínicos confidenciais do paciente. Uso restrito.</div>
</body>
</html>`;
}

module.exports = { coletarProntuario, coletarMidias, montarHtmlRelatorio, nomeArquivoSeguro };
