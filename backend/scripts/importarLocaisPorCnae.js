// backend/scripts/importarLocaisPorCnae.js
//
// Extrai TODOS os estabelecimentos do Brasil que possuem (como CNAE principal OU
// secundário) um dos CNAEs de interesse para o cadastro de localizações do S2Vet,
// a partir da base de DADOS ABERTOS DO CNPJ da Receita Federal.
//
// ─── FONTE DOS DADOS (gratuita, país inteiro) ────────────────────────────────
// A Receita migrou (jan/2026) para um compartilhamento SERPRO+/Nextcloud. Abra no
// navegador e entre na pasta do mês mais recente (AAAA-MM):
//
//   https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9
//
//   Baixe da pasta do mês:
//     • Estabelecimentos0.zip … Estabelecimentos9.zip  (endereço + CNAE)
//     • Empresas0.zip … Empresas9.zip                   (razão social)
//     • Municipios.zip                                   (código → nome do município)
//
//   Download direto por linha de comando (WebDAV do compartilhamento; usuário = token
//   do share, senha vazia). Ex. (troque 2026-05 pelo mês publicado):
//     curl -u "YggdBLfdninEJX9:" -O \
//       "https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/2026-05/Estabelecimentos0.zip"
//
//   Extraia TODOS os .zip para uma pasta (ex.: D:\receita_cnpj\).
//   Os arquivos extraídos têm sufixos: *.ESTABELE, *.EMPRECSV, *.MUNICCSV
//   (CSV sem cabeçalho, separado por ';', aspas duplas, codificação LATIN1/ISO-8859-1).
//
// ─── USO ─────────────────────────────────────────────────────────────────────
//   node scripts/importarLocaisPorCnae.js --dir "D:\\receita_cnpj"
//   node scripts/importarLocaisPorCnae.js --dir "D:\\receita_cnpj" --insert   (grava no banco como SYSTEM)
//   node scripts/importarLocaisPorCnae.js --dir "D:\\receita_cnpj" --incluir-inativas
//
//   Precisão do CNAE (padrão = só PRINCIPAL):
//     • Por padrão só casa quem tem o CNAE como atividade PRINCIPAL (evita academias/
//       clubes genéricos que só têm o CNAE como secundário).
//     • --incluir-secundario  → amplia para casar também por CNAE secundário.
//
//   Reduzir falsos positivos (CNAEs genéricos de esporte trazem natação, futebol, etc.):
//     • --cnaes 0152102,9319101   → roda só os CNAEs escolhidos (ex.: só criação de eqüinos).
//     • --somente-equino          → nos CNAEs genéricos, mantém só nomes de cara equina
//                                   (haras/hípica/equino/…); o 0152-1/02 é sempre mantido.
//
//   Limpeza de import antigo (que trouxe secundários indevidos):
//     node scripts/importarLocaisPorCnae.js --dir "D:\\receita_cnpj" --limpar-secundarios
//       Remove do banco as localizações SYSTEM cujo CNAE PRINCIPAL não é alvo,
//       preservando as que já estão em uso (referenciadas por animal/tratador).
//
// Saída: scripts/output/locais_cnae_<timestamp>.csv  e  .json
//
'use strict';

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const readline = require('readline');
const { spawn } = require('child_process');

