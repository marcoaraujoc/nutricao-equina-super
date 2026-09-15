// frontend/src/pages/Produtos.tsx
//
// CADASTRO > PRODUTOS (2026-09-10)
//
// 🔴 A TELA DA CLÍNICA. Até aqui, cadastrar um item que ela usa exigia três lugares:
// `/medicamentos` (catálogo global, ADMIN da plataforma), `/cadastro-vacina` e depois
// `/farmacia` ou `/estoque-vacina` para a entrada física. Aqui é um lugar só —
// medicamento e vacina, com o fornecedor de cada um e a entrada de estoque OPCIONAL.
//
// ⚠️ NÃO substitui as telas anteriores (decisão de 2026-09-10): `/medicamentos`
// continua sendo o catálogo GLOBAL do ADMIN, com milhares de itens que valem para
// todas as clínicas. Aqui nasce o item PRÓPRIO da empresa, que só ela vê.
//
// 🔴 PRODUTO × ESTOQUE — a distinção que a tela existe para registrar:
//   • PRODUTO = tenho de quem comprar. A clínica NÃO guarda o item; pede quando o vet
//     prescreve. Na prescrição ele aparece VERDE, com o nome do fornecedor.
//   • ESTOQUE = tenho o frasco aqui. Quantidade, lote, validade.
// O checkbox do formulário é o que separa os dois.
//
// 🔴 O DOCUMENTO DE COMPRA preenche o formulário — nota fiscal, cupom, ORÇAMENTO DE
// BALCÃO ou recibo, inclusive sem valor fiscal (o que a tela precisa é fornecedor,
// item e preço, não validade tributária). Fornecedor que ainda não existe leva ao
// cadastro dele JÁ preenchido com o que a nota trouxe, e a volta traz o fornecedor
// novo selecionado — sem isso o gestor teria de reencontrar a nota e recomeçar.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Package, Pill, Syringe, Plus, Search, Loader2, FileText, Trash2, AlertTriangle, Layers, Pencil } from 'lucide-react';
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
import LeitorNotaFiscal, { type NotaLida, type ItemNota } from '../components/produtos/LeitorNotaFiscal';
import FormProduto from '../components/produtos/FormProduto';
import {
  FORM_PRODUTO_VAZIO, paraNumero, brlProduto,
  type FormProdutoDados, type ItemCatalogo, type FornecedorOpcao, type ProdutoCadastrado,
} from '../components/produtos/tiposProduto';

type TipoProduto = 'medicamento' | 'vacina';

