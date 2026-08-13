// src/pages/CriacaoGestor.tsx
//
// CRIAÇÃO DE GESTOR — tela do ADMIN da plataforma (`/admin/criacao-gestor`).
//
// 🔴 MODELO 2026-08-17: o Admin cria só o GESTOR (dados básicos + plano). A empresa
// nasce JUNTO — é o tenant que o vínculo GESTOR precisa —, mas com identidade em
// branco (sem nome definitivo, sem CNPJ/CPF, sem espécies): é o próprio gestor quem
// completa isso depois em Cadastro da Empresa (`/cadastro/empresa`), sob a mesma
// obrigatoriedade que hoje trava o acesso até o cadastro estar completo.
//
// Reverte o modelo anterior (`EquipeManager.tsx` até 2026-08-16), em que o Admin
// também escolhia nome/CNPJ/espécies/telefone da empresa na criação — ver
// `EquipeController.criarGestor` (`POST /equipes/gestores`).

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { UserPlus, Check, Loader2 } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ErroAcao, { classeErro, type ErroAcaoDados } from '../components/ErroAcao';
import Campo, { INPUT_CLS } from '../components/CampoForm';
import { isValidEmail } from '../utils/validators';
import { mascaraTelefone, mascaraCep, soDigitos } from '../utils/mascaras';

interface Form {
  fullName: string; email: string; telefone: string;
  cep: string; endereco: string; complemento: string; bairro: string; cidade: string; estado: string;
  planoId: string;
}

const FORM_VAZIO: Form = {
  fullName: '', email: '', telefone: '',
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
  planoId: '',
};

