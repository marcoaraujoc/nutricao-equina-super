// src/modules/documentos/BlocoView.tsx
// Render de UM bloco como ele sai no papel.
//
// FONTE ÚNICA de aparência: o preview A4, a visualização mobile e o PDF (html2canvas
// fotografa exatamente este DOM) usam este mesmo componente. Duas implementações
// dariam um PDF diferente do que o vet viu na tela — o erro clássico deste tipo de
// editor.

import type { CSSProperties } from 'react';
import { assinaturaDoVeterinario, resolverVariaveis } from './catalogo';
import type { ContextoVariaveis } from './catalogo';
import { RE_LACUNA, chaveDaLacuna } from './campos';
import type { Preenchimento } from './campos';
import { colunasDaLista, linhasDoBloco, normalizarFonte } from './listas';
import type { PreenchimentoListas } from './listas';
import type { Bloco } from './types';

/**
 * O que o render precisa e que NÃO é texto: a logomarca da clínica e a imagem da
 * assinatura. Vem de `GET /documentos/contexto/:animalId` (`MarcaDocumento` em
 * ./api) e é `null` enquanto nenhum paciente foi escolhido.
 */
export interface MarcaFolha {
  logoUrl:       string | null;
  empresaNome:   string;
  assinaturaUrl: string | null;
  crmv:          string;
  assinanteNome: string;
}

/** Traduz as propriedades do bloco para CSS. */
function estiloDe(b: Bloco): CSSProperties {
  const e = b.estilo;
  return {
    fontSize:     e.tamanho ? `${e.tamanho}px` : undefined,
    fontWeight:   e.peso === 'bold' ? 700 : e.peso === 'semibold' ? 600 : e.peso === 'medium' ? 500 : 400,
    color:        e.cor ?? '#111827',
    textAlign:    e.alinhamento,
    marginTop:    e.espacamentoTopo ? `${e.espacamentoTopo}px` : undefined,
    marginBottom: e.espacamentoBase ? `${e.espacamentoBase}px` : undefined,
    width:        e.largura ? `${e.largura}%` : undefined,
    // DUAS COLUNAS: o bloco vira meia largura e os vizinhos se acomodam ao lado.
    // `inline-block` (e não grid/flex no pai) porque a folha é uma sequência plana de
    // blocos — não há wrapper de seção para virar container, e criar um mudaria o
    // contrato de todos os renderizadores. `padding-right` é a calha entre as colunas;
    // `border-box` impede que ela empurre o segundo campo para a linha de baixo.
    ...(e.colunas && e.colunas > 1
      ? {
          display:       'inline-block',
          verticalAlign: 'top',
          width:         `${100 / e.colunas}%`,
          paddingRight:  12,
          boxSizing:     'border-box' as const,
        }
      : {}),
  };
}

const bordaTabela = (b: Bloco): string =>
  b.estilo.borda === 'completa' ? '1px solid #d1d5db'
  : b.estilo.borda === 'inferior' ? '0 0 1px 0 solid' : 'none';

/** Linhas de exemplo das listas clínicas — o conteúdo real vem na emissão. */
const EXEMPLOS: Record<string, { colunas: string[]; linhas: string[][] }> = {
  'prescricao.medicamentos': {
    colunas: ['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração'],
    linhas: [
      ['Flunixin meglumine', '1,1 mg/kg', 'IV', '1x ao dia', '3 dias'],
      ['Fenilbutazona',      '2,2 mg/kg', 'VO', '12 em 12h', '5 dias'],
    ],
  },
  'prescricao.procedimentos': {
    colunas: ['Procedimento', 'Quantidade', 'Observação'],
    linhas: [['Curativo do casco', '1', 'Reavaliar em 48h']],
  },
  'vacinas.aplicadas': {
    colunas: ['Vacina', 'Lote', 'Data', 'Próxima dose'],
    linhas: [['Influenza equina', 'L-2291', '12/05/2026', '12/11/2026']],
  },
  'exames.resultados': {
    colunas: ['Exame', 'Resultado', 'Referência'],
    linhas: [['Hemoglobina', '12,4 g/dL', '11 – 17'], ['Hematócrito', '38 %', '32 – 48']],
  },
  'consulta.itens': {
    colunas: ['Descrição', 'Qtd', 'Valor'],
    linhas: [['Consulta a campo', '1', 'R$ 350,00']],
  },
  'historico.eventos': { colunas: [], linhas: [] },
};

