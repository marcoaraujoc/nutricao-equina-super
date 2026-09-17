// frontend/src/pages/Produtos.tsx
//
// CADASTRO > PRODUTOS
//
// 🔴 A TELA DO CATÁLOGO DA CLÍNICA (2026-09-15). Ela cadastra o ITEM que a clínica
// usa — medicamento e vacina — com forma farmacêutica, apresentação, unidade, via de
// administração, controlado e quantidade de doses da embalagem.
//
// ⚠️ REVERTE o escopo de 2026-09-10: fornecedor, nota fiscal, valor de compra, valor
// de venda, "Ler documento de compra" e "Dar entrada no estoque" SAÍRAM a pedido.
// Compra e saldo são assunto da Farmácia / do Estoque de Vacinas; tê-los aqui
// misturava "o que é o produto" com "quanto eu tenho dele". O backend daquilo
// (`tb_produtos_fornecedor`, a conta a pagar na execução) continua existindo — o que
// sumiu foi a porta de entrada NESTA tela.
//
// 🔴 A BUSCA TRAZ O QUE JÁ ESTÁ CADASTRADO — medicamentos e vacinas do catálogo
// visível da clínica (o global do sistema + o próprio dela). Achado o item, clicar em
// Alterar CARREGA os dados dele para edição; não achado, "Novo produto" abre o
// formulário JÁ com o nome digitado na busca.
//
// 🔴 ALTERAR UM ITEM GLOBAL NÃO ALTERA O GLOBAL: o backend cria a cópia desta clínica
// e é ela que recebe a mudança (copy-on-write, `lib/catalogoEmpresa.js`). O catálogo
// das demais clínicas nunca é tocado, e o RLS de `tb_medicamentos` é a rede por baixo
// disso.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Package, Pill, Syringe, Search, Loader2, Trash2, Layers, Pencil, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import ModalJustificativa from '../components/ModalJustificativa';
import JanelaLista from '../components/JanelaLista';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import FormProduto from '../components/produtos/FormProduto';
import { numeroDoCampo } from '../utils/formaCalculo';
import type { OpcoesCatalogo } from '../components/catalogo/SeletoresCatalogo';
import {
  FORM_PRODUTO_VAZIO, formDoItem, normalizarNomeProduto, formSoTemNome,
  type FormProdutoDados, type ItemCatalogo,
} from '../components/produtos/tiposProduto';

type TipoProduto = 'medicamento' | 'vacina';

const OPCOES_VAZIAS: OpcoesCatalogo = { formas: [], unidades: [], apresentacoes: [], vias: [] };

