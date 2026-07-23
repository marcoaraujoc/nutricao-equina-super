// frontend/src/pages/Resenha.tsx — Resenha Gráfica Equina

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Printer, Loader2, Save } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import PageContainer from '../components/PageContainer';
import AnimalCard from '../components/AnimalCard';
import { ResenhaGraficaEquino } from '../components/resenha/ResenhaGraficaEquino';
import InlineError from '../components/InlineError';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnimalSimples {
  id: number; nome: string; photoUrl?: string | null;
  dataNascimento?: string | null; idadeAnos?: number | null;
  sexo?: string | null;
  pelagem?: string | null; altura?: string | null;
  registroPassaporte?: string | null; finalidade?: string | null;
  raca?: { nome: string } | null; especie?: { nome: string } | null;
  user?: { fullName: string; email: string } | null;
}

interface ResenhaForm {
  numeroCBH:          string;
  paisNascimento:     string;
  registroGenealogia: string;
  pai:                string;
  mae:                string;
  paiDaMae:           string;
  sinaisCabeca:       string;
  sinaisAE:           string;
  sinaisAD:           string;
  sinaisPE:           string;
  sinaisPD:           string;
  sinaisCorpo:        string;
  marcaFogo:          string;
  outroId:            string;
}

const FORM_EMPTY: ResenhaForm = {
  numeroCBH: '', paisNascimento: 'Brasil', registroGenealogia: '',
  pai: '', mae: '', paiDaMae: '',
  sinaisCabeca: '', sinaisAE: '', sinaisAD: '', sinaisPE: '', sinaisPD: '', sinaisCorpo: '',
  marcaFogo: '', outroId: '',
};

// ─── Resenha Page ─────────────────────────────────────────────────────────────

