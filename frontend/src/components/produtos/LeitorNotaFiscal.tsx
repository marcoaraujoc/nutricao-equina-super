// frontend/src/components/produtos/LeitorNotaFiscal.tsx
//
// LEITURA DO DOCUMENTO DE COMPRA do fornecedor (2026-09-10).
//
// 🔴 O CRITÉRIO É "DOCUMENTO DE COMPRA", NÃO "DOCUMENTO FISCAL". Vale nota fiscal,
// cupom, ORÇAMENTO DE BALCÃO e recibo — o balcão do fornecedor veterinário entrega o
// tempo todo papel com "SEM VALOR FISCAL" impresso, e ele traz emitente, itens,
// quantidade e preço, que é tudo o que esta tela precisa. Validade fiscal nunca foi
// requisito: daqui sai catálogo e preço de compra, não escrituração contábil.
// ⚠️ O RÓTULO da tela tem de dizer isso. Enquanto ele dizia só "nota fiscal", quem
// estava com um orçamento na mão não tentava — a recusa acontecia antes do upload.
//
// 🔴 O QUE ISTO RESOLVE: a clínica recebe a nota e redigita item por item — nome,
// quantidade, valor —, e ainda cadastra o fornecedor à mão quando é a primeira compra
// dele. Aqui a nota é lida e o formulário nasce preenchido.
//
// 🔴 O RESULTADO É PROPOSTA, NUNCA CADASTRO. Nada é gravado por este componente: ele
// mostra o que a IA leu, a pessoa confere, escolhe os itens e só então a tela de
// Produtos salva. É o que torna aceitável um erro de leitura — vira uma correção de
// campo, não um produto errado no catálogo.
//
// ⚠️ O QUE SOBE É SEMPRE IMAGEM. PDF é convertido no NAVEGADOR, uma imagem por
// página, reusando `modules/documentos/upload.ts` — o MESMO caminho do documento
// enviado à Central. Uma segunda conversão de PDF no projeto divergiria da primeira
// na correção seguinte, e o que divergiria é a legibilidade do que a IA lê.
import { useState, useRef } from 'react';
import { FileText, Loader2, X, Check, AlertTriangle, Upload } from 'lucide-react';
import api from '../../services/api';
import { paginasDoArquivo } from '../../modules/documentos/upload';

/** Um item lido da nota — o que vai preencher o formulário de produto. */
export interface ItemNota {
  nome:          string;
  tipo:          'medicamento' | 'vacina';
  quantidade:    number | null;
  unidade:       string | null;
  valorUnitario: number | null;
  valorTotal:    number | null;
  lote:          string | null;
  validade:      string | null;
}

/** O emitente da nota — vira o cadastro de fornecedor quando ele ainda não existe. */
export interface FornecedorNota {
  nome:     string | null;
  cnpj:     string | null;
  cpf:      string | null;
  telefone: string | null;
  email:    string | null;
  cep:      string | null;
  endereco: string | null;
  bairro:   string | null;
  cidade:   string | null;
  estado:   string | null;
}

export interface NotaLida {
  ehNotaFiscal: boolean;
  motivo?:      string;
  numero:       string | null;
  dataEmissao:  string | null;
  fornecedor:   FornecedorNota;
  itens:        ItemNota[];
  /** Preenchido quando o fornecedor da nota JÁ está cadastrado nesta clínica. */
  fornecedorExistente: { id: number; nome: string; tipoServico: string | null } | null;
}

const brl = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  aberto:   boolean;
  onFechar: () => void;
  /** Recebe a nota lida e os itens que a pessoa MARCOU para cadastrar. */
  onUsar:   (nota: NotaLida, itens: ItemNota[]) => void;
}