// ─── Configuração: CNAEs de interesse → tipoLocalizacao do S2Vet ─────────────
// Chave = CNAE com 7 dígitos, sem máscara (como aparece na base da Receita).
const CNAE_TIPO = {
  '0152102': 'HARAS',              // Criação de eqüinos (principal)
  '9319101': 'CLUBE_HIPICO',       // Produção/promoção de eventos esportivos (clubes hípicos)
  '9319199': 'CLUBE_HIPICO',       // Outras atividades esportivas (estábulos de hipódromos)
  '8591100': 'CENTRO_TREINAMENTO', // Ensino de esportes (escolas de equitação)
  '9312300': 'CLUBE',              // Clubes sociais e esportivos
  '0162803': 'HOTEL_ANIMAL',       // Serviço de manejo de animais (pensões de cavalos)
};
// ─── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? (args[i + 1] ?? true) : undefined;
};
const DIR              = getArg('--dir');
const INCLUIR_INATIVAS = args.includes('--incluir-inativas');
const DO_INSERT        = args.includes('--insert');
// Por padrão casa APENAS pelo CNAE PRINCIPAL (mais preciso — evita academias/clubes
// genéricos que só têm o CNAE como secundário). Use --incluir-secundario para ampliar.
const INCLUIR_SECUNDARIO = args.includes('--incluir-secundario');
// Modo de limpeza: remove do banco as localizações SYSTEM importadas cujo CNAE
// PRINCIPAL não é um dos alvos (ou seja, entraram só por secundário em import antigo).
const LIMPAR           = args.includes('--limpar-secundarios');
// Só mostra o que SERIA removido na limpeza, sem apagar nada.
const DRY_RUN          = args.includes('--dry-run');
// Escolhe quais CNAEs rodar (ex.: --cnaes 0152102,9319101). Sem isso, usa todos os do CNAE_TIPO.
const CNAES_ARG        = getArg('--cnaes');
// Mantém, nos CNAEs genéricos de esporte, apenas registros com nome de cara equina
// (haras/hípica/equino/…). O 0152-1/02 (criação de eqüinos) é sempre mantido.
const SOMENTE_EQUINO   = args.includes('--somente-equino');

const CNAES_ALVO = (() => {
  if (CNAES_ARG && CNAES_ARG !== true) {
    const pedidos = String(CNAES_ARG).split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
    const validos = pedidos.filter(c => CNAE_TIPO[c]);
    const invalidos = pedidos.filter(c => !CNAE_TIPO[c]);
    if (invalidos.length) console.warn(`[aviso] CNAEs ignorados (sem mapeamento de tipo): ${invalidos.join(', ')}`);
    if (validos.length === 0) { console.error('ERRO: nenhum CNAE válido em --cnaes.'); process.exit(1); }
    return new Set(validos);
  }
  return new Set(Object.keys(CNAE_TIPO));
})();

// Palavras que indicam atividade equina no nome/razão (para o filtro --somente-equino).
// Ampla de propósito: cobre equitação, equoterapia, hipismo, haras, jóquei, etc.
const EQUINO_REGEX = new RegExp([
  'equita',        // equitação / equitation
  'equestr',       // equestre
  'equin',         // equino / equina / equine
  'equid',         // equídeo / equidae
  'equoterap',     // equoterapia
  'hipoterap',     // hipoterapia
  'h[ií]pic',      // hípica / hípico
  'hipism',        // hipismo
  'hip[oó]drom',   // hipódromo
  'haras',
  'coudel',        // coudelaria
  'j[oó]quei', 'jockey',
  'turfe?',        // turf / turfe
  'cavalo', 'cavalar', 'cavalgad',
  'potr[oa]',      // potro / potra
  'montaria',
  'adestrament',   // adestramento
  'v[aá]quejad',   // vaquejada
  'r[ée]dea',      // rédea / redea
  'reining',
  'charret',       // charrete
].join('|'), 'i');

if (!DIR || DIR === true) {
  console.error('ERRO: informe a pasta com os arquivos extraídos da Receita: --dir "D:\\receita_cnpj"');
  process.exit(1);
}
if (!fs.existsSync(DIR)) {
  console.error(`ERRO: pasta não encontrada: ${DIR}`);
  process.exit(1);
}