function TabelaSimples({ b, colunas, linhas, contexto }: {
  b: Bloco; colunas: string[]; linhas: string[][]; contexto?: ContextoVariaveis | null;
}) {
  const completa = b.estilo.borda === 'completa';
  const cel: CSSProperties = {
    padding: '4px 6px',
    border: completa ? '1px solid #d1d5db' : undefined,
    borderBottom: completa ? '1px solid #d1d5db' : '1px solid #e5e7eb',
    textAlign: 'left',
  };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: b.estilo.tamanho ?? 11 }}>
      <thead>
        <tr>
          {colunas.map((c, i) => (
            <th key={i} style={{ ...cel, fontWeight: 600, background: completa ? '#f9fafb' : undefined }}>
              {resolverVariaveis(c, contexto)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((linha, i) => (
          <tr key={i}>
            {colunas.map((_, j) => (
              // ` ` (espaço rígido) na célula vazia: sem ele a linha colapsa e a
              // tabela do template recém-criado aparece como um traço só.
              <td key={j} style={cel}>{resolverVariaveis(linha[j] ?? '', contexto) || ' '}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Realce do campo que está sendo editado no formulário de emissão. */
const DESTAQUE: CSSProperties = {
  background: '#fef9c3',           // amber-100: some na impressão em P&B
  boxShadow: '0 0 0 2px #fde68a',
  borderRadius: 3,
};

/**
 * Uma LACUNA na folha.
 *
 * Vazia, é o traço do papel — e é CLICÁVEL: tocar nela foca o campo correspondente no
 * formulário, que é metade da interatividade (a outra metade é o contrário, focar o
 * campo e ver onde ele cai na folha).
 *
 * ⚠️ `<span>` e não `<button>`: isto vive DENTRO de um parágrafo justificado e o
 * botão quebraria o fluxo do texto. O papel do botão (foco por teclado) não se aplica
 * — a folha é pré-visualização; quem navega por teclado usa o formulário ao lado.
 */
function Lacuna({ rotulo, valor, focado, onClick }: {
  rotulo: string; valor: string; focado: boolean; onClick?: () => void;
}) {
  const base: CSSProperties = {
    ...(focado ? DESTAQUE : {}),
    cursor: onClick ? 'pointer' : undefined,
  };
  // `data-focado` é o que a tela de emissão procura para ROLAR a folha até o campo
  // que acabou de receber foco no formulário. Sem ele o destaque existe mas pode
  // estar fora da dobra, e a folha parece não ter reagido.
  if (valor) return <span data-focado={focado ? '1' : undefined} style={{ ...base, fontWeight: 600 }} onClick={onClick}>{valor}</span>;
  return (
    <span
      data-focado={focado ? '1' : undefined}
      onClick={onClick}
      title={onClick ? `Preencher: ${rotulo}` : rotulo}
      style={{
        ...base,
        display: 'inline-block', minWidth: 110,
        borderBottom: '1px solid #9ca3af',
        color: '#c7cdd6', fontSize: '0.85em',
      }}
    >
      {/* O rótulo aparece em cinza-claro DENTRO do traço: sem ele o vet vê cinco
          linhas iguais e não sabe qual é qual. Na impressão o cinza some. */}
      {rotulo}
    </span>
  );
}

/**
 * Render de UM bloco.
 *
 * `contexto` ausente = modo EXEMPLO (montando o modelo, sem paciente). Presente =
 * dados reais do paciente selecionado. Ver `resolverVariaveis` em ./catalogo.
 */
export default function BlocoView({ bloco, contexto, marca, preenchimento, listas, campoFocado, onFocarCampo }: {
  bloco:     Bloco;
  contexto?: ContextoVariaveis | null;
  marca?:    MarcaFolha | null;
  /** O que a pessoa digitou na tela de emissão, por chave de rótulo. */
  preenchimento?: Preenchimento | null;
  /** As linhas dos grupos REPETÍVEIS (medicamento, vacina…), por chave de grupo. */
  listas?:        PreenchimentoListas | null;
  /** Chave do campo em edição — fica destacado na folha. */
  campoFocado?:   string | null;
  /** Clicar numa lacuna da folha foca o campo correspondente no formulário. */
  onFocarCampo?:  (chave: string) => void;
}) {
  if (!bloco.visivel) return null;
  const st = estiloDe(bloco);
  const c  = bloco.conteudo;

  /**
   * Resolve variáveis e transforma cada LACUNA num pedaço próprio do JSX.
   *
   * ⚠️ `[[Rótulo]]` NUNCA aparece cru na tela — vazia vira um traço; preenchida, o
   * valor. O traço é clicável e destacável, que é o que liga a folha ao formulário:
   * a pessoa vê onde o campo cai no papel antes de digitar.
   */
  const rv = (t: string): React.ReactNode => {
    const texto = resolverVariaveis(t ?? '', contexto);
    if (!texto || !texto.includes('[[')) return texto;

    const partes: React.ReactNode[] = [];
    let ultimo = 0;
    for (const m of texto.matchAll(RE_LACUNA)) {
      const inicio = m.index ?? 0;
      if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
      const chave = chaveDaLacuna(m[1]);
      const valor = (preenchimento?.[chave] ?? '').trim();
      partes.push(
        <Lacuna
          key={`${chave}-${inicio}`}
          rotulo={m[1]} valor={valor}
          focado={campoFocado === chave}
          onClick={onFocarCampo ? () => onFocarCampo(chave) : undefined}
        />,
      );
      ultimo = inicio + m[0].length;
    }
    if (ultimo < texto.length) partes.push(texto.slice(ultimo));
    return <>{partes}</>;
  };

  /** Valor digitado para um campo cujo rótulo é a chave (campoAuto/observações). */
  const doRotulo = (rotulo?: string) => (rotulo ? (preenchimento?.[chaveDaLacuna(rotulo)] ?? '').trim() : '');
  const focadoNoRotulo = (rotulo?: string) => Boolean(rotulo && campoFocado === chaveDaLacuna(rotulo));

  switch (bloco.tipo) {
    case 'titulo':
      return <h1 style={{ ...st, letterSpacing: '0.02em' }}>{rv(c.texto ?? '')}</h1>;

    case 'subtitulo':
      return (
        <h2 style={{ ...st, borderBottom: bloco.estilo.borda === 'inferior' ? '1px solid #e5e7eb' : undefined,
                     paddingBottom: bloco.estilo.borda === 'inferior' ? 3 : undefined }}>
          {rv(c.texto ?? '')}
        </h2>
      );

    case 'texto':
      return <p style={{ ...st, whiteSpace: 'pre-wrap' }}>{rv(c.texto ?? '')}</p>;

    case 'linha':
      return <hr style={{ ...st, border: 0, borderTop: '1px solid #e5e7eb' }} />;

    case 'campoAuto': {
      // 🔴 O VALOR GRAVADO VENCE. No documento EMITIDO o backend resolveu a variável e
      // guardou o resultado em `conteudo.texto`, PRESERVANDO a chave em `variavel` (é
      // o que permite auditar de qual variável saiu cada valor). Resolver `variavel`
      // de novo aqui exigiria o contexto DAQUELE dia — e sem contexto
      // `resolverVariaveis` cai no modo EXEMPLO do catálogo: o papel real saía com
      // "Thor" no nome do animal e "Haras Boa Vista" no responsável, por cima do dado
      // correto que está no snapshot (defeito relatado em 2026-09-03).
      // ⚠️ É também o que alinha esta tela ao `utils/DocumentoPrint.ts`, que sempre
      // usou `texto` — a folha impressa saía certa e só a da TELA mentia.
      // No MODELO o campoAuto não tem `texto` (o editor só edita rótulo e variável),
      // então o caminho do editor e o da emissão continuam resolvendo pelo contexto.
      const gravado    = (c.texto ?? '').trim();
      const doCadastro = gravado || resolverVariaveis(c.variavel ?? '', contexto).trim();
      const digitado   = doRotulo(c.rotulo);
      return (
        <p data-focado={focadoNoRotulo(c.rotulo) ? '1' : undefined}
           style={{ ...st, ...(focadoNoRotulo(c.rotulo) ? DESTAQUE : {}) }}>
          <span style={{ color: '#6b7280' }}>{c.rotulo}: </span>
          {doCadastro
            ? <span style={{ fontWeight: 600 }}>{doCadastro}</span>
            : <Lacuna rotulo={c.rotulo ?? ''} valor={digitado}
                      focado={focadoNoRotulo(c.rotulo)}
                      onClick={onFocarCampo && c.rotulo ? () => onFocarCampo(chaveDaLacuna(c.rotulo!)) : undefined} />}
        </p>
      );
    }

    case 'imagem':
      return (
        <div style={{ ...st, textAlign: bloco.estilo.alinhamento ?? 'center' }}>
          {c.url ? (
            // `altura: 0` = ALTURA AUTOMÁTICA, e não "imagem de zero pixel". É a
            // convenção do documento ENVIADO pela clínica (ver modules/documentos/
            // upload.ts), em que a imagem É a folha: o padrão de 160px, pensado para
            // uma foto de exame no meio do texto, entregaria uma tira do documento.
            // ⚠️ `?? 160` sozinho não serve — `0` não é nullish e viraria `height: 0`.
            <img src={c.url} alt={c.rotulo ?? ''}
                 style={{ maxWidth: '100%', height: bloco.estilo.altura || 'auto', objectFit: 'contain' }} />
          ) : (
            <div style={{ height: bloco.estilo.altura ?? 160, border: '1px dashed #d1d5db', borderRadius: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 11 }}>
              {c.rotulo || 'Imagem'}
            </div>
          )}
        </div>
      );

    case 'checklist':
      return (
        <ul style={{ ...st, listStyle: 'none', padding: 0, margin: 0 }}>
          {(c.itens ?? []).map((item, i) => (
            <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ width: 11, height: 11, border: '1px solid #9ca3af', borderRadius: 2, flexShrink: 0, marginTop: 2 }} />
              <span>{rv(item)}</span>
            </li>
          ))}
        </ul>
      );

    case 'tabela':
      return (
        <div style={st}>
          <TabelaSimples b={bloco} colunas={c.colunas ?? []} linhas={c.linhas ?? []} contexto={contexto} />
        </div>
      );

    // LISTAS REPETÍVEIS — ver ./listas.ts. Dois estados, e a diferença é ter ou não
    // alguém preenchendo:
    //   COM `listas` (emissão / pré-visualização) → as linhas REAIS, já sugeridas a
    //     partir do que o paciente tem e editadas no repetidor ao lado.
    //   SEM (editor, montando o modelo) → a linha de EXEMPLO do catálogo e a legenda,
    //     que é como o vet vê a cara da tabela antes de existir paciente.
    // ⚠️ A legenda "Preenchido na emissão" era uma promessa que NADA cumpria até
    // 2026-09-01: no papel estes blocos saíam vazios. Agora é verdade.
    case 'listaCampos':
    case 'tabelaDinamica':
    case 'medicamentos':
    case 'vacinas':
    case 'procedimentos':
    case 'exames': {
      const colunas = colunasDaLista(bloco);
      const preenchidas = linhasDoBloco(bloco, listas);
      if (preenchidas) {
        // Nenhuma linha preenchida ainda: uma linha em branco mostra a tabela que vai
        // existir, em vez de um bloco que some da folha e reaparece ao digitar.
        const linhas = preenchidas.length > 0 ? preenchidas : [colunas.map(() => '')];
        // FORMATO `campos`: o grupo sai como os demais cards do documento ("Rótulo:
        // valor", três por linha) em vez de uma tabela — sete colunas numa A4 retrato
        // espremem o nome comercial em três linhas. ESPELHO de
        // `lib/documentoListas.js#linhaEmCampos`, que faz o mesmo no papel emitido; o
        // que se vê aqui é o que vai sair.
        if (c.formato === 'campos') {
          return (
            <div style={st}>
              {linhas.map((linha, iLinha) => (
                <div key={iLinha}>
                  {iLinha > 0 && (
                    <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '6px 0' }} />
                  )}
                  {colunas.map((coluna, i) => {
                    const valor = String(linha[i] ?? '').trim();
                    // Em branco não vira campo — a mesma regra do papel.
                    if (!valor) return null;
                    return (
                      // UM POR LINHA (a pedido): os rótulos da vacina são longos e, em
                      // fração de linha, rótulo e valor disputavam o mesmo espaço.
                      <p key={coluna} style={{ fontSize: 11, margin: '0 0 3px' }}>
                        <span style={{ color: '#6b7280' }}>{coluna}: </span>
                        <span style={{ fontWeight: 600 }}>{resolverVariaveis(valor, contexto)}</span>
                      </p>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        }
        return (
          <div style={st}>
            <TabelaSimples b={bloco} colunas={colunas} linhas={linhas} contexto={contexto} />
          </div>
        );
      }
      const fonte = EXEMPLOS[normalizarFonte(c.fonteDados) ?? ''] ?? { colunas, linhas: [] };
      return (
        <div style={st}>
          <TabelaSimples b={bloco} colunas={fonte.colunas} linhas={fonte.linhas} contexto={contexto} />
          <p style={{ fontSize: 9, color: '#9ca3af', marginTop: 3 }}>
            {c.fonteDados
              ? `Preenchido na emissão a partir de ${c.fonteDados}`
              : 'Preenchido na emissão — permite acrescentar linhas'}
          </p>
        </div>
      );
    }

    case 'linhaTempo':
      return (
        <div style={st}>
          {['02/08/2026 — Consulta a campo', '12/05/2026 — Vacinação', '28/03/2026 — Exame locomotor'].map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: '#10b981', marginTop: 5, flexShrink: 0 }} />
              <span>{ev}</span>
            </div>
          ))}
          <p style={{ fontSize: 9, color: '#9ca3af' }}>Preenchido na emissão a partir de {c.fonteDados}</p>
        </div>
      );

    case 'observacoes': {
      // Área livre: o modelo costuma vir vazio e o texto entra na emissão.
      const escrito = String(c.texto ?? '').trim() ? rv(c.texto ?? '') : doRotulo(c.rotulo);
      const focado  = focadoNoRotulo(c.rotulo);
      return (
        <div style={st}>
          <p style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>{c.rotulo || 'Observações'}</p>
          <div
            data-focado={focado ? '1' : undefined}
            onClick={onFocarCampo && c.rotulo ? () => onFocarCampo(chaveDaLacuna(c.rotulo!)) : undefined}
            style={{
              minHeight: bloco.estilo.altura ?? 90,
              border: focado ? '1px solid #059669' : (bordaTabela(bloco) === 'none' ? '1px solid #e5e7eb' : '1px solid #d1d5db'),
              borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap',
              cursor: onFocarCampo && c.rotulo ? 'pointer' : undefined,
              ...(focado ? DESTAQUE : {}),
            }}
          >
            {escrito}
          </div>
        </div>
      );
    }

    case 'assinatura': {
      // 🔴 A identidade da MARCA só entra na linha DO VETERINÁRIO. Farmacêutico,
      // comprador e responsável pelo animal assinam à mão, em linha vazia — ver
      // `assinaturaDoVeterinario` para o defeito que isto corrige.
      const doVet = assinaturaDoVeterinario(c);
      // Nome e CRMV vêm da MARCA (o vínculo do profissional NESTA empresa) quando há
      // paciente carregado; sem paciente, caem na variável — que no modo exemplo
      // mostra o valor do catálogo, e é o que faz a folha ter cara de folha.
      const nomeAssinante = doVet ? (marca?.assinanteNome || rv('{{veterinario.nome}}')) : '';
      const crmvAssinante = doVet ? (marca?.crmv || rv('{{veterinario.crmv}}')) : '';
      const larguraLinha  = 240;
      return (
        <div style={{ ...st, textAlign: bloco.estilo.alinhamento ?? 'center', marginTop: bloco.estilo.espacamentoTopo ?? 30 }}>
          <div style={{ width: larguraLinha, margin: bloco.estilo.alinhamento === 'left' ? '0' : '0 auto' }}>
            {/* A imagem fica SOBRE a linha, encostada nela — é como a assinatura cai
                no papel. Sem assinatura cadastrada, sobra o espaço em branco para
                assinar à mão: nunca se desenha uma assinatura que não existe.
                ⚠️ O espaço é MANTIDO na linha de outra pessoa: é onde ela assina. */}
            <div style={{ height: 42, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              {doVet && marca?.assinaturaUrl && (
                <img
                  src={marca.assinaturaUrl}
                  alt=""
                  style={{ maxHeight: 42, maxWidth: larguraLinha, objectFit: 'contain' }}
                />
              )}
            </div>
            <div style={{ borderTop: '1px solid #374151', paddingTop: 4 }}>
              {nomeAssinante && <p style={{ fontSize: 11, fontWeight: 600 }}>{nomeAssinante}</p>}
              <p style={{ fontSize: 10, color: '#6b7280' }}>{c.rotulo}</p>
              {doVet && c.mostrarCrmv && crmvAssinante && (
                <p style={{ fontSize: 10, color: '#6b7280' }}>{crmvAssinante}</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    case 'qrcode':
      return (
        <div style={{ ...st, textAlign: bloco.estilo.alinhamento ?? 'right' }}>
          <div style={{ display: 'inline-block', textAlign: 'center' }}>
            {/* Placeholder gráfico: gerar o QR de verdade exige uma lib ou o backend
                (o código só existe depois que o documento é emitido e ganha número). */}
            <div style={{ width: bloco.estilo.altura ?? 90, height: bloco.estilo.altura ?? 90,
                          background: 'repeating-conic-gradient(#111827 0% 25%, #ffffff 0% 50%) 50% / 8px 8px',
                          borderRadius: 4 }} />
            <p style={{ fontSize: 8, color: '#9ca3af', marginTop: 3 }}>{c.rotulo}</p>
          </div>
        </div>
      );

    case 'rodape':
      return (
        <p style={{ ...st, borderTop: '1px solid #e5e7eb', paddingTop: 6 }}>
          {rv(c.texto ?? '')}
        </p>
      );

    default:
      return null;
  }
}