export default function Produtos() {
  const { podeExecutar, loading: loadingPerms } = usePermissoes();
  const { loading: empresaLoading } = useEmpresa();

  const podeVer     = podeExecutar('cadastro.produto.ler');
  const podeCriar   = podeExecutar('cadastro.produto.criar');
  const podeEditar  = podeExecutar('cadastro.produto.editar');
  const podeExcluir = podeExecutar('cadastro.produto.deletar');

  const [tipo,   setTipo]   = useState<TipoProduto>('medicamento');
  const [form,   setForm]   = useState<FormProdutoDados>(FORM_PRODUTO_VAZIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [itens,   setItens]   = useState<ItemCatalogo[]>([]);
  const [opcoes,  setOpcoes]  = useState<OpcoesCatalogo>(OPCOES_VAZIAS);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busca,   setBusca]   = useState('');

  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroForm,   setErroForm]   = useState<ErroAcaoDados | null>(null);
  // Nasce FALSO: até a carga responder, é melhor não oferecer um campo cuja gravação
  // talvez não exista. Mostrar e depois esconder seria pior.
  const [multidoseDisponivel, setMultidoseDisponivel] = useState(false);

  const [excluindo, setExcluindo] = useState<ItemCatalogo | null>(null);

  // ── O nome digitado traz o cadastro que já existe ──────────────────────────
  // 🔴 A pessoa digitava o nome de um produto que o sistema JÁ TEM e redigitava forma,
  // apresentação, unidade e vias do zero — nascia um item da clínica divergente do
  // global de mesmo nome, e nada acusava. Agora, ao SAIR do campo Nome, o backend
  // responde "este produto já existe?" e a tela carrega o cadastro dele.
  const [consultandoNome, setConsultandoNome] = useState(false);
  const [itemEncontrado,  setItemEncontrado]  = useState<ItemCatalogo | null>(null);
  const [encontradoCarregado, setEncontradoCarregado] = useState(false);
  // Evita reconsultar quando a pessoa só PASSA pelo campo sem mudar nada — `blur`
  // dispara igual. Guarda o nome normalizado da última consulta.
  const nomeConsultadoRef = useRef<string>('');

  // ── Carga ─────────────────────────────────────────────────────────────────
  const carregarItens = useCallback(async () => {
    try {
      const res = await api.get('/cadastro/produtos', {
        params: { tipo, busca: busca.trim() || undefined },
      });
      if (!res.data) return;                       // GET 403 resolve com data null
      setItens(res.data.dados ?? []);
      // A bandeira do multidose vem já na carga — o campo não pode aparecer antes de
      // se saber se a base o grava (senão a marcação some no salvar, calada).
      setMultidoseDisponivel(res.data.recursos?.multidose !== false);
    } catch { /* silencioso */ }
  }, [tipo, busca]);

  /**
   * As opções de Forma / Unidade / Apresentação / Via saem do BANCO, recortadas por
   * TIPO: a vacina tem forma, unidade e via PRÓPRIAS ('dose', 'Subcutânea (SC)'), e
   * oferecer 'Comprimido' num cadastro de vacina seria oferecer o que não existe ali.
   */
  useEffect(() => {
    if (loadingPerms || empresaLoading || !podeVer) return;
    let vivo = true;
    setCarregandoOpcoes(true);
    api.get('/medicamentos/opcoes-catalogo', { params: { tipo } })
      .then(res => { if (vivo && res.data?.dados) setOpcoes(res.data.dados); })
      .catch(() => { /* silencioso: o seletor simplesmente não oferece opções */ })
      .finally(() => { if (vivo) setCarregandoOpcoes(false); });
    return () => { vivo = false; };
  }, [tipo, loadingPerms, empresaLoading, podeVer]);

  useEffect(() => {
    // ⚠️ Espera o contexto de empresa resolver: chamada escopada por empresa antes
    // disso cai no fallback do backend e traz o dado de OUTRA clínica (§12, 29/07).
    if (loadingPerms || empresaLoading || !podeVer) return;
    setLoading(true);
    const t = setTimeout(() => { carregarItens().finally(() => setLoading(false)); }, 300);
    return () => clearTimeout(t);
  }, [loadingPerms, empresaLoading, podeVer, carregarItens]);

  const patch = (p: Partial<FormProdutoDados>) => setForm(prev => ({ ...prev, ...p }));

  /** Traz para o formulário o item que o nome digitado reconheceu. */
  const adotarEncontrado = useCallback((item: ItemCatalogo) => {
    // ⚠️ `setForm` FUNCIONAL: a resposta chega depois, e um patch calculado sobre o
    // `form` da closure apagaria o que foi digitado durante a espera.
    setForm(prev => ({ ...formDoItem(item), nome: prev.nome }));
    setEncontradoCarregado(true);
  }, []);

  /**
   * ⚠️ SÓ no cadastro NOVO (`medicamentoId == null`): em edição, trocar o registro
   * debaixo de quem está editando seria pior que o erro que isto evita.
   * ⚠️ NUNCA lança — reconhecer o nome é conveniência, e derrubar o formulário porque
   * a consulta falhou trocaria um atalho por um impedimento.
   */
  const consultarNome = useCallback(async () => {
    const atual = normalizarNomeProduto(form.nome);
    if (form.medicamentoId != null) return;
    if (atual.length < 2) { setItemEncontrado(null); nomeConsultadoRef.current = ''; return; }
    if (atual === nomeConsultadoRef.current) return;
    nomeConsultadoRef.current = atual;
    setConsultandoNome(true);
    try {
      const res = await api.get('/cadastro/produtos/por-nome', { params: { tipo, nome: form.nome.trim() } });
      const item: ItemCatalogo | null = res.data?.encontrado ? res.data.dados : null;
      setItemEncontrado(item);
      setEncontradoCarregado(false);
      // ⚠️ Carrega sozinho SÓ com o formulário vazio fora o nome: com campos já
      // digitados, sobrescrever seria perder trabalho em silêncio — aí a faixa
      // oferece o botão e quem decide é a pessoa.
      if (item && formSoTemNome(form)) adotarEncontrado(item);
    } catch { setItemEncontrado(null); }
    finally { setConsultandoNome(false); }
  }, [form, tipo, adotarEncontrado]);

  /** Limpa o reconhecimento quando o formulário sai de cena ou o nome muda. */
  const limparEncontrado = () => {
    setItemEncontrado(null);
    setEncontradoCarregado(false);
    nomeConsultadoRef.current = '';
  };

  // ── Salvar ────────────────────────────────────────────────────────────────
  const salvar = async () => {
    setErroForm(null);
    // Alterar exige o slug de EDITAR; criar, o de CRIAR. São permissões distintas na
    // matriz, e o botão que só falha depois do clique é a armadilha 28-d.
    const editando = form.medicamentoId != null;
    if (editando ? !podeEditar : !podeCriar) {
      setErroForm({ mensagem: `Sem permissão para ${editando ? 'alterar' : 'cadastrar'} produtos.` });
      return;
    }
    const faltando = [
      ...(form.nome.trim()              ? [] : ['Nome']),
      ...(form.formaFarmaceutica        ? [] : ['Forma farmacêutica']),
      ...(form.apresentacao             ? [] : ['Apresentação']),
      ...(form.unidade                  ? [] : ['Unidade']),
      ...(form.vias.length > 0          ? [] : ['Via de administração']),
      // 🔴 Multidose marcado SEM o par forma+qtd é pior que não marcar: o item nasceria
      // dizendo "sou medido por dentro" e sem dizer em quê — e é esse par que divide o
      // preço da embalagem na linha da fatura.
      ...(!form.multidose || form.formaCalculo             ? [] : ['Forma de Cálculo']),
      ...(!form.multidose || numeroDoCampo(form.dosesPorEmbalagem) != null ? [] : ['Qtd']),
    ];
    if (faltando.length > 0) {
      setErroForm({ mensagem: `Preencha: ${faltando.join(', ')}.`, campos: faltando });
      return;
    }

    setSalvando(true);
    try {
      const res = await api.post('/cadastro/produtos', {
        tipo,
        medicamentoId:     form.medicamentoId,
        nome:              form.nome.trim(),
        formaFarmaceutica: form.formaFarmaceutica,
        apresentacao:      form.apresentacao,
        unidade:           form.unidade,
        vias:              form.vias,
        controlado:        form.controlado,
        fabricante:        form.fabricante.trim() || undefined,
        multidose:         form.multidose,
        // Vazio NÃO é zero: `null` diz "não declara conteúdo" e o item segue cobrado
        // pela embalagem inteira, que é o comportamento de quem não é multidose.
        dosesPorEmbalagem: form.multidose ? numeroDoCampo(form.dosesPorEmbalagem) : null,
        formaCalculo:      form.multidose ? (form.formaCalculo || null) : null,
      });
      toast.success(
        res.data?.dados?.copiado
          ? 'Produto salvo como cópia desta clínica'
          : editando ? 'Produto atualizado' : 'Produto cadastrado',
      );
      setForm(FORM_PRODUTO_VAZIO);
      limparEncontrado();
      setMostrarForm(false);
      await carregarItens();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string; campos?: string[] } } };
      if (!e.isPermissionError) {
        setErroForm({
          mensagem: e.response?.data?.error ?? 'Erro ao salvar o produto.',
          campos:   e.response?.data?.campos,
        });
      }
    } finally { setSalvando(false); }
  };

  /** Abre um item da lista NO FORMULÁRIO, preenchido e editável. */
  const editarItem = (item: ItemCatalogo) => {
    setTipo(item.ehVacina ? 'vacina' : 'medicamento');
    setErroForm(null);
    limparEncontrado();
    setForm(formDoItem(item));
    setMostrarForm(true);
  };

  /** "Novo produto" abre o formulário JÁ com o nome que a pessoa digitou na busca. */
  const novoProduto = () => {
    setErroForm(null);
    limparEncontrado();
    setForm({ ...FORM_PRODUTO_VAZIO, nome: busca.trim() });
    setMostrarForm(true);
  };

  const confirmarExclusao = async (motivo: string) => {
    if (!excluindo) return;
    try {
      await api.delete(`/cadastro/produtos/${excluindo.id}`, { data: { motivo } });
      toast.success('Produto inativado');
      setExcluindo(null);
      await carregarItens();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao remover o produto.');
    }
  };

  const nenhumResultado = useMemo(() => !loading && itens.length === 0, [loading, itens]);

  if (!loadingPerms && !podeVer) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-800">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar os produtos.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <BotaoVoltar />
      {erroInline && <InlineError message={erroInline} />}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package size={22} className="text-emerald-600" /> Produtos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Medicamentos e vacinas da clínica — forma, apresentação, unidade, via e doses da embalagem.
          </p>
        </div>
        {podeCriar && !mostrarForm && (
          /* ⚠️ SEM o "+" (a pedido, 2026-09-15) — nem no rótulo nem como ícone. O botão
             diz o que faz; o sinal era ruído. */
          <button onClick={novoProduto}
            className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            Novo produto
          </button>
        )}
      </div>

      {/* ── Abas Medicamento × Vacina, como no cadastro de procedimentos ───── */}
      <div className="flex items-center gap-2 mb-4">
        {(['medicamento', 'vacina'] as TipoProduto[]).map(t => {
          const ativo = tipo === t;
          const Icone = t === 'vacina' ? Syringe : Pill;
          return (
            <button key={t} onClick={() => { setTipo(t); setMostrarForm(false); setForm(FORM_PRODUTO_VAZIO); limparEncontrado(); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                ativo ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <Icone size={15} /> {t === 'vacina' ? 'Vacinas' : 'Medicamentos'}
            </button>
          );
        })}
      </div>

      {mostrarForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
          <FormProduto
            tipo={tipo}
            form={form}
            onForm={patch}
            opcoes={opcoes}
            carregandoOpcoes={carregandoOpcoes}
            salvando={salvando}
            camposComErro={erroForm?.campos}
            multidoseDisponivel={multidoseDisponivel}
            onNomeSaiu={consultarNome}
            consultandoNome={consultandoNome}
            /* ⚠️ A faixa é DERIVADA do nome que está no campo AGORA: sem isso ela
               continuaria falando do item anterior enquanto a pessoa digita outro
               nome — e o aviso passaria a mentir sem nada acusar. */
            avisoCatalogo={itemEncontrado
              && normalizarNomeProduto(form.nome) === normalizarNomeProduto(itemEncontrado.nome) ? {
              nome:      itemEncontrado.nome,
              daEmpresa: itemEncontrado.daEmpresa,
              ativo:     itemEncontrado.ativo,
              carregado: encontradoCarregado,
            } : null}
            onCarregarEncontrado={() => itemEncontrado && adotarEncontrado(itemEncontrado)}
            onSalvar={salvar}
            onCancelar={() => { setMostrarForm(false); setForm(FORM_PRODUTO_VAZIO); setErroForm(null); limparEncontrado(); }}
          />
          {/* Erro da AÇÃO fica abaixo do botão que a disparou (§6) — no topo da
              página, quem clica em Salvar no fim do formulário não o veria. */}
          <ErroAcao erro={erroForm} />
        </div>
      )}

      {/* ── Busca ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder={`Buscar ${tipo === 'vacina' ? 'vacina' : 'medicamento'} cadastrado...`}
            className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-emerald-400" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
      ) : nenhumResultado ? (
        <div className="text-center py-14">
          <p className="text-gray-400 text-sm">
            {busca.trim()
              ? `Nenhum${tipo === 'vacina' ? 'a vacina' : ' medicamento'} encontrado para "${busca}".`
              : `Nenhum${tipo === 'vacina' ? 'a vacina' : ' medicamento'} cadastrado.`}
          </p>
          {/* Não achou? O caminho é cadastrar — e o nome digitado vai junto, para a
              pessoa não redigitar o que acabou de procurar. */}
          {podeCriar && busca.trim() && !mostrarForm && (
            <button onClick={novoProduto}
              className="mt-3 inline-flex bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold">
              Cadastrar “{busca.trim()}”
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* 5 itens visíveis (a pedido) — acima disso a lista rola dentro da
                janela, em vez de esticar a página. */}
            <JanelaLista maxItens={5}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-5 py-3 font-semibold">Produto</th>
                    <th className="px-5 py-3 font-semibold">Forma</th>
                    <th className="px-5 py-3 font-semibold">Apresentação</th>
                    <th className="px-5 py-3 font-semibold">Unidade</th>
                    <th className="px-5 py-3 font-semibold">Vias</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {itens.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {p.nome}
                        {/* O selo diz que aquele item é cobrado POR DOSE — sem ele,
                            duas linhas iguais teriam cobranças diferentes e nada na
                            tela explicaria por quê. */}
                        {p.multidose && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full align-middle">
                            <Layers size={10} />
                            {p.dosesPorEmbalagem
                              ? `${String(p.dosesPorEmbalagem).replace('.', ',')} ${p.formaCalculo ?? ''}/emb.`.replace('  ', ' ')
                              : 'multidose'}
                          </span>
                        )}
                        {p.controlado && (
                          <span className="ml-2 inline-flex items-center text-[10px] text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full align-middle">
                            controlado
                          </span>
                        )}
                        {/* Item do catálogo do sistema: alterá-lo cria a cópia desta
                            clínica. O selo evita a leitura de que a edição vale para
                            todo mundo. */}
                        {!p.daEmpresa && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full align-middle">
                            <Globe size={10} /> do sistema
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600">{p.formaFarmaceutica || '—'}</td>
                      <td className="px-5 py-3 text-gray-600">{p.apresentacao || '—'}</td>
                      <td className="px-5 py-3 text-gray-600">{p.unidade || '—'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {p.vias.length > 0 ? p.vias.map(v => v.via).join(', ') : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <AcoesRegistro>
                          {/* Ordem e cor da §6: Alterar (laranja) primeiro, Cancelar
                              (vermelho) por último. Excluir só no item DA CLÍNICA —
                              o do sistema é de todas, e o botão que só falha depois
                              do clique é a armadilha 28-d. */}
                          <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar"
                            visivel={podeEditar} onClick={() => editarItem(p)} />
                          <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Excluir"
                            visivel={podeExcluir && p.daEmpresa} onClick={() => setExcluindo(p)} />
                        </AcoesRegistro>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </JanelaLista>
          </div>

          <div className="md:hidden space-y-2">
            <JanelaLista maxItens={5}>
              {itens.map(p => (
                <div key={p.id} data-item-lista className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="font-semibold text-gray-900 text-sm">{p.nome}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {[p.formaFarmaceutica, p.apresentacao, p.unidade].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {p.multidose && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                        <Layers size={10} />
                        {p.dosesPorEmbalagem
                          ? `${String(p.dosesPorEmbalagem).replace('.', ',')} ${p.formaCalculo ?? ''}/emb.`.replace('  ', ' ')
                          : 'multidose'}
                      </span>
                    )}
                    {p.controlado && (
                      <span className="inline-flex items-center text-[10px] text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                        controlado
                      </span>
                    )}
                    {!p.daEmpresa && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
                        <Globe size={10} /> do sistema
                      </span>
                    )}
                  </div>
                  {p.vias.length > 0 && (
                    <p className="text-[11px] text-gray-400 mt-1">Vias: {p.vias.map(v => v.via).join(', ')}</p>
                  )}
                  {(podeEditar || (podeExcluir && p.daEmpresa)) && (
                    /* ⚠️ Ações do CARD vão no RODAPÉ (§6): com rótulo, ao lado do
                       nome elas espremeriam o produto. */
                    <div className="mt-3 pt-3 border-t border-gray-50">
                      <AcoesRegistro>
                        <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar"
                          visivel={podeEditar} onClick={() => editarItem(p)} />
                        <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Excluir"
                          visivel={podeExcluir && p.daEmpresa} onClick={() => setExcluindo(p)} />
                      </AcoesRegistro>
                    </div>
                  )}
                </div>
              ))}
            </JanelaLista>
          </div>
        </>
      )}

      <ModalJustificativa
        aberto={!!excluindo}
        titulo="Inativar produto"
        descricao={excluindo ? `Inativar "${excluindo.nome}" no catálogo desta clínica?` : ''}
        acaoLabel="Inativar"
        onConfirmar={confirmarExclusao}
        onFechar={() => setExcluindo(null)}
      />
    </PageContainer>
  );
}