// Binário do tar: no Windows força o bsdtar do sistema (System32\tar.exe), que lê
// ZIP — evita cair no GNU tar (Git Bash), que NÃO lê zip, caso esteja no PATH.
const TAR_BIN = (() => {
  if (process.platform === 'win32') {
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sys)) return sys;
  }
  return 'tar';
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Parser de linha CSV da Receita: separador ';', campos entre aspas duplas.
function parseCsvLinha(linha) {
  const campos = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (c === ';' && !dentroAspas) {
      campos.push(atual); atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos;
}

// Descobre as fontes de um tipo: prefere arquivos já EXTRAÍDOS (*.ESTABELE, etc.);
// se não houver, usa os .ZIP correspondentes (lidos via 'tar' sem descompactar em disco).
function descobrirFontes({ sufixoExtraido, prefixoZip }) {
  const arquivos = fs.readdirSync(DIR);
  const extraidos = arquivos
    .filter(f => f.toUpperCase().endsWith(sufixoExtraido))
    .map(f => ({ tipo: 'file', caminho: path.join(DIR, f) }));
  if (extraidos.length) return extraidos;
  const pz = prefixoZip.toUpperCase();
  return arquivos
    .filter(f => { const u = f.toUpperCase(); return u.startsWith(pz) && u.endsWith('.ZIP'); })
    .sort()
    .map(f => ({ tipo: 'zip', caminho: path.join(DIR, f) }));
}

// Lê linhas de um stream (latin1 já aplicado pelo caller quando necessário).
function streamLinhasStream(stream, onLinha) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', onLinha);
    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

// Lê linhas de uma fonte (arquivo extraído OU .zip via 'tar -xO' → stdout).
function streamFonte(fonte, onLinha) {
  if (fonte.tipo === 'file') {
    return streamLinhasStream(fs.createReadStream(fonte.caminho, { encoding: 'latin1' }), onLinha);
  }
  return new Promise((resolve, reject) => {
    // bsdtar/libarchive lê zip e extrai o(s) membro(s) para stdout, em streaming.
    const child = spawn(TAR_BIN, ['-xOf', fonte.caminho], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('latin1');
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', (e) => reject(new Error(
      `Falha ao executar 'tar' para ler ${path.basename(fonte.caminho)}: ${e.message}\n` +
      `→ No Windows 11 o 'tar' já vem instalado. Se não tiver, extraia os .zip manualmente (7-Zip) e rode de novo.`)));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`'tar' saiu com código ${code} em ${path.basename(fonte.caminho)}: ${stderr.slice(0, 300)}`));
    });
    streamLinhasStream(child.stdout, onLinha).then(resolve, reject);
  });
}

const soDigitos = (s) => (s ?? '').replace(/\D/g, '');
const fmtCnpj = (basico, ordem, dv) => {
  const n = `${basico}${ordem}${dv}`;
  if (n.length !== 14) return null;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
};
const fmtCep = (cep) => {
  const d = soDigitos(cep);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (d || null);
};
const fmtTelefone = (ddd, tel) => {
  const d = soDigitos(ddd), t = soDigitos(tel);
  if (!t) return null;
  return d ? `(${d}) ${t}` : t;
};
const limpar = (s) => (s ?? '').trim().replace(/\s+/g, ' ');
const truncar = (s, n) => (s && s.length > n ? s.slice(0, n) : s);

// ─── 1) Municípios (código Receita → nome) ───────────────────────────────────
async function carregarMunicipios() {
  const mapa = new Map();
  const fontes = descobrirFontes({ sufixoExtraido: '.MUNICCSV', prefixoZip: 'Municipios' });
  for (const fonte of fontes) {
    await streamFonte(fonte, (linha) => {
      const [cod, nome] = parseCsvLinha(linha);
      if (cod) mapa.set(cod, limpar(nome));
    });
  }
  console.log(`[municípios] ${mapa.size} carregados de ${fontes.length} arquivo(s)`);
  return mapa;
}

