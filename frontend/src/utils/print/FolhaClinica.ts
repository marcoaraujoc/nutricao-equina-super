// frontend/src/utils/print/FolhaClinica.ts
// 🔴 FOLHA CLÍNICA — FONTE ÚNICA do papel de TODO registro clínico que sai do
// sistema: Imprimir, PDF por WhatsApp e PDF por e-mail (os três usam o MESMO HTML).
//
// Ordem da folha (pedido de 2026-09-29), e ela não é estética — é a ordem em que
// quem recebe o papel precisa das informações:
//
//   1. Logomarca da empresa
//   2. Veterinário: nome, CRMV e o local da empresa (clínica + endereço)
//   3. Dados do animal
//   4. Título do documento (Prescrição, Vacina, Evolução Clínica…)
//   5. O conteúdo de cada módulo — é a ÚNICA parte que o gerador do módulo escreve
//   6. Local e data da emissão
//   7. Assinatura do veterinário
//
// Cada gerador (`PrescricaoPrint`, `EvolucaoPrint`…) monta só o CORPO e chama
// `gerarHtmlFolhaClinica`. Cabeçalho, paciente, data e assinatura moram AQUI, e é
// isso que impede o papel de um módulo divergir do de outro na primeira correção.
//
// ⚠️ O HTML é montado de forma SÍNCRONA: o `gerarHtml` de `compartilharPdf.ts` roda
// dentro da janela de "user activation" do navegador (de que o plano B do WhatsApp
// depende). Tudo o que é assíncrono — a assinatura/CRMV de quem assina, o endereço
// da clínica e as imagens em `data:` — é resolvido ANTES por `prepararFolhaClinica`
// e guardado em cache de módulo. Sem o preparo a folha sai do mesmo jeito, só sem
// CRMV/assinatura/endereço: nunca quebra.
//
// ⚠️ Toda imagem passa por `srcImpressao`: o PDF sai do Puppeteer, que BLOQUEIA o que
// não for `data:` (anti-SSRF, ver printUrl.ts). Sem isso a logo e a foto imprimem bem
// na tela e nascem QUEBRADAS no arquivo que chega ao cliente.

import api from '../../services/api';
import { formatDiaMesAno, formatHora } from '../dateUtils';
import {
  PRINT_SHELL_CSS, renderAssinaturas, srcImpressao, prepararImagensImpressao,
  type BlocoAssinatura,
} from './PrintShell';
import { carregarAssinaturaProfissional, type AssinaturaProfissional } from './assinaturaProfissional';

// ─── Contrato ────────────────────────────────────────────────────────────────

/** Paciente como a folha o exibe. Campo vazio SOME (nada de "—" inventado). */
export interface AnimalFolha {
  nome:          string;
  photoUrl?:     string | null;
  especie?:      string | null;
  raca?:         string | null;
  sexo?:         string | null;
  /** Já formatada ("7 anos") — cada tela calcula a idade do jeito que tem. */
  idade?:        string | null;
  /** DD/MM/AAAA, já formatada. */
  nascimento?:   string | null;
  peso?:         number | string | null;
  pelagem?:      string | null;
  baia?:         string | null;
  local?:        string | null;
  proprietario?: string | null;
}

/** Quem ASSINA — o profissional do REGISTRO, nunca "o usuário logado". */
export interface ProfissionalFolha {
  /** Habilita buscar nome do vínculo, CRMV e a imagem da assinatura DESTA empresa. */
  id?:   number | null;
  /** Nome que veio no registro — usado quando o vínculo não resolve. */
  nome?: string | null;
}

export interface PaginaFolha {
  /** Título do documento (item 4). */
  titulo:     string;
  /** Linha discreta sob o título: número, data do registro, status… */
  subtitulo?: string | null;
  /** HTML do módulo (item 5). */
  corpoHtml:  string;
}