export default function Resenha() {
  const navigate = useNavigate();
  const { animalId } = useParams<{ animalId?: string }>();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const [animais,        setAnimais]        = useState<AnimalSimples[]>([]);
  const [loadingAnimais, setLoadingAnimais] = useState(true);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [animal,         setAnimal]         = useState<AnimalSimples | null>(null);
  const [form,           setForm]           = useState<ResenhaForm>(FORM_EMPTY);
  const [saving,         setSaving]         = useState(false);

  // Load animal list
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/animais');
        if (!res.data) return;
        const lista: AnimalSimples[] = res.data?.dados ?? res.data ?? [];
        setAnimais(lista);
        if (!effectiveAnimalId && lista.length === 1)
          setSelectedAnimal(lista[0] as Parameters<typeof setSelectedAnimal>[0]);
      } catch { /* silencioso */ }
      finally { setLoadingAnimais(false); }
    })();
  }, []);

  // Load animal detail + existing resenha text data when animal changes.
  // As duas chamadas são independentes — a falha da resenha textual não
  // deve impedir o animal de ser exibido nem o componente gráfico de montar.
  useEffect(() => {
    if (!effectiveAnimalId) { setAnimal(null); setForm(FORM_EMPTY); return; }
    (async () => {
      // 1. Animal (obrigatório — bloqueia o restante do render)
      let a: AnimalSimples | null = null;
      try {
        const resAnimal = await api.get(`/animais/${effectiveAnimalId}`);
        a = resAnimal.data?.dados ?? resAnimal.data ?? null;
        if (a) setAnimal(a);
      } catch { /* silencioso */ }

      // 2. Resenha textual (opcional — falha silenciosa mantém formulário vazio)
      try {
        const resResenha = await api.get(`/resenha/animal/${effectiveAnimalId}`);
        const r = resResenha.data?.data ?? null;
        setForm({
          numeroCBH:          r?.numeroCBH          ?? '',
          paisNascimento:     r?.paisNascimento      ?? 'Brasil',
          registroGenealogia: r?.registroGenealogia  ?? (a?.registroPassaporte ?? ''),
          pai:                r?.pai                 ?? '',
          mae:                r?.mae                 ?? '',
          paiDaMae:           r?.paiDaMae            ?? '',
          sinaisCabeca:       r?.sinaisCabeca        ?? '',
          sinaisAE:           r?.sinaisAE            ?? '',
          sinaisAD:           r?.sinaisAD            ?? '',
          sinaisPE:           r?.sinaisPE            ?? '',
          sinaisPD:           r?.sinaisPD            ?? '',
          sinaisCorpo:        r?.sinaisCorpo         ?? '',
          marcaFogo:          r?.marcaFogo           ?? '',
          outroId:            r?.outroId             ?? '',
        });
      } catch { /* silencioso — formulário textual permanece vazio */ }
    })();
  }, [effectiveAnimalId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.post('/resenha', {
        animalId: effectiveAnimalId ? Number(effectiveAnimalId) : null,
        ...form,
      });
      toast.success('Dados da resenha salvos!');
    } catch {
      setErroInline('Erro ao salvar dados da resenha.');
    } finally {
      setSaving(false);
    }
  }, [effectiveAnimalId, form]);

  const handlePrint = () => window.print();

  const dataNasc = animal?.dataNascimento
    ? new Date(animal.dataNascimento).toLocaleDateString('pt-BR')
    : '';

  const calcIdade = () => {
    if (animal?.dataNascimento) {
      const anos = Math.floor((Date.now() - new Date(animal.dataNascimento).getTime()) / (365.25 * 24 * 3600 * 1000));
      return `${anos} anos`;
    }
    if (animal?.idadeAnos) return `${animal.idadeAnos} anos`;
    return '';
  };

  return (
    <PageContainer maxWidth="7xl">
      <InlineError message={erroInline} className="mb-4" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <FileText size={22} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Resenha Equina</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">
            <Printer size={15} /> Imprimir
          </button>
          <button onClick={handleSave} disabled={saving || !effectiveAnimalId}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Salvar dados
          </button>
        </div>
      </div>

      {/* Animal selector */}
      {animal && <AnimalCard animal={animal} />}

      {animais.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-500 mb-1">Paciente</label>
          <select
            value={effectiveAnimalId ?? ''}
            onChange={e => {
              if (e.target.value === '__novo__') { navigate('/animais', { state: { returnTo: '/resenha' } }); return; }
              const a = animais.find(x => x.id === Number(e.target.value));
              if (!a) return;
              setSelectedAnimal(a as Parameters<typeof setSelectedAnimal>[0]);
              navigate(`/resenha/${a.id}`);
            }}
            className="w-full max-w-sm border border-gray-200 rounded-2xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-600 shadow-sm"
          >
            <option value="">— selecione o paciente —</option>
            <option value="__novo__">+ Cadastrar novo paciente</option>
            <option disabled>──────────────</option>
            {animais.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        </div>
      )}

      {!loadingAnimais && animais.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center mb-6">
          <FileText size={26} className="text-amber-400 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-gray-800 mb-1">Nenhum paciente cadastrado</h3>
          <p className="text-sm text-gray-500 mb-4">Cadastre um equino para gerar a resenha.</p>
          <button onClick={() => navigate('/animais')}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
            Cadastrar Paciente
          </button>
        </div>
      )}

      {!loadingAnimais && animais.length > 0 && !effectiveAnimalId && (
        <div className="flex items-center gap-3 px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 text-sm">
          <FileText size={16} className="shrink-0" />
          Selecione um paciente no seletor acima para preencher a resenha.
        </div>
      )}

      {effectiveAnimalId && (
        <div className="space-y-6">

          {/* ── 1. Identificação do Animal ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
              Identificação do Animal
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <ReadField label="Nome"              value={animal?.nome ?? ''} />
              <ReadField label="Raça"              value={animal?.raca?.nome ?? ''} />
              <ReadField label="Pelagem"           value={animal?.pelagem ?? ''} />
              <ReadField label="Sexo"              value={animal?.sexo ?? ''} />
              <ReadField label="Nascimento"        value={dataNasc} />
              <ReadField label="Idade"             value={calcIdade()} />
              <ReadField label="Altura (cernelha)" value={animal?.altura ?? ''} />
              <ReadField label="Finalidade"        value={animal?.finalidade ?? ''} />
              <ReadField label="Proprietário"      value={animal?.user?.fullName ?? ''} />
            </div>
          </div>

          {/* ── 2. Dados do Registro ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
              Dados do Registro
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="N° CBH / Passaporte"    value={form.numeroCBH}
                onChange={v => setForm(p => ({ ...p, numeroCBH: v }))} />
              <Field label="País de Nascimento"     value={form.paisNascimento}
                onChange={v => setForm(p => ({ ...p, paisNascimento: v }))} />
              <Field label="Registro de Genealogia" value={form.registroGenealogia}
                onChange={v => setForm(p => ({ ...p, registroGenealogia: v }))} />
              <Field label="Outro ID / Microchip"   value={form.outroId}
                onChange={v => setForm(p => ({ ...p, outroId: v }))} />
              <Field label="Marca de Fogo"          value={form.marcaFogo}
                onChange={v => setForm(p => ({ ...p, marcaFogo: v }))} />
            </div>
          </div>

          {/* ── 3. Genealogia ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
              Genealogia
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Pai"        value={form.pai}     onChange={v => setForm(p => ({ ...p, pai: v }))} />
              <Field label="Mãe"        value={form.mae}     onChange={v => setForm(p => ({ ...p, mae: v }))} />
              <Field label="Pai da Mãe" value={form.paiDaMae} onChange={v => setForm(p => ({ ...p, paiDaMae: v }))} />
            </div>
          </div>

          {/* ── 4. Sinais Particulares ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
              Sinais Particulares (descritivo)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextArea label="Cabeça"            value={form.sinaisCabeca} onChange={v => setForm(p => ({ ...p, sinaisCabeca: v }))} />
              <TextArea label="Corpo"             value={form.sinaisCorpo}  onChange={v => setForm(p => ({ ...p, sinaisCorpo: v }))} />
              <TextArea label="Membro Ant. Esq."  value={form.sinaisAE}     onChange={v => setForm(p => ({ ...p, sinaisAE: v }))} />
              <TextArea label="Membro Ant. Dir."  value={form.sinaisAD}     onChange={v => setForm(p => ({ ...p, sinaisAD: v }))} />
              <TextArea label="Membro Post. Esq." value={form.sinaisPE}     onChange={v => setForm(p => ({ ...p, sinaisPE: v }))} />
              <TextArea label="Membro Post. Dir." value={form.sinaisPD}     onChange={v => setForm(p => ({ ...p, sinaisPD: v }))} />
            </div>
          </div>

          {/* ── 5. Resenha Gráfica ── */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
              Resenha Gráfica
            </h2>
            <p className="text-xs text-gray-500 mb-5">
              Selecione o tipo de marcação, depois desenhe com o dedo ou mouse sobre a silhueta fiel do equino.
              O SVG exibido é o documento oficial — cada vista mostra uma região anatômica específica.
            </p>
            <ResenhaGraficaEquino animalId={Number(effectiveAnimalId)} />
          </div>

          {/* Bottom save */}
          <div className="flex justify-end pb-4">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar Dados da Resenha
            </button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-gray-400 mb-0.5">{label}</span>
      <span className="block text-sm font-medium text-gray-800">{value || '—'}</span>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea rows={2} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
    </div>
  );
}