// ─── 2) Estabelecimentos: filtra por CNAE e grava NDJSON temporário ──────────
// Índices do layout de Estabelecimentos (0-based):
//  0 cnpj_basico 1 ordem 2 dv 3 matriz/filial 4 nome_fantasia 5 situacao
//  10 inicio_atividade 11 cnae_principal 12 cnae_secundaria 13 tipo_logradouro
//  14 logradouro 15 numero 16 complemento 17 bairro 18 cep 19 uf 20 municipio
//  21 ddd1 22 tel1 27 email
async function filtrarEstabelecimentos(tmpFile) {
  const fontes = descobrirFontes({ sufixoExtraido: '.ESTABELE', prefixoZip: 'Estabelecimentos' });
  if (fontes.length === 0) {
    console.error('ERRO: nenhum Estabelecimentos*.zip nem *.ESTABELE encontrado na pasta.');
    process.exit(1);
  }
  const bases = new Set();      // cnpj_basico dos matched (para resolver razão social)
  const out = fs.createWriteStream(tmpFile, { encoding: 'utf8' });
  let lidas = 0, casadas = 0;

  for (const fonte of fontes) {
    console.log(`[estabelecimentos] processando ${path.basename(fonte.caminho)} ...`);
    await streamFonte(fonte, (linha) => {
      lidas++;
      const c = parseCsvLinha(linha);
      if (c.length < 21) return;
      const situacao = c[5];
      if (!INCLUIR_INATIVAS && situacao !== '02') return; // 02 = ativa

      const principal = c[11];
      let cnaeMatch = null;
      if (CNAES_ALVO.has(principal)) {
        cnaeMatch = principal;                       // casa pelo CNAE PRINCIPAL
      } else if (INCLUIR_SECUNDARIO) {
        const secundarias = (c[12] || '').split(',').map(s => s.trim()).filter(Boolean);
        const s = secundarias.find(x => CNAES_ALVO.has(x));
        if (s) cnaeMatch = s;                        // só amplia para secundário sob demanda
      }
      if (!cnaeMatch) return;

      casadas++;
      bases.add(c[0]);
      const enderecoPartes = [
        limpar(`${c[13] ?? ''} ${c[14] ?? ''}`),
        c[15] && c[15] !== '' ? `nº ${limpar(c[15])}` : '',
        limpar(c[16]),
        limpar(c[17]),
      ].filter(Boolean);
      const registro = {
        cnpjBasico: c[0], ordem: c[1], dv: c[2],
        nomeFantasia: limpar(c[4]),
        situacao,
        cnaePrincipal: principal,
        cnaeMatch,
        tipoLocalizacao: CNAE_TIPO[cnaeMatch],
        endereco: enderecoPartes.join(', '),
        cep: c[18], uf: c[19], municipioCod: c[20],
        telefone: fmtTelefone(c[21], c[22]),
        email: limpar(c[27]),
      };
      out.write(JSON.stringify(registro) + '\n');
    });
  }
  await new Promise(r => out.end(r));
  console.log(`[estabelecimentos] ${lidas} linhas lidas, ${casadas} casaram os CNAEs (${bases.size} CNPJ-base distintos)`);
  return bases;
}

// ─── 3) Empresas: razão social apenas dos CNPJ-base casados ──────────────────
async function carregarRazoesSociais(bases) {
  const mapa = new Map();
  const fontes = descobrirFontes({ sufixoExtraido: '.EMPRECSV', prefixoZip: 'Empresas' });
  for (const fonte of fontes) {
    console.log(`[empresas] processando ${path.basename(fonte.caminho)} ...`);
    await streamFonte(fonte, (linha) => {
      const c = parseCsvLinha(linha);
      if (c.length < 2) return;
      if (bases.has(c[0])) mapa.set(c[0], limpar(c[1]));
    });
  }
  console.log(`[empresas] ${mapa.size} razões sociais resolvidas`);
  return mapa;
}

// ─── 4) Monta as linhas finais no formato da tabela de localização ───────────
function montarRegistro(r, razaoMap, muniMap) {
  const razao = razaoMap.get(r.cnpjBasico) ?? '';
  const nome = truncar(r.nomeFantasia || razao || `CNPJ ${r.cnpjBasico}`, 255);
  const municipio = muniMap.get(r.municipioCod) ?? '';
  const enderecoCompleto = truncar(
    [r.endereco, municipio && r.uf ? `${municipio}/${r.uf}` : (municipio || r.uf || '')]
      .filter(Boolean).join(' - '),
    500,
  );
  return {
    nome,
    cnpj: fmtCnpj(r.cnpjBasico, r.ordem, r.dv),
    cep: fmtCep(r.cep),
    endereco: enderecoCompleto || null,
    pessoaResponsavel: null,
    telefone: truncar(r.telefone, 30),
    tipoLocalizacao: r.tipoLocalizacao,
    // metadados (não vão para a tabela, úteis na conferência do CSV)
    _cnaePrincipal: r.cnaePrincipal,
    _cnaeMatch: r.cnaeMatch,
    _uf: r.uf,
    _municipio: municipio,
    _situacao: r.situacao,
    _razaoSocial: razao,
  };
}