export interface FolhaClinica {
  /** `<title>` da página — é o nome sugerido quando a pessoa salva como PDF. */
  documento:          string;
  /** Logo da empresa DONA do paciente; sem ela, a da empresa do contexto. */
  logoUrl?:           string | null;
  profissional:       ProfissionalFolha | null;
  /** Papel escrito sob a linha de assinatura. */
  rotuloAssinatura?:  string;
  /** Outras linhas de assinatura (ex.: o executor da prescrição, em branco). */
  assinaturasExtras?: BlocoAssinatura[];
  animal:             AnimalFolha | null;
  /** Uma ou mais páginas — o pedido de exame sai uma por laboratório. */
  paginas:            PaginaFolha[];
  /** CSS das classes que o corpo do módulo usa. */
  cssModulo?:         string;
  /** Referência discreta no pé da folha ("Prescrição #0012"). */
  rodape?:            string | null;
}

// ─── Estabelecimento (local da empresa) ──────────────────────────────────────

interface Estabelecimento {
  nome:     string | null;
  endereco: string | null;
  cidade:   string | null;
  estado:   string | null;
  logoUrl:  string | null;
}

// Cache da PROMESSA (dois cliques no mesmo tick = uma requisição) e do valor já
// resolvido, que é o que o gerador síncrono lê. A troca de empresa recarrega a
// página (EmpresaContext.trocarContexto), então o cache de módulo não atravessa
// empresas.
let estabelecimentoPromessa: Promise<Estabelecimento | null> | null = null;
let estabelecimento: Estabelecimento | null = null;

function carregarEstabelecimento(): Promise<Estabelecimento | null> {
  if (estabelecimentoPromessa) return estabelecimentoPromessa;
  estabelecimentoPromessa = api.get('/equipes/logo')
    // GET 403 resolve com `data: null` (interceptor de services/api.ts).
    .then(res => {
      const d = res.data?.dados;
      if (!d) return null;
      const e: Estabelecimento = {
        nome:     d.empresaNome     ?? null,
        endereco: d.empresaEndereco ?? null,
        cidade:   d.empresaCidade   ?? null,
        estado:   d.empresaEstado   ?? null,
        logoUrl:  d.logoUrl         ?? null,
      };
      estabelecimento = e;
      return e;
    })
    .catch(() => {
      // Falha não fica em cache: o próximo clique tenta de novo.
      estabelecimentoPromessa = null;
      return null;
    });
  return estabelecimentoPromessa;
}

// Assinaturas JÁ resolvidas, por usuário — a leitura síncrona do gerador.
const assinaturasResolvidas = new Map<number, AssinaturaProfissional | null>();

/**
 * Resolve tudo o que a folha precisa e que só existe de forma ASSÍNCRONA: o
 * vínculo de quem assina (nome, CRMV, imagem da assinatura), o endereço da clínica
 * e as imagens em `data:`. Chame ANTES de `gerarHtmlFolhaClinica` sempre que for
 * gerar PDF (WhatsApp/e-mail) ou imprimir. Nunca lança.
 */