export default function Produtos() {
  const navigate = useNavigate();
  const location = useLocation();
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

  const [produtos,     setProdutos]     = useState<ProdutoCadastrado[]>([]);
  const [catalogo,     setCatalogo]     = useState<ItemCatalogo[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorOpcao[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [buscandoCatalogo, setBuscandoCatalogo] = useState(false);
  const [busca, setBusca] = useState('');

  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroForm,   setErroForm]   = useState<ErroAcaoDados | null>(null);
  const [disponivel, setDisponivel] = useState(true);

  const [carregandoItem, setCarregandoItem] = useState(false);
  // Nasce FALSO: até a carga responder, é melhor não oferecer um campo cuja
  // gravação talvez não exista. Mostrar e depois esconder seria pior.
  const [multidoseDisponivel, setMultidoseDisponivel] = useState(false);
  /**
   * O formulário veio do DOCUMENTO DE COMPRA?
   *
   * ⚠️ Muda o que acontece ao carregar o item: vindo da nota, o cadastro antigo só
   * preenche o que está VAZIO — o preço da nota é mais recente que o do cadastro, e
   * sobrescrevê-lo desfaria em silêncio a leitura que a pessoa acabou de conferir.
   */
  const [origemNota, setOrigemNota] = useState(false);
  /** Última (item, fornecedor) buscada — sem isto o efeito rebuscaria a cada render. */
  const ultimoDetalhe = useRef('');

  const [leitorAberto, setLeitorAberto] = useState(false);
  const [excluindo,    setExcluindo]    = useState<ProdutoCadastrado | null>(null);
  /** Itens lidos da nota que ainda faltam cadastrar — a fila do "usar N produtos". */
  const [filaDaNota, setFilaDaNota] = useState<ItemNota[]>([]);

  // ── Carga ─────────────────────────────────────────────────────────────────
  const carregarProdutos = useCallback(async () => {
    try {
      const res = await api.get('/cadastro/produtos', { params: { busca: busca.trim() || undefined } });
      if (!res.data) return;                       // GET 403 resolve com data null
      setProdutos(res.data.dados ?? []);
      setDisponivel(res.data.recursos?.disponivel !== false);
      // A bandeira do multidose vem já na carga — o checkbox não pode aparecer antes
      // de se saber se a base o grava (senão a marcação some no salvar, calada).
      setMultidoseDisponivel(res.data.recursos?.multidose !== false);
    } catch { /* silencioso */ }
  }, [busca]);

  const carregarFornecedores = useCallback(async () => {
    try {
      const res = await api.get('/cadastro/fornecedores', { params: { ativo: 'true' } });
      if (!res.data) return;
      setFornecedores(res.data.dados ?? []);
    } catch { /* silencioso */ }
  }, []);

  // O catálogo é buscado pelo que está sendo digitado — ele tem milhares de linhas e
  // baixá-lo inteiro ao abrir a tela travaria o formulário.
  useEffect(() => {
    if (loadingPerms || empresaLoading || !podeVer) return;
    const termo = form.nome.trim();
    setBuscandoCatalogo(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/cadastro/produtos/catalogo', { params: { tipo, busca: termo || undefined } });
        if (res.data) setCatalogo(res.data.dados ?? []);
      } catch { /* silencioso */ }
      finally { setBuscandoCatalogo(false); }
    }, 350);
    return () => { clearTimeout(t); setBuscandoCatalogo(false); };
  }, [form.nome, tipo, loadingPerms, empresaLoading, podeVer]);

  /**
   * 🔴 ESCOLHER O ITEM CARREGA O QUE A CLÍNICA JÁ TEM DELE (2026-09-12).
   *
   * Antes, escolher um medicamento que a clínica já compra abria o formulário em
   * branco: a pessoa redigitava preço, unidade e fornecedor que estavam no banco e,
   * ao salvar, sobrescrevia um cadastro que nunca viu. Agora o item traz o catálogo
   * (unidade) e o VÍNCULO do fornecedor (preços, nota, multidose) — tudo editável.
   *
   * ⚠️ Refaz ao TROCAR DE FORNECEDOR: o preço é por (item, fornecedor), e manter o
   * do anterior faria o cadastro de um sair gravado no outro.
   */
  useEffect(() => {
    if (loadingPerms || empresaLoading || !podeVer) return;
    const medId = form.medicamentoId;
    if (!medId) { ultimoDetalhe.current = ''; return; }
    const chave = `${medId}|${form.fornecedorId ?? ''}`;
    if (ultimoDetalhe.current === chave) return;
    ultimoDetalhe.current = chave;

    let cancelado = false;
    (async () => {
      setCarregandoItem(true);
      try {
        const res = await api.get('/cadastro/produtos/detalhe', { params: { medicamentoId: medId } });
        if (cancelado || !res.data) return;
        const { catalogo: cat, produtos: vinculos, recursos } = res.data.dados ?? {};
        setMultidoseDisponivel(recursos?.multidose !== false);

        // O vínculo do fornecedor ESCOLHIDO; sem fornecedor escolhido, o primeiro —
        // é ele que a tela vai passar a editar.
        const lista: ProdutoCadastrado[] = vinculos ?? [];
        const achado = lista.find(v => v.fornecedorId === form.fornecedorId) ?? (form.fornecedorId ? null : lista[0]);

        setForm(prev => {
          // Vindo da nota, o que ela trouxe vence o cadastro (ver `origemNota`).
          const manter = (atual: string, doCadastro: string) =>
            origemNota ? (atual.trim() ? atual : doCadastro) : doCadastro;
          return {
            ...prev,
            nome:          cat?.nome ?? prev.nome,
            unidade:       manter(prev.unidade, achado?.unidade ?? cat?.unidade ?? ''),
            produtoId:     achado?.id ?? null,
            fornecedorId:  prev.fornecedorId ?? achado?.fornecedorId ?? null,
            valorUnitario: manter(prev.valorUnitario, achado?.valorUnitario != null ? String(achado.valorUnitario) : ''),
            valorVenda:    manter(prev.valorVenda,    achado?.valorVenda    != null ? String(achado.valorVenda)    : ''),
            notaFiscal:    manter(prev.notaFiscal,    achado?.notaFiscal ?? ''),
            multidose:     achado?.multidose ?? prev.multidose,
            dosesPorEmbalagem: achado?.dosesPorEmbalagem != null
              ? String(achado.dosesPorEmbalagem)
              : (achado ? '' : prev.dosesPorEmbalagem),
          };
        });
      } catch { /* item fora do catálogo desta clínica: segue como cadastro novo */ }
      finally { if (!cancelado) setCarregandoItem(false); }
    })();
    return () => { cancelado = true; };
  }, [form.medicamentoId, form.fornecedorId, origemNota, loadingPerms, empresaLoading, podeVer]);

  useEffect(() => {
    // ⚠️ Espera o contexto de empresa resolver: chamada escopada por empresa antes
    // disso cai no fallback do backend e traz o dado de OUTRA clínica (§12, 29/07).
    if (loadingPerms || empresaLoading) return;
    setLoading(true);
    Promise.all([carregarProdutos(), carregarFornecedores()]).finally(() => setLoading(false));
  }, [loadingPerms, empresaLoading, carregarProdutos, carregarFornecedores]);

  // ── Volta do cadastro de fornecedor, com o recém-criado já escolhido ──────
  useEffect(() => {
    const st = location.state as { fornecedorNovoId?: number | null } | null;
    if (!st?.fornecedorNovoId) return;
    setForm(prev => ({ ...prev, fornecedorId: st.fornecedorNovoId ?? null }));
    setMostrarForm(true);
    void carregarFornecedores();
    // Consome o state: sem isto ele reimporia o fornecedor a cada remontagem da rota.
    window.history.replaceState({}, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p: Partial<FormProdutoDados>) => setForm(prev => ({ ...prev, ...p }));

  // ── Nota fiscal ───────────────────────────────────────────────────────────
  /**
   * A nota foi lida e a pessoa escolheu os itens.
   *
   * Fornecedor JÁ cadastrado → preenche o formulário com o primeiro item e enfileira
   * o resto. Fornecedor NOVO → leva ao cadastro dele com os dados da nota, e a volta
   * (o efeito acima) retoma daqui.
   */
  const usarNota = (nota: NotaLida, itens: ItemNota[]) => {
    setLeitorAberto(false);
    if (itens.length === 0) return;

    const [primeiro, ...resto] = itens;
    setTipo(primeiro.tipo);
    setOrigemNota(true);
    ultimoDetalhe.current = '';
    setForm({
      ...FORM_PRODUTO_VAZIO,
      nome:          primeiro.nome,
      unidade:       primeiro.unidade ?? '',
      notaFiscal:    nota.numero ?? '',
      valorUnitario: primeiro.valorUnitario != null ? String(primeiro.valorUnitario) : '',
      fornecedorId:  nota.fornecedorExistente?.id ?? null,
      // A nota diz quanto veio: quem tem quantidade nela é item que a clínica
      // RECEBEU, então o estoque já nasce marcado. Desmarcar é um clique.
      entrarNoEstoque: primeiro.quantidade != null,
      quantidade:    primeiro.quantidade != null ? String(primeiro.quantidade) : '',
      lote:          primeiro.lote ?? '',
      validade:      primeiro.validade ?? '',
    });
    setFilaDaNota(resto);
    setMostrarForm(true);

    if (!nota.fornecedorExistente) {
      // Fornecedor novo: o cadastro abre PREENCHIDO com o que a nota trouxe, e volta
      // para cá. É o pedido de 2026-09-10, e é o que evita redigitar CNPJ e endereço.
      const f = nota.fornecedor;
      navigate('/cadastro/fornecedores', {
        state: {
          abrirNovo: true,
          depois: '/cadastro/produtos',
          dados: {
            nome: f.nome ?? '', tipoDoc: f.cnpj ? 'cnpj' : 'cpf',
            cnpj: f.cnpj ?? '', cpf: f.cpf ?? '',
            telefone: f.telefone ?? '', email: f.email ?? '',
            cep: f.cep ?? '', endereco: f.endereco ?? '',
            bairro: f.bairro ?? '', cidade: f.cidade ?? '', estado: f.estado ?? '',
          },
        },
      });
    }
  };

  // ── Salvar ────────────────────────────────────────────────────────────────
  const salvar = async () => {
    setErroForm(null);
    // Alterar um vínculo existente exige o slug de EDITAR; criar, o de CRIAR. São
    // permissões distintas na matriz, e o botão que só falha depois do clique é a
    // armadilha 28-d.
    const editando = form.produtoId != null;
    if (editando ? !podeEditar : !podeCriar) {
      setErroForm({ mensagem: `Sem permissão para ${editando ? 'alterar' : 'cadastrar'} produtos.` });
      return;
    }
    if (!form.nome.trim())    { setErroForm({ mensagem: 'Informe o produto.', campos: ['nome'] }); return; }
    if (!form.fornecedorId)   { setErroForm({ mensagem: 'Selecione o fornecedor.', campos: ['fornecedor'] }); return; }
    if (form.entrarNoEstoque && !paraNumero(form.quantidade)) {
      setErroForm({ mensagem: 'Informe a quantidade recebida ou desmarque a entrada no estoque.', campos: ['quantidade'] });
      return;
    }
    // Multidose sem o número não muda cobrança nenhuma — barrar aqui evita o cadastro
    // pela metade, que silenciosamente continuaria cobrando o frasco inteiro.
    if (form.multidose && !paraNumero(form.dosesPorEmbalagem)) {
      setErroForm({ mensagem: 'Informe quantas doses saem de uma embalagem.', campos: ['dosesPorEmbalagem'] });
      return;
    }

    setSalvando(true);
    try {
      // 🔴 O POST cobre os DOIS casos: `salvarProduto` é idempotente pelo unique
      // (empresa, item, fornecedor), então re-salvar o item já cadastrado ATUALIZA o
      // vínculo — e continua sendo o único caminho que também dá entrada no estoque.
      // Um PUT separado deixaria a alteração sem esse passo.
      await api.post('/cadastro/produtos', {
        tipo,
        medicamentoId: form.medicamentoId,
        nome:          form.nome.trim(),
        unidade:       form.unidade.trim() || undefined,
        fornecedorId:  form.fornecedorId,
        valorUnitario: paraNumero(form.valorUnitario),
        valorVenda:    paraNumero(form.valorVenda),
        notaFiscal:    form.notaFiscal.trim() || undefined,
        multidose:         form.multidose,
        dosesPorEmbalagem: form.multidose ? paraNumero(form.dosesPorEmbalagem) : null,
        entrarNoEstoque: form.entrarNoEstoque,
        estoque: form.entrarNoEstoque ? {
          quantidade:     paraNumero(form.quantidade),
          lote:           form.lote.trim() || undefined,
          validade:       form.validade || undefined,
          valor:          paraNumero(form.valorUnitario),
          estoqueMinimo:  paraNumero(form.estoqueMinimo),
        } : {},
      });
      toast.success(editando ? 'Produto atualizado' : 'Produto cadastrado');

      // Fila da nota: emenda no próximo item, com o MESMO fornecedor e nota — é o que
      // torna "usar 8 produtos" oito cliques em vez de oito preenchimentos.
      if (filaDaNota.length > 0) {
        const [prox, ...resto] = filaDaNota;
        setTipo(prox.tipo);
        setForm(f => ({
          ...FORM_PRODUTO_VAZIO,
          fornecedorId: f.fornecedorId, notaFiscal: f.notaFiscal,
          nome:      prox.nome,
          unidade:   prox.unidade ?? '',
          valorUnitario: prox.valorUnitario != null ? String(prox.valorUnitario) : '',
          entrarNoEstoque: prox.quantidade != null,
          quantidade: prox.quantidade != null ? String(prox.quantidade) : '',
          lote:      prox.lote ?? '',
          validade:  prox.validade ?? '',
        }));
        setFilaDaNota(resto);
        ultimoDetalhe.current = '';
        toast(`Faltam ${resto.length + 1} produto(s) da nota.`, { icon: '📄' });
      } else {
        setForm(FORM_PRODUTO_VAZIO);
        setMostrarForm(false);
        setOrigemNota(false);
        ultimoDetalhe.current = '';
      }
      await carregarProdutos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroForm({ mensagem: e.response?.data?.error ?? 'Erro ao salvar o produto.' });
    } finally { setSalvando(false); }
  };

  /**
   * Abre um produto da lista NO FORMULÁRIO, preenchido e editável.
   *
   * ⚠️ Carimba `ultimoDetalhe` com a chave (item, fornecedor) ANTES de preencher: o
   * efeito de carga veria os dois campos mudarem e buscaria o mesmo vínculo de novo,
   * sobrescrevendo o que acabou de ser posto na tela.
   */
  const editarProduto = (p: ProdutoCadastrado) => {
    setTipo(p.ehVacina ? 'vacina' : 'medicamento');
    setOrigemNota(false);
    setErroForm(null);
    setFilaDaNota([]);
    ultimoDetalhe.current = `${p.medicamentoId}|${p.fornecedorId}`;
    setForm({
      ...FORM_PRODUTO_VAZIO,
      nome:          p.medicamentoNome,
      medicamentoId: p.medicamentoId,
      produtoId:     p.id,
      fornecedorId:  p.fornecedorId,
      unidade:       p.unidade ?? p.unidadeCatalogo ?? '',
      valorUnitario: p.valorUnitario != null ? String(p.valorUnitario) : '',
      valorVenda:    p.valorVenda    != null ? String(p.valorVenda)    : '',
      notaFiscal:    p.notaFiscal ?? '',
      multidose:     p.multidose,
      dosesPorEmbalagem: p.dosesPorEmbalagem != null ? String(p.dosesPorEmbalagem) : '',
    });
    setMostrarForm(true);
  };

  const confirmarExclusao = async (motivo: string) => {
    if (!excluindo) return;
    try {
      await api.delete(`/cadastro/produtos/${excluindo.id}`, { data: { motivo } });
      toast.success('Produto removido');
      setExcluindo(null);
      await carregarProdutos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao remover o produto.');
    }
  };

  const daAba = useMemo(
    () => produtos.filter(p => (tipo === 'vacina' ? p.ehVacina : !p.ehVacina)),
    [produtos, tipo],
  );

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
            Medicamentos e vacinas da clínica, com fornecedor e entrada de estoque.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {podeCriar && (
            <button onClick={() => setLeitorAberto(true)}
              className="flex items-center gap-2 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 px-4 py-2 rounded-xl text-sm font-semibold">
              <FileText size={15} /> Ler documento de compra
            </button>
          )}
          {podeCriar && !mostrarForm && (
            <button onClick={() => {
              setForm(FORM_PRODUTO_VAZIO); setMostrarForm(true);
              setOrigemNota(false); ultimoDetalhe.current = '';
            }}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold">
              <Plus size={15} /> Novo produto
            </button>
          )}
        </div>
      </div>

      {/* Base sem a migration: DIZ o que falta, em vez de mostrar uma lista vazia que
          se lê como "não há produto cadastrado". */}
      {!disponivel && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-snug">
            <strong>Produtos ainda não disponível nesta base.</strong> Falta aplicar a migration{' '}
            <code className="font-mono">20261006000000_produtos_contas_pagar</code>.
          </p>
        </div>
      )}

      {/* ── Abas Medicamento × Vacina, como no cadastro de procedimentos ───── */}
      <div className="flex items-center gap-2 mb-4">
        {(['medicamento', 'vacina'] as TipoProduto[]).map(t => {
          const ativo = tipo === t;
          const Icone = t === 'vacina' ? Syringe : Pill;
          return (
            <button key={t} onClick={() => setTipo(t)}
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
          {filaDaNota.length > 0 && (
            <p className="mb-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Lendo a nota — este é o produto <strong>{filaDaNota.length + 1}º ao último</strong>.
              Salvar avança para o próximo automaticamente.
            </p>
          )}
          <FormProduto
            tipo={tipo}
            form={form}
            onForm={patch}
            catalogo={catalogo}
            buscandoCatalogo={buscandoCatalogo}
            fornecedores={fornecedores}
            salvando={salvando}
            carregandoItem={carregandoItem}
            multidoseDisponivel={multidoseDisponivel}
            onSalvar={salvar}
            onCancelar={() => {
              setMostrarForm(false); setForm(FORM_PRODUTO_VAZIO); setFilaDaNota([]);
              setErroForm(null); setOrigemNota(false); ultimoDetalhe.current = '';
            }}
            onNovoFornecedor={() => navigate('/cadastro/fornecedores', {
              state: { abrirNovo: true, depois: '/cadastro/produtos' },
            })}
          />
          {/* Erro da AÇÃO fica abaixo do botão que a disparou (§6) — no topo da
              página, quem clica em Salvar no fim do formulário não o veria. */}
          <ErroAcao erro={erroForm} />
        </div>
      )}

      {/* ── Lista ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por produto ou fornecedor..."
            className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-emerald-400" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
      ) : daAba.length === 0 ? (
        <div className="text-center py-14 text-gray-400 text-sm">
          {busca.trim()
            ? `Nenhum produto encontrado para "${busca}".`
            : `Nenhum ${tipo === 'vacina' ? 'a vacina' : 'medicamento'} cadastrado como produto.`}
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <JanelaLista maxItens={3}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-5 py-3 font-semibold">Produto</th>
                    <th className="px-5 py-3 font-semibold">Fornecedor</th>
                    <th className="px-5 py-3 font-semibold text-right whitespace-nowrap">Valor compra</th>
                    <th className="px-5 py-3 font-semibold text-right whitespace-nowrap">Valor venda</th>
                    <th className="px-5 py-3 font-semibold">Nota</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {daAba.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {p.medicamentoNome}
                        {/* O selo diz que aquele item é cobrado POR DOSE — sem ele,
                            duas linhas iguais teriam cobranças diferentes e nada na
                            tela explicaria por quê. */}
                        {p.multidose && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full align-middle">
                            <Layers size={10} />
                            {p.dosesPorEmbalagem ? `${p.dosesPorEmbalagem} doses/emb.` : 'multidose'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600">{p.fornecedorNome ?? '—'}</td>
                      <td className="px-5 py-3 text-right">
                        {p.valorUnitario != null
                          ? <span className="font-semibold text-gray-700">{brlProduto(p.valorUnitario)}</span>
                          /* Sem preço de compra a conta a pagar não é lançada — o
                             aviso fica na LINHA, que é onde se resolve. */
                          : <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">sem valor</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">{brlProduto(p.valorVenda)}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{p.notaFiscal ?? '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <AcoesRegistro>
                          {/* Ordem e cor da §6: Alterar (laranja) primeiro, Cancelar
                              (vermelho) por último. */}
                          <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar"
                            visivel={podeEditar} onClick={() => editarProduto(p)} />
                          <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Excluir"
                            visivel={podeExcluir} onClick={() => setExcluindo(p)} />
                        </AcoesRegistro>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </JanelaLista>
          </div>

          <div className="md:hidden space-y-2">
            <JanelaLista maxItens={3}>
              {daAba.map(p => (
                <div key={p.id} data-item-lista className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="font-semibold text-gray-900 text-sm">{p.medicamentoNome}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{p.fornecedorNome ?? 'Sem fornecedor'}</p>
                  {p.multidose && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                      <Layers size={10} />
                      {p.dosesPorEmbalagem ? `${p.dosesPorEmbalagem} doses/emb.` : 'multidose'}
                    </span>
                  )}
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-gray-400">Compra</span>
                    {p.valorUnitario != null
                      ? <span className="font-semibold text-gray-700">{brlProduto(p.valorUnitario)}</span>
                      : <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">sem valor</span>}
                  </div>
                  <div className="flex items-center justify-between mt-1 text-xs">
                    <span className="text-gray-400">Venda</span>
                    <span className="text-gray-600">{brlProduto(p.valorVenda)}</span>
                  </div>
                  {(podeEditar || podeExcluir) && (
                    /* ⚠️ Ações do CARD vão no RODAPÉ (§6): com rótulo, ao lado do
                       nome elas espremeriam o produto. */
                    <div className="mt-3 pt-3 border-t border-gray-50">
                      <AcoesRegistro>
                        <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar"
                          visivel={podeEditar} onClick={() => editarProduto(p)} />
                        <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Excluir"
                          visivel={podeExcluir} onClick={() => setExcluindo(p)} />
                      </AcoesRegistro>
                    </div>
                  )}
                </div>
              ))}
            </JanelaLista>
          </div>
        </>
      )}

      <LeitorNotaFiscal aberto={leitorAberto} onFechar={() => setLeitorAberto(false)} onUsar={usarNota} />

      <ModalJustificativa
        aberto={!!excluindo}
        titulo="Remover produto"
        descricao={excluindo ? `Remover "${excluindo.medicamentoNome}" do fornecedor ${excluindo.fornecedorNome ?? '—'}?` : ''}
        acaoLabel="Remover"
        onConfirmar={confirmarExclusao}
        onFechar={() => setExcluindo(null)}
      />
    </PageContainer>
  );
}