// ─── 5) Persistência (CSV/JSON) e inserção opcional no banco ─────────────────
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── Limpeza: remove localizações SYSTEM importadas cujo CNAE PRINCIPAL não é alvo ──
// Com --somente-equino, também remove os de CNAE genérico de esporte (8591/9312/9319)
// cujo nome não é de cara equina — mantendo sempre o 0152-1/02 (criação de eqüinos).
async function limparSecundarios() {
  console.log('[limpar] modo limpeza: removendo localizações SYSTEM cujo CNAE principal não é um dos alvos'
    + (SOMENTE_EQUINO ? ' (+ genéricos de esporte sem nome equino)...' : '...'));
  // 1) Map CNPJ(14) → CNAE principal, apenas dos CNPJs cujo principal é um alvo.
  const fontes = descobrirFontes({ sufixoExtraido: '.ESTABELE', prefixoZip: 'Estabelecimentos' });
  if (fontes.length === 0) {
    console.error('ERRO: nenhum Estabelecimentos*.zip nem *.ESTABELE encontrado (necessário para a limpeza).');
    process.exit(1);
  }
  const principalPorCnpj = new Map();
  for (const fonte of fontes) {
    console.log(`[limpar] lendo ${path.basename(fonte.caminho)} ...`);
    await streamFonte(fonte, (linha) => {
      const c = parseCsvLinha(linha);
      if (c.length < 12) return;
      if (CNAES_ALVO.has(c[11])) principalPorCnpj.set(`${c[0]}${c[1]}${c[2]}`, c[11]);
    });
  }
  console.log(`[limpar] ${principalPorCnpj.size} CNPJ(s) com CNAE principal alvo`);

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const rows = await prisma.localizacaoAnimal.findMany({
    where: { tipoEntrada: 'SYSTEM', cnpj: { not: null } },
    select: { id: true, cnpj: true, nome: true },
  });
  const candidatos = rows.filter(r => {
    const d = soDigitos(r.cnpj);
    if (d.length !== 14) return false;
    const principal = principalPorCnpj.get(d);
    if (!principal) return true; // entrou por secundário (principal não é alvo) → remover
    // principal é alvo: com --somente-equino, remove genéricos de esporte sem nome equino
    if (SOMENTE_EQUINO && principal !== '0152102' && !EQUINO_REGEX.test(r.nome || '')) return true;
    return false;
  });
  console.log(`[limpar] ${candidatos.length} de ${rows.length} localizações SYSTEM com CNPJ serão removidas`);

  if (candidatos.length === 0) { await prisma.$disconnect(); return; }

  if (DRY_RUN) {
    console.log('\n[dry-run] NADA foi apagado. Amostra do que seria removido:');
    candidatos.slice(0, 30).forEach(r => console.log(`   - ${r.nome} (${r.cnpj})`));
    if (candidatos.length > 30) console.log(`   ... e mais ${candidatos.length - 30}.`);
    await prisma.$disconnect();
    return;
  }

  // 2) Não remove as que já estão em uso (animal ou tratador referenciando)
  const ids = candidatos.map(r => r.id);
  const referenced = new Set();
  const CH = 1000;
  for (let i = 0; i < ids.length; i += CH) {
    const lote = ids.slice(i, i + CH);
    const [a, t] = await Promise.all([
      prisma.animal.findMany({ where: { localizacaoId: { in: lote } }, select: { localizacaoId: true } }),
      prisma.tratador.findMany({ where: { localizacaoId: { in: lote } }, select: { localizacaoId: true } }),
    ]);
    a.forEach(x => referenced.add(x.localizacaoId));
    t.forEach(x => referenced.add(x.localizacaoId));
  }
  const deletaveis = candidatos.filter(r => !referenced.has(r.id)).map(r => r.id);
  const emUso = candidatos.length - deletaveis.length;

  let removidos = 0;
  for (let i = 0; i < deletaveis.length; i += CH) {
    const lote = deletaveis.slice(i, i + CH);
    const res = await prisma.localizacaoAnimal.deleteMany({ where: { id: { in: lote } } });
    removidos += res.count;
    console.log(`[limpar] removidos ${removidos}/${deletaveis.length}`);
  }
  console.log(`\n✅ Limpeza concluída: ${removidos} removidos; ${emUso} mantidos por estarem em uso (animal/tratador).`);
  await prisma.$disconnect();
}

