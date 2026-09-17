// frontend/src/components/CadastroCatalogoModal.tsx
//
// CADASTRO RÁPIDO de MEDICAMENTO / VACINA no catálogo da empresa — fonte ÚNICA das
// quatro telas que oferecem "Cadastrar «X»": Prescrição, Vacina (atendimento),
// Entrada de Estoque da Farmácia e Estoque de Vacinas. Cópias divergiriam na primeira
// correção, e o que divergiria é o que nasce no catálogo — item sem via numa tela e
// com via em outra.
//
// 🔴 As opções de Forma / Unidade / Apresentação / Vias vêm do BANCO
// (`GET /medicamentos/opcoes-catalogo`), nunca de lista fixa no código: uma constante
// aqui divergiria do catálogo no primeiro item novo, e o cadastro passaria a criar
// variações do que já existe ("Frasco" × "Frasco ampola") sem ninguém notar. O
// backend entrega UMA opção por valor, ignorando caixa — 'kg' e 'Kg' convivem na base
// e apareciam como duas unidades diferentes.
//
// ⚠️ MULTI-TENANT: as opções saem do catálogo VISÍVEL da empresa (global + o próprio
// dela) e o item nasce PRIVADO dela (`lib/catalogoManual.js` grava o `empresaId`) — o
// catálogo GLOBAL, do ADMIN, nunca é tocado por aqui. O RLS de `tb_medicamentos`
// (ENABLE + FORCE) é o que garante isso no banco: leitura global+própria, escrita só
// própria.
// ⚠️ Nome que JÁ EXISTE no catálogo visível devolve a linha existente e NÃO reescreve
// os campos dela (pode ser global, e o RLS recusaria). Por isso as telas só oferecem
// o cadastro quando não há correspondência EXATA de nome.
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import api from '../services/api';
import ErroAcao from './ErroAcao';
// 🔴 Os seletores moram em `catalogo/SeletoresCatalogo` desde 2026-09-15: a tela de
// Produtos cadastra os MESMOS campos, e duas cópias divergiriam (28-g).
import { SeletorBusca, SeletorVias, type OpcoesCatalogo } from './catalogo/SeletoresCatalogo';
import { FORMAS_CALCULO, qtdDoNome, fmtQtdForma, numeroDoCampo } from '../utils/formaCalculo';

export interface ItemCatalogoCriado {
  id: number;
  nome: string;
  formaFarmaceutica: string;
  unidade: string;
  apresentacao: string;
  fabricante: string | null;
  controlado: boolean;
  ativo: boolean;
  vias: { id: number; via: string }[];
  emEstoque: boolean;
  qtdEstoque: number | null;
  precoUnitarioBase: number | null;
  valorPorDose: number | null;
  ehProduto: boolean;
  fornecedores: unknown[];
}

interface Props {
  aberto: boolean;
  tipo: 'medicamento' | 'vacina';
  /** Texto digitado na busca da tela — abre o formulário já com o nome. */
  nomeInicial?: string;
  /**
   * Paciente da tela, quando existe. É ele que dá a ESPÉCIE do item novo — e é a
   * espécie que o faz aparecer nas buscas depois. Sem paciente (telas de estoque),
   * o backend usa as espécies dos animais ativos da empresa.
   */
  animalId?: number | null;
  onCriado: (item: ItemCatalogoCriado) => void;
  onFechar: () => void;
}