export default function CriacaoGestor() {
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(FORM_VAZIO);
  const [planos, setPlanos] = useState<{ id: number; nome: string; precoMensal: number | null }[]>([]);
  const [buscandoCEP, setBuscandoCEP] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<ErroAcaoDados | null>(null);

  const set = (campo: keyof Form, valor: string) => setForm(f => ({ ...f, [campo]: valor }));

  useEffect(() => {
    api.get('/planos?ativos=1')
      .then(res => { if (res.data) setPlanos(res.data.dados ?? []); })
      .catch(() => { /* silencioso: não-admin não vê planos */ });
  }, []);

  const buscarCEP = async (cep: string) => {
    const nums = soDigitos(cep);
    if (nums.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${nums}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(f => ({
          ...f,
          endereco: data.logradouro ?? f.endereco,
          bairro:   data.bairro     ?? f.bairro,
          cidade:   data.localidade ?? f.cidade,
          estado:   data.uf         ?? f.estado,
        }));
      }
    } catch { /* silencioso */ }
    finally { setBuscandoCEP(false); }
  };

  const handleSalvar = async () => {
    setErro(null);
    if (!form.fullName.trim()) { setErro({ mensagem: 'Nome é obrigatório.', campos: ['fullName'] }); return; }
    if (!form.email.trim() || !isValidEmail(form.email.trim())) {
      setErro({ mensagem: 'Informe um e-mail válido.', campos: ['email'] }); return;
    }
    if (!form.telefone.trim()) { setErro({ mensagem: 'Telefone é obrigatório.', campos: ['telefone'] }); return; }
    if (!(form.cep.trim() && form.endereco.trim() && form.bairro.trim() && form.cidade.trim() && form.estado.trim())) {
      setErro({
        mensagem: 'Endereço é obrigatório (CEP, logradouro, bairro, cidade e UF).',
        campos: ['cep', 'endereco', 'bairro', 'cidade', 'estado'],
      });
      return;
    }
    if (!form.planoId) { setErro({ mensagem: 'Selecione um plano.', campos: ['plano'] }); return; }

    setSalvando(true);
    try {
      await api.post('/equipes/gestores', {
        fullName:    form.fullName.trim(),
        email:       form.email.trim(),
        telefone:    form.telefone.trim(),
        cep:         soDigitos(form.cep),
        endereco:    form.endereco.trim(),
        complemento: form.complemento.trim() || undefined,
        bairro:      form.bairro.trim(),
        cidade:      form.cidade.trim(),
        estado:      form.estado.trim().toUpperCase(),
        planoId:     Number(form.planoId),
      });
      toast.success('Gestor criado com sucesso!');
      setForm(FORM_VAZIO);
      navigate('/admin/empresas');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem;
      setErro({ mensagem: msg ?? 'Erro ao criar o gestor.' });
    } finally { setSalvando(false); }
  };

  return (
    <PageContainer maxWidth="5xl">
      <BotaoVoltar />

      <div className="mt-2 mb-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <UserPlus size={24} className="text-emerald-600 flex-shrink-0" />
          Criação de Gestor
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          A empresa nasce em branco — o próprio gestor completa nome, CNPJ/CPF e demais dados em Cadastro da Empresa.
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <Campo label="NOME COMPLETO *" className="sm:col-span-4">
            <input value={form.fullName} onChange={e => set('fullName', e.target.value)}
              className={classeErro(erro, 'fullName', INPUT_CLS)} />
          </Campo>
          <Campo label="TELEFONE *" className="sm:col-span-2">
            <input value={form.telefone} placeholder="(11) 98765-4321"
              onChange={e => set('telefone', mascaraTelefone(e.target.value))}
              className={classeErro(erro, 'telefone', INPUT_CLS)} />
          </Campo>
          <Campo label="E-MAIL *" className="sm:col-span-6">
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className={classeErro(erro, 'email', INPUT_CLS)} />
          </Campo>

          <Campo label="CEP *" className="sm:col-span-2">
            <input value={form.cep} placeholder="00000-000"
              onChange={e => { const v = mascaraCep(e.target.value); set('cep', v); if (soDigitos(v).length === 8) buscarCEP(v); }}
              className={classeErro(erro, 'cep', INPUT_CLS)} />
            {buscandoCEP && <p className="text-xs text-gray-400 mt-1">Buscando endereço…</p>}
          </Campo>
          <Campo label="LOGRADOURO *" className="sm:col-span-4">
            <input value={form.endereco} onChange={e => set('endereco', e.target.value)}
              className={classeErro(erro, 'endereco', INPUT_CLS)} />
          </Campo>
          <Campo label="COMPLEMENTO" className="sm:col-span-2">
            <input value={form.complemento} onChange={e => set('complemento', e.target.value)} className={INPUT_CLS} />
          </Campo>
          <Campo label="BAIRRO *" className="sm:col-span-2">
            <input value={form.bairro} onChange={e => set('bairro', e.target.value)}
              className={classeErro(erro, 'bairro', INPUT_CLS)} />
          </Campo>
          <Campo label="CIDADE *" className="sm:col-span-2">
            <input value={form.cidade} onChange={e => set('cidade', e.target.value)}
              className={classeErro(erro, 'cidade', INPUT_CLS)} />
          </Campo>
          <Campo label="UF *" className="sm:col-span-2">
            <input maxLength={2} value={form.estado} onChange={e => set('estado', e.target.value.toUpperCase())}
              className={classeErro(erro, 'estado', INPUT_CLS)} />
          </Campo>

          <Campo label="PLANO *" className="sm:col-span-6">
            <select value={form.planoId} onChange={e => set('planoId', e.target.value)}
              className={`${classeErro(erro, 'plano', INPUT_CLS)} bg-white`}>
              <option value="">Selecione o plano</option>
              {planos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nome}{p.precoMensal != null ? ` — ${p.precoMensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês` : ''}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={handleSalvar} disabled={salvando}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {salvando ? 'Criando…' : 'Criar gestor'}
          </button>
        </div>
        <ErroAcao erro={erro} className="mt-3" />
      </section>
    </PageContainer>
  );
}
