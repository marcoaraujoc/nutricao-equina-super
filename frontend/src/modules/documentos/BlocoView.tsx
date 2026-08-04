// src/modules/documentos/BlocoView.tsx
// Render de UM bloco como ele sai no papel.
//
// FONTE ÚNICA de aparência: o preview A4, a visualização mobile e o PDF (html2canvas
// fotografa exatamente este DOM) usam este mesmo componente. Duas implementações
// dariam um PDF diferente do que o vet viu na tela — o erro clássico deste tipo de
// editor.

import type { CSSProperties } from 'react';
import { resolverVariaveis } from './catalogo';
import type { Bloco } from './types';

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

function TabelaSimples({ b, colunas, linhas }: { b: Bloco; colunas: string[]; linhas: string[][] }) {
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
              {resolverVariaveis(c)}
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
              <td key={j} style={cel}>{resolverVariaveis(linha[j] ?? '') || ' '}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BlocoView({ bloco }: { bloco: Bloco }) {
  if (!bloco.visivel) return null;
  const st = estiloDe(bloco);
  const c  = bloco.conteudo;

  switch (bloco.tipo) {
    case 'titulo':
      return <h1 style={{ ...st, letterSpacing: '0.02em' }}>{resolverVariaveis(c.texto ?? '')}</h1>;

    case 'subtitulo':
      return (
        <h2 style={{ ...st, borderBottom: bloco.estilo.borda === 'inferior' ? '1px solid #e5e7eb' : undefined,
                     paddingBottom: bloco.estilo.borda === 'inferior' ? 3 : undefined }}>
          {resolverVariaveis(c.texto ?? '')}
        </h2>
      );

    case 'texto':
      return <p style={{ ...st, whiteSpace: 'pre-wrap' }}>{resolverVariaveis(c.texto ?? '')}</p>;

    case 'linha':
      return <hr style={{ ...st, border: 0, borderTop: '1px solid #e5e7eb' }} />;

    case 'campoAuto':
      return (
        <p style={st}>
          <span style={{ color: '#6b7280' }}>{c.rotulo}: </span>
          <span style={{ fontWeight: 600 }}>{resolverVariaveis(c.variavel ?? '')}</span>
        </p>
      );

    case 'imagem':
      return (
        <div style={{ ...st, textAlign: bloco.estilo.alinhamento ?? 'center' }}>
          {c.url ? (
            <img src={c.url} alt={c.rotulo ?? ''} style={{ maxWidth: '100%', height: bloco.estilo.altura ?? 160, objectFit: 'contain' }} />
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
              <span>{resolverVariaveis(item)}</span>
            </li>
          ))}
        </ul>
      );

    case 'tabela':
      return (
        <div style={st}>
          <TabelaSimples b={bloco} colunas={c.colunas ?? []} linhas={c.linhas ?? []} />
        </div>
      );

    case 'tabelaDinamica':
    case 'medicamentos':
    case 'vacinas':
    case 'procedimentos':
    case 'exames': {
      const fonte = EXEMPLOS[c.fonteDados ?? ''] ?? { colunas: c.colunas ?? [], linhas: [] };
      return (
        <div style={st}>
          <TabelaSimples b={bloco} colunas={fonte.colunas} linhas={fonte.linhas} />
          <p style={{ fontSize: 9, color: '#9ca3af', marginTop: 3 }}>
            Preenchido na emissão a partir de {c.fonteDados}
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

    case 'observacoes':
      return (
        <div style={st}>
          <p style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>{c.rotulo || 'Observações'}</p>
          <div style={{ minHeight: bloco.estilo.altura ?? 90, border: bordaTabela(bloco) === 'none' ? '1px solid #e5e7eb' : '1px solid #d1d5db',
                        borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap' }}>
            {resolverVariaveis(c.texto ?? '')}
          </div>
        </div>
      );

    case 'assinatura':
      return (
        <div style={{ ...st, textAlign: bloco.estilo.alinhamento ?? 'center', marginTop: bloco.estilo.espacamentoTopo ?? 30 }}>
          <div style={{ borderTop: '1px solid #374151', width: 240, margin: bloco.estilo.alinhamento === 'left' ? '0' : '0 auto', paddingTop: 4 }}>
            <p style={{ fontSize: 11, fontWeight: 600 }}>{resolverVariaveis('{{veterinario.nome}}')}</p>
            <p style={{ fontSize: 10, color: '#6b7280' }}>{c.rotulo}</p>
            {c.mostrarCrmv && <p style={{ fontSize: 10, color: '#6b7280' }}>{resolverVariaveis('{{veterinario.crmv}}')}</p>}
          </div>
        </div>
      );

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
          {resolverVariaveis(c.texto ?? '')}
        </p>
      );

    default:
      return null;
  }
}