export default function CadastroCatalogoModal({
  aberto, tipo, nomeInicial = '', animalId = null, onCriado, onFechar,
}: Props) {
  const ehVacina = tipo === 'vacina';
  const rotulo   = ehVacina ? 'Vacina' : 'Medicamento';

  const [nome, setNome]             = useState('');
  const [forma, setForma]           = useState('');
  const [unidade, setUnidade]       = useState('');
  const [apresentacao, setApres]    = useState('');
  const [fabricante, setFabricante] = useState('');
  const [vias, setVias]             = useState<string[]>([]);
  const [controlado, setControlado] = useState(false);
  // 🔴 MULTIDOSE — o MESMO par da tela de Produtos (2026-09-16): a Forma de Cálculo
  // (em QUE o conteúdo é medido) e a Qtd (QUANTO cabe na embalagem). Sem os dois o
  // backend NÃO marca o item, e ele volta a ser cobrado pela embalagem inteira: um
  // número sem unidade não divide preço nenhum.
  const [multidose, setMultidose] = useState(false);
  const [formaCalc, setFormaCalc] = useState('');
  const [doses, setDoses]         = useState('');

  const [opcoes, setOpcoes]         = useState<OpcoesCatalogo>({ formas: [], unidades: [], apresentacoes: [], vias: [] });
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando]     = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; campos?: string[] } | null>(null);

  // Reabrir com o preenchimento anterior é o caminho mais curto para cadastrar o item
  // errado — o formulário nasce zerado, só com o nome que a pessoa digitou na busca.
  useEffect(() => {
    if (!aberto) return;
    setNome(nomeInicial);
    setForma(''); setUnidade(''); setApres(''); setFabricante('');
    setVias([]); setControlado(false); setDoses('');
    setErro(null);
  }, [aberto, nomeInicial]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    api.get('/medicamentos/opcoes-catalogo', { params: { tipo } })
      .then(res => { if (vivo && res.data?.dados) setOpcoes(res.data.dados); })
      .catch(() => { if (vivo) setErro({ mensagem: 'Erro ao carregar as opções do catálogo.' }); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [aberto, tipo]);

  if (!aberto) return null;

  const faltando = [
    ...(nome.trim()      ? [] : ['nome']),
    ...(forma            ? [] : ['forma']),
    ...(unidade          ? [] : ['unidade']),
    ...(apresentacao     ? [] : ['apresentacao']),
    ...(vias.length > 0  ? [] : ['vias']),
  ];
  const temErro = (campo: string) => !!erro?.campos?.includes(campo);

  const salvar = async () => {
    if (faltando.length > 0) {
      const nomes: Record<string, string> = {
        nome: `Nome ${ehVacina ? 'da vacina' : 'do medicamento'}`, forma: 'Forma',
        unidade: 'Unidade', apresentacao: 'Apresentação', vias: 'Vias',
      };
      setErro({ mensagem: `Preencha: ${faltando.map(c => nomes[c]).join(', ')}.`, campos: faltando });
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await api.post('/medicamentos/garantir', {
        nome: nome.trim(), tipo, animalId: animalId ?? undefined,
        formaFarmaceutica: forma, unidade, apresentacao, vias,
        controlado: ehVacina ? false : controlado,
        multidose,
        dosesPorEmbalagem: multidose ? numeroDoCampo(doses) : null,
        formaCalculo:      multidose ? (formaCalc || null) : null,
        ...(ehVacina ? { fabricante: fabricante.trim() } : {}),
      });
      const criado: ItemCatalogoCriado | undefined = res.data?.dados;
      if (!criado) throw new Error('sem dados');
      onCriado(criado);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setErro({ mensagem: e.response?.data?.error ?? `Erro ao cadastrar ${rotulo.toLowerCase()}.` });
    } finally {
      setSalvando(false);
    }
  };

  const inputCls = (campo: string) =>
    `w-full border ${temErro(campo) ? 'border-red-400' : 'border-gray-300'} rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500`;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
        <div className="bg-emerald-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <p className="font-bold text-sm text-white">Cadastrar {rotulo}</p>
          <button onClick={onFechar} className="text-white/60 hover:text-white"><X size={18} /></button>
        </div>

        {/* Um campo por linha, em largura cheia: os valores do catálogo são longos
            ("Pó Liofilizado para Suspensão Injetável", "Frasco gotejador") e, lado a
            lado, quebravam a caixa em duas linhas. */}
        <div className="p-5 space-y-3 overflow-y-auto">
          {carregando && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Carregando as opções do catálogo...
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Nome {ehVacina ? 'da Vacina' : 'do Medicamento'} <span className="text-red-500">*</span>
            </label>
            <input value={nome} onChange={e => setNome(e.target.value)} maxLength={90}
              placeholder={ehVacina ? 'Ex.: Vacina contra Influenza Equina' : 'Ex.: Dipirona 500 mg/mL'}
              className={inputCls('nome')} />
          </div>

          {/* Fabricante existe só na VACINA: é o campo que o Estoque de Vacinas usa
              para filtrar o catálogo, e o cadastro de vacinas (`/cadastro-vacina`) o
              trata como OPCIONAL — exigi-lo aqui impediria cadastrar a vacina cujo
              laboratório ainda não se conhece. */}
          {ehVacina && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Fabricante</label>
              <input value={fabricante} onChange={e => setFabricante(e.target.value)} maxLength={150}
                placeholder="Opcional — laboratório" className={inputCls('fabricante')} />
            </div>
          )}

          <SeletorBusca label="Forma" valor={forma} opcoes={opcoes.formas} erro={temErro('forma')}
            placeholder="Selecione a forma..." onChange={setForma} />

          <SeletorBusca label="Unidade" valor={unidade} opcoes={opcoes.unidades} erro={temErro('unidade')}
            placeholder="Selecione a unidade..." onChange={setUnidade} />

          <SeletorBusca label="Apresentação" valor={apresentacao} opcoes={opcoes.apresentacoes} erro={temErro('apresentacao')}
            placeholder="Selecione a apresentação..." onChange={setApres} />

          <SeletorVias valores={vias} opcoes={opcoes.vias} erro={temErro('vias')} onChange={setVias} />

          {/* Espelho do bloco de `/cadastro/produtos` — o item precisa nascer IGUAL,
              seja cadastrado lá ou por aqui. Sem a forma, o backend não marca. */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={multidose}
                onChange={e => {
                  const marcado = e.target.checked;
                  // Desmarcar LIMPA o par: deixá-lo faria o item voltar a ser multidose
                  // na gravação seguinte sem ninguém ter pedido.
                  setMultidose(marcado);
                  if (!marcado) { setFormaCalc(''); setDoses(''); }
                }}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
              <span className="min-w-0">
                <span className="text-sm font-semibold text-gray-700">Produto multidose</span>
                <span className="block text-[11px] text-gray-500 leading-snug">
                  A embalagem rende mais de uma aplicação e é medida por dentro.
                </span>
              </span>
            </label>

            {multidose && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Forma de Cálculo *</label>
                  <select value={formaCalc}
                    onChange={e => {
                      // Mesma regra da tela de Produtos: trocar a forma repreenche a
                      // Qtd a partir do NOME, e `qtdDoNome` já devolve null no que não
                      // deve preencher (doses, ou nome sem a medida escolhida).
                      const achada = qtdDoNome(nome, e.target.value);
                      setFormaCalc(e.target.value);
                      setDoses(achada != null ? fmtQtdForma(achada) : '');
                    }}
                    className={inputCls('formaCalculo')}>
                    <option value="">Selecione…</option>
                    {FORMAS_CALCULO.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Qtd {formaCalc && <span className="text-gray-400 font-normal">({formaCalc} por Unidade)</span>}
                  </label>
                  <input type="text" inputMode="decimal" value={doses}
                    onChange={e => setDoses(e.target.value.replace(/[^\d.,]/g, '').replace('.', ','))}
                    placeholder="Ex.: 20" className={inputCls('doses')} />
                </div>
              </div>
            )}
          </div>

          {/* Controlado é do MEDICAMENTO: o catálogo de vacinas (`/cadastro-vacina`)
              nunca expôs esse campo, e oferecê-lo aqui criaria um estado que nenhuma
              outra tela de vacina mostra nem permite corrigir. */}
          {!ehVacina && (
            <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
              <input type="checkbox" checked={controlado} onChange={e => setControlado(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
              <span className="text-sm text-gray-700">Medicamento controlado</span>
            </label>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-gray-100 flex-shrink-0">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onFechar} disabled={salvando}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-60">
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1.5">
              {salvando && <Loader2 size={13} className="animate-spin" />}
              Cadastrar
            </button>
          </div>
          {/* Erro da AÇÃO fica ABAIXO do botão que a disparou, dentro do modal (§6). */}
          <ErroAcao erro={erro} className="mt-3" />
        </div>
      </div>
    </div>
  );
}