export async function prepararFolhaClinica(opts: {
  profissionalId?: number | null;
  logoUrl?:        string | null;
  /** Foto do paciente e demais imagens do corpo (mídias, laudos…). */
  imagens?:        Array<string | null | undefined>;
}): Promise<void> {
  const [assinatura, est] = await Promise.all([
    opts.profissionalId ? carregarAssinaturaProfissional(opts.profissionalId) : Promise.resolve(null),
    carregarEstabelecimento(),
  ]);
  if (opts.profissionalId) assinaturasResolvidas.set(opts.profissionalId, assinatura);
  await prepararImagensImpressao([
    opts.logoUrl, est?.logoUrl, assinatura?.assinaturaUrl, ...(opts.imagens ?? []),
  ]);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function escFolha(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const txt = (v: unknown): string =>
  v == null ? '' : String(v).trim();

// O CRMV é cadastrado JÁ com o prefixo na maioria das bases ("CRMV-SP 12345");
// prefixar sempre daria "CRMV CRMV-SP 12345".
function rotuloCrmv(crmv: string): string {
  return /^crmv/i.test(crmv) ? crmv : `CRMV ${crmv}`;
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "Campinas/SP, 29 de setembro de 2026 às 14:32" — no FUSO DA CLÍNICA (§6). */
function linhaLocalEData(agora: Date, est: Estabelecimento | null): string {
  const dma  = formatDiaMesAno(agora);          // "29/09/2026", fuso de exibição
  const hora = formatHora(agora);
  const [dia, mes, ano] = (dma ?? '').split('/');
  const extenso = dia && mes && ano
    ? `${Number(dia)} de ${MESES[Number(mes) - 1] ?? mes} de ${ano}`
    : '';
  const local = [txt(est?.cidade), txt(est?.estado)].filter(Boolean).join('/');
  const data  = [extenso, hora ? `às ${hora}` : ''].filter(Boolean).join(' ');
  return [local, data].filter(Boolean).join(', ');
}

// ─── Peças da folha ─────────────────────────────────────────────────────────

function renderTopo(d: FolhaClinica, assinatura: AssinaturaProfissional | null, est: Estabelecimento | null): string {
  const logo = srcImpressao(d.logoUrl || est?.logoUrl);
  const nomeVet = txt(assinatura?.nome) || txt(d.profissional?.nome);
  const crmv    = txt(assinatura?.crmv);
  const localLinha = [txt(est?.endereco), [txt(est?.cidade), txt(est?.estado)].filter(Boolean).join('/')]
    .filter(Boolean).join(' · ');

  const linhasVet = [
    nomeVet ? `<div class="fc-vet-nome">${escFolha(nomeVet)}</div>` : '',
    crmv ? `<div class="fc-vet-crmv">${escFolha(rotuloCrmv(crmv))}</div>` : '',
    txt(est?.nome) ? `<div class="fc-vet-clinica">${escFolha(txt(est?.nome))}</div>` : '',
    localLinha ? `<div class="fc-vet-local">${escFolha(localLinha)}</div>` : '',
  ].filter(Boolean).join('');

  return `
  <div class="fc-topo">
    <div class="fc-logo">
      ${logo ? `<img src="${logo}" alt="Logo">` : '<div class="fc-marca">S2Vet</div>'}
    </div>
    ${linhasVet ? `<div class="fc-vet">${linhasVet}</div>` : ''}
  </div>`;
}

function renderAnimal(a: AnimalFolha | null): string {
  if (!a) return '';
  const foto = srcImpressao(a.photoUrl);
  const peso = a.peso != null && txt(a.peso) ? `${txt(a.peso)} kg` : '';
  const especieRaca = [txt(a.especie), txt(a.raca)].filter(Boolean).join(' · ');
  const campos: Array<[string, string]> = [
    ['Paciente', txt(a.nome)],
    ['Espécie · Raça', especieRaca],
    ['Sexo', txt(a.sexo)],
    ['Idade', txt(a.idade)],
    ['Nascimento', txt(a.nascimento)],
    ['Peso', peso],
    ['Pelagem', txt(a.pelagem)],
    ['Proprietário', txt(a.proprietario)],
    ['Local', txt(a.local)],
    ['Baia / Cocheira', txt(a.baia)],
  ];
  // Campo sem dado SOME — um "—" no papel parece dado que alguém registrou.
  const itens = campos
    .filter(([, v]) => v)
    .map(([l, v]) => `<div><span class="fc-lbl">${escFolha(l)}</span><span class="fc-val">${escFolha(v)}</span></div>`)
    .join('');
  return `
  <div class="fc-animal">
    ${foto ? `<img class="fc-animal-foto" src="${foto}" alt="${escFolha(a.nome)}">` : ''}
    <div class="fc-animal-grid">${itens}</div>
  </div>`;
}

function renderPagina(
  d: FolhaClinica,
  p: PaginaFolha,
  assinatura: AssinaturaProfissional | null,
  est: Estabelecimento | null,
  agora: Date,
  indice: number,
): string {
  const nomeVet = txt(assinatura?.nome) || txt(d.profissional?.nome) || null;
  // 🔴 A imagem da assinatura é de QUEM ASSINA ESTE REGISTRO (o vínculo dele NESTA
  // empresa), e só na linha dele. As linhas extras (executor…) saem em branco para
  // assinar à mão — carimbar ali a assinatura do vet produziria documento falso.
  const assinaturas: BlocoAssinatura[] = [
    {
      nome:          nomeVet,
      cargo:         d.rotuloAssinatura ?? 'Médico(a) Veterinário(a) Responsável',
      assinaturaUrl: assinatura?.assinaturaUrl ?? null,
      crmv:          assinatura?.crmv ?? null,
    },
    ...(d.assinaturasExtras ?? []),
  ];
  const localData = linhaLocalEData(agora, est);

  return `
  <section class="fc-pagina${indice > 0 ? ' fc-quebra' : ''}">
    ${renderTopo(d, assinatura, est)}
    ${renderAnimal(d.animal)}
    <div class="fc-titulo-bloco">
      <h1 class="fc-titulo">${escFolha(p.titulo)}</h1>
      ${p.subtitulo ? `<div class="fc-subtitulo">${p.subtitulo}</div>` : ''}
    </div>
    <div class="fc-corpo">${p.corpoHtml}</div>
    <div class="fc-fecho">
      ${localData ? `<div class="fc-data">${escFolha(localData)}</div>` : ''}
      ${renderAssinaturas(assinaturas)}
      ${d.rodape ? `<div class="fc-rodape">${escFolha(d.rodape)}</div>` : ''}
    </div>
  </section>`;
}

// ─── CSS da folha ───────────────────────────────────────────────────────────

const FOLHA_CSS = `
  ${PRINT_SHELL_CSS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
  .fc-quebra { page-break-before: always; break-before: page; }

  .fc-topo {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 2pt solid #059669; padding-bottom: 10px; margin-bottom: 14px;
  }
  .fc-logo img   { max-height: 52px; max-width: 200px; object-fit: contain; }
  .fc-marca      { font-size: 22pt; font-weight: 700; color: #059669; line-height: 1; }
  .fc-vet        { text-align: right; line-height: 1.4; }
  .fc-vet-nome   { font-size: 14px; font-weight: 700; color: #111; }
  .fc-vet-crmv   { font-size: 12px; color: #374151; }
  .fc-vet-clinica{ font-size: 12px; font-weight: 600; color: #374151; margin-top: 2px; }
  .fc-vet-local  { font-size: 11px; color: #6b7280; max-width: 320px; margin-left: auto; }

  .fc-animal {
    display: flex; gap: 12px; align-items: flex-start;
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px;
  }
  .fc-animal-foto { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; flex-shrink: 0; }
  .fc-animal-grid { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 16px; }
  .fc-lbl { display: block; font-size: 10.5px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 1px; }
  .fc-val { font-size: 13px; font-weight: 600; color: #111; }

  .fc-titulo-bloco { text-align: center; margin-bottom: 14px; }
  .fc-titulo    { font-size: 18px; font-weight: 800; color: #111; text-transform: uppercase; letter-spacing: 0.06em; }
  .fc-subtitulo { font-size: 12px; color: #6b7280; margin-top: 3px; }

  .fc-fecho  { page-break-inside: avoid; break-inside: avoid; margin-top: 22px; }
  .fc-data   { text-align: right; font-size: 12.5px; color: #374151; }
  .fc-rodape { margin-top: 14px; padding-top: 6px; border-top: 0.5pt solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: right; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

// ─── Gerador ────────────────────────────────────────────────────────────────

/** HTML completo (`<!DOCTYPE html>…`) da folha. SÍNCRONO — ver o cabeçalho do arquivo. */
export function gerarHtmlFolhaClinica(d: FolhaClinica): string {
  const pid = d.profissional?.id ?? null;
  const assinatura = pid ? assinaturasResolvidas.get(pid) ?? null : null;
  const agora = new Date();
  const paginas = d.paginas.length > 0 ? d.paginas : [{ titulo: d.documento, corpoHtml: '' }];

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${escFolha(d.documento)}</title>
  <style>${FOLHA_CSS}${d.cssModulo ?? ''}</style>
</head>
<body>
${paginas.map((p, i) => renderPagina(d, p, assinatura, estabelecimento, agora, i)).join('\n')}
</body>
</html>`;
}