export default function LeitorNotaFiscal({ aberto, onFechar, onUsar }: Props) {
  const [lendo,  setLendo]  = useState(false);
  const [erro,   setErro]   = useState<string | null>(null);
  const [nota,   setNota]   = useState<NotaLida | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  if (!aberto) return null;

  const escolherArquivo = async (file: File | null) => {
    if (!file) return;
    setErro(null);
    setNota(null);
    setLendo(true);
    try {
      // PDF → imagens no navegador; imagem passa direto (comprimida).
      const { paginas, texto } = await paginasDoArquivo(file);
      const form = new FormData();
      paginas.forEach((p, i) => form.append('paginas', p, `nota-${i + 1}.jpg`));
      // O texto embutido viaja JUNTO das imagens: ele dá os números exatos (nenhum
      // OCR erra um dígito que já está lá) e a imagem dá a estrutura das colunas.
      if (texto) form.append('texto', texto);

      const res = await api.post('/cadastro/produtos/nota-fiscal', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // A leitura carrega imagens e espera o modelo ler a folha — sem timeout
        // explícito, um travamento de rede fica pendurado para sempre.
        timeout: 180000,
      });
      const lida: NotaLida | undefined = res.data?.dados;
      if (!lida) { setErro('Não foi possível ler o documento.'); return; }
      if (!lida.ehNotaFiscal) { setErro(lida.motivo || 'Não foi possível identificar uma compra neste arquivo.'); return; }
      if (lida.itens.length === 0) {
        setErro('O documento foi lido, mas nenhum produto foi identificado nele.');
        return;
      }
      setNota(lida);
      // Todos marcados por padrão: quem abriu a nota quer cadastrar o que ela traz;
      // desmarcar o que não interessa é menos trabalho que marcar item a item.
      setMarcados(new Set(lida.itens.map((_, i) => i)));
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { status?: number; data?: { error?: string } }; message?: string };
      if (e.response?.status === 429) {
        setErro('O limite de uso de IA do plano foi atingido. Fale com o responsável pela clínica.');
      } else if (!e.isPermissionError) {
        setErro(e.response?.data?.error ?? e.message ?? 'Erro ao ler o documento.');
      }
    } finally {
      setLendo(false);
      // Zera o input: escolher o MESMO arquivo de novo não dispara `change` sem isto.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const alternar = (i: number) => {
    setMarcados(prev => {
      const novo = new Set(prev);
      if (novo.has(i)) novo.delete(i); else novo.add(i);
      return novo;
    });
  };

  const usar = () => {
    if (!nota) return;
    const escolhidos = nota.itens.filter((_, i) => marcados.has(i));
    if (escolhidos.length === 0) return;
    onUsar(nota, escolhidos);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl border border-gray-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <FileText size={18} className="text-emerald-600" /> Ler documento de compra
          </h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {!nota && (
            <>
              <p className="text-sm text-gray-500 leading-snug">
                Envie o documento de compra do fornecedor (PDF ou foto): <strong>nota fiscal,
                cupom, orçamento de balcão ou recibo</strong> — inclusive sem valor fiscal. Os
                produtos, os valores e os dados do fornecedor são lidos e trazidos para o
                formulário — <strong>nada é cadastrado sem a sua confirmação</strong>.
              </p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={lendo}
                className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 hover:border-emerald-400 rounded-2xl py-10 transition-colors disabled:opacity-60"
              >
                {lendo
                  ? <><Loader2 size={26} className="animate-spin text-emerald-500" />
                      <span className="text-sm text-gray-500">Lendo o documento…</span></>
                  : <><Upload size={26} className="text-gray-300" />
                      <span className="text-sm text-gray-500">Escolher o arquivo</span>
                      <span className="text-[11px] text-gray-400">PDF, JPG, PNG ou WEBP — até 15 MB</span></>}
              </button>
              <input ref={inputRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden"
                onChange={e => escolherArquivo(e.target.files?.[0] ?? null)} />
            </>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-amber-800 leading-snug">{erro}</p>
                <p className="text-[11px] text-amber-700 mt-1">
                  O cadastro manual continua disponível — feche e preencha os campos.
                </p>
              </div>
            </div>
          )}

          {nota && (
            <>
              {/* O FORNECEDOR: já cadastrado (emerald) ou a cadastrar (âmbar). É esta
                  distinção que decide o próximo passo da tela de Produtos. */}
              <div className={`rounded-xl border px-3 py-2.5 ${
                nota.fornecedorExistente ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
              }`}>
                <p className={`text-xs font-semibold ${nota.fornecedorExistente ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {nota.fornecedorExistente
                    ? `Fornecedor já cadastrado: ${nota.fornecedorExistente.nome}`
                    : `Fornecedor novo: ${nota.fornecedor.nome ?? 'não identificado na nota'}`}
                </p>
                <p className={`text-[11px] mt-0.5 ${nota.fornecedorExistente ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {nota.fornecedorExistente
                    ? 'Ele será selecionado automaticamente no formulário.'
                    : 'O cadastro dele abre em seguida, já preenchido com o que a nota trouxe.'}
                </p>
                {(nota.numero || nota.dataEmissao) && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    {nota.numero && <>Nota nº <strong>{nota.numero}</strong></>}
                    {nota.numero && nota.dataEmissao && ' · '}
                    {nota.dataEmissao && <>Emissão: {nota.dataEmissao.split('-').reverse().join('/')}</>}
                  </p>
                )}
              </div>

              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Produtos na nota ({marcados.size} de {nota.itens.length} marcados)
                </p>
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {nota.itens.map((it, i) => {
                    const marcado = marcados.has(i);
                    return (
                      <label key={i} onClick={() => alternar(i)}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 ${marcado ? 'bg-emerald-50/60' : ''}`}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          marcado ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'
                        }`}>
                          {marcado && <Check size={10} className="text-white" strokeWidth={3} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm truncate ${marcado ? 'text-emerald-800 font-medium' : 'text-gray-700'}`}>{it.nome}</p>
                          <p className="text-[11px] text-gray-400">
                            {it.tipo === 'vacina' ? 'Vacina' : 'Medicamento'}
                            {it.quantidade != null && <> · {it.quantidade}{it.unidade ? ` ${it.unidade}` : ''}</>}
                            {it.lote && <> · Lote {it.lote}</>}
                          </p>
                        </div>
                        {/* "—" quando a nota não trouxe o valor. Nunca R$ 0,00: o
                            preço ausente não é preço zero, e um zero aqui viraria
                            dívida de graça com o fornecedor. */}
                        <span className="text-[11px] font-semibold text-gray-600 flex-shrink-0">
                          {brl(it.valorUnitario ?? it.valorTotal)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onFechar}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">
            Cancelar
          </button>
          {nota && (
            <button onClick={usar} disabled={marcados.size === 0}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50">
              Usar {marcados.size === 1 ? 'este produto' : `estes ${marcados.size} produtos`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