async function main() {
  if (LIMPAR) { await limparSecundarios(); return; }

  const t0 = Date.now();
  const muniMap = await carregarMunicipios();

  const tmpFile = path.join(os.tmpdir(), `s2vet_locais_${Date.now()}.ndjson`);
  const bases   = await filtrarEstabelecimentos(tmpFile);
  const razaoMap = await carregarRazoesSociais(bases);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath  = path.join(outDir, `locais_cnae_${stamp}.csv`);
  const jsonPath = path.join(outDir, `locais_cnae_${stamp}.json`);

  const colunas = ['nome', 'cnpj', 'cep', 'endereco', 'telefone', 'tipoLocalizacao',
    '_cnaePrincipal', '_cnaeMatch', '_uf', '_municipio', '_situacao', '_razaoSocial'];
  const csv = fs.createWriteStream(csvPath, { encoding: 'utf8' });
  csv.write('﻿' + colunas.join(';') + '\n'); // BOM para abrir no Excel

  const registros = [];
  let descartadosNaoEquino = 0;
  await streamLinhasStream(fs.createReadStream(tmpFile, { encoding: 'utf8' }), (linha) => {
    if (!linha.trim()) return;
    const reg = montarRegistro(JSON.parse(linha), razaoMap, muniMap);
    // Filtro equino: nos CNAEs genéricos de esporte, mantém só nomes de cara equina.
    // 0152102 (criação de eqüinos) é sempre mantido.
    if (SOMENTE_EQUINO && reg._cnaeMatch !== '0152102'
      && !EQUINO_REGEX.test(`${reg.nome} ${reg._razaoSocial}`)) {
      descartadosNaoEquino++;
      return;
    }
    registros.push(reg);
    csv.write(colunas.map(k => csvEscape(reg[k])).join(';') + '\n');
  });
  if (SOMENTE_EQUINO) console.log(`[filtro equino] ${descartadosNaoEquino} descartados por não terem nome equino`);
  await new Promise(r => csv.end(r));
  fs.writeFileSync(jsonPath, JSON.stringify(registros, null, 2), 'utf8');
  fs.unlinkSync(tmpFile);

  console.log(`\n✅ ${registros.length} localizações geradas`);
  console.log(`   CSV : ${csvPath}`);
  console.log(`   JSON: ${jsonPath}`);
  // Resumo por tipo
  const porTipo = {};
  for (const r of registros) porTipo[r.tipoLocalizacao] = (porTipo[r.tipoLocalizacao] ?? 0) + 1;
  console.log('   Por tipo:', porTipo);
  console.log(`   Tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (DO_INSERT) await inserirNoBanco(registros);
}

async function inserirNoBanco(registros) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  console.log('\n[insert] gravando no banco como catálogo SYSTEM (empresaId null)...');

  // Deduplica contra o que já existe (por CNPJ, senão por nome+tipo)
  const existentes = await prisma.localizacaoAnimal.findMany({
    select: { cnpj: true, nome: true, tipoLocalizacao: true },
  });
  const cnpjSet = new Set(existentes.map(e => soDigitos(e.cnpj)).filter(Boolean));
  const nomeTipoSet = new Set(existentes.map(e => `${(e.nome || '').trim().toLowerCase()}|${e.tipoLocalizacao}`));

  const novos = [];
  const vistosCnpj = new Set();
  const vistosNomeTipo = new Set();
  for (const r of registros) {
    const cnpjD = soDigitos(r.cnpj);
    const chaveNT = `${r.nome.trim().toLowerCase()}|${r.tipoLocalizacao}`;
    if (cnpjD) {
      if (cnpjSet.has(cnpjD) || vistosCnpj.has(cnpjD)) continue;
      vistosCnpj.add(cnpjD);
    } else {
      if (nomeTipoSet.has(chaveNT) || vistosNomeTipo.has(chaveNT)) continue;
      vistosNomeTipo.add(chaveNT);
    }
    novos.push({
      nome: r.nome, cnpj: r.cnpj, cep: r.cep, endereco: r.endereco,
      pessoaResponsavel: r.pessoaResponsavel, telefone: r.telefone,
      tipoLocalizacao: r.tipoLocalizacao, tipoEntrada: 'SYSTEM',
      empresaId: null, equipeId: null,
    });
  }

  const CHUNK = 1000;
  let inseridos = 0;
  for (let i = 0; i < novos.length; i += CHUNK) {
    const lote = novos.slice(i, i + CHUNK);
    const res = await prisma.localizacaoAnimal.createMany({ data: lote, skipDuplicates: true });
    inseridos += res.count;
    console.log(`[insert] ${inseridos}/${novos.length}`);
  }
  console.log(`[insert] concluído: ${inseridos} inseridos (${registros.length - novos.length} ignorados por duplicidade)`);
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
