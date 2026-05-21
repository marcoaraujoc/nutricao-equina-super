// src/pages/CadastroPessoal.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';

const CRMV_REGEX = /^\d{1,6}\/(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;

const SUBESPECIALIDADES = [
  'Clínico',
  'Quiroprata',
  'Fisioterapeuta',
  'Oftalmologista',
  'Dermatologista',
  'Cardiologista',
  'Ortopedista',
  'Neurologista',
  'Oncologista',
  'Nutricionista',
  'Anestesiologista',
  'Radiologista',
  'Reprodução Animal',
];

export default function CadastroPessoal() {
  const { user }                  = useAuth();
  const { refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                  = useNavigate();
  const [loading, setLoading]     = useState(true);
  const [saving,  setSaving]      = useState(false);

  // ── Espécies ──────────────────────────────────────────────────────────────
  const [especies, setEspecies] = useState<{ id: number; nome: string }[]>([]);

  useEffect(() => {
    api.get('/especies')
      .then(res => setEspecies(res.data?.dados ?? res.data ?? []))
      .catch(() => {});
  }, []);

  // ── Formulário ────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    nomeCompleto:      '',
    telefone:          '',
    email:             '',
    cep:               '',
    endereco:          '',
    complemento:       '',
    bairro:            '',
    cidade:            '',
    estado:            '',
    tipoUsuario:       'PROPRIETARIO',
    crmv:              '',
    especiesAtendidas: [] as number[],
    subespecialidades: [] as string[],
  });

  // ── Carregar dados do usuário ─────────────────────────────────────────────
  useEffect(() => {
    const loadUserData = async () => {
      const token = localStorage.getItem('token');
      if (!token || !user?.email) { setLoading(false); return; }
      try {
        const res = await fetch('/api/users/me', {
          method:  'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setForm({
            nomeCompleto:      data.fullName          || '',
            telefone:          data.phone             || '',
            email:             data.email             || '',
            cep:               data.cep               || '',
            endereco:          data.endereco          || '',
            complemento:       data.complemento       || '',
            bairro:            data.bairro            || '',
            cidade:            data.cidade            || '',
            estado:            data.estado            || '',
            tipoUsuario:       data.userType          || 'PROPRIETARIO',
            crmv:              data.crmv              || '',
            especiesAtendidas: data.especiesAtendidas || [],
            subespecialidades: data.subespecialidades || [],
          });
        }
      } catch (err) {
        console.error('Erro ao carregar dados do usuário:', err);
      } finally {
        setLoading(false);
      }
    };
    loadUserData();
  }, [user?.email]);

  // ── Busca de CEP ──────────────────────────────────────────────────────────
  const buscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error('CEP não encontrado'); return; }
      setForm(prev => ({
        ...prev,
        endereco: data.logradouro || '',
        bairro:   data.bairro     || '',
        cidade:   data.localidade || '',
        estado:   data.uf         || '',
      }));
    } catch {
      toast.error('Erro ao buscar CEP');
    }
  };

  const maskCRMV = (value: string): string => {
    const digitos = value.replace(/\D/g, '').slice(0, 6);
    const letras  = value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
    if (!digitos) return '';
    if (!letras)  return digitos;
    return `${digitos}/${letras}`;
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const toggleEspecie = (id: number) => {
    setForm(prev => ({
      ...prev,
      especiesAtendidas: prev.especiesAtendidas.includes(id)
        ? prev.especiesAtendidas.filter(eid => eid !== id)
        : [...prev.especiesAtendidas, id],
    }));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    if (form.tipoUsuario === 'VETERINARIO') {
      if (!form.crmv.trim()) {
        toast.error('CRMV é obrigatório para Médicos Veterinários');
        setSaving(false);
        return;
      }
      if (!CRMV_REGEX.test(form.crmv.trim())) {
        toast.error('Formato de CRMV inválido. Use o formato: 12345/SP');
        setSaving(false);
        return;
      }
    }

    const token = localStorage.getItem('token');
    if (!token) { toast.error('Você precisa estar logado'); setSaving(false); return; }

    const payload = {
      fullName:    form.nomeCompleto,
      phone:       form.telefone,
      cep:         form.cep,
      endereco:    form.endereco,
      complemento: form.complemento,
      bairro:      form.bairro,
      cidade:      form.cidade,
      estado:      form.estado,
      userType:    form.tipoUsuario,
      ...(form.tipoUsuario === 'VETERINARIO' && {
        crmv:              form.crmv.trim(),
        especiesAtendidas: form.especiesAtendidas,
        subespecialidades: form.subespecialidades,
      }),
    };

    try {
      const res      = await fetch('/api/users/me', {
        method:  'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const resData  = await res.json();

      if (res.ok) {
        // Atualiza o JWT com o userType correto para refletir imediatamente no app
        if (resData.token) {
          localStorage.setItem('token', resData.token);
        }
        toast.success('Cadastro pessoal salvo com sucesso!');
        await refreshSelectedAnimal();

        if (form.tipoUsuario === 'VETERINARIO') {
          localStorage.setItem('s2vet_ob', 'd');
          navigate('/clinica');
        } else {
          const ob = localStorage.getItem('s2vet_ob');
          if (ob === 'p' || ob === null || ob === '') {
            localStorage.setItem('s2vet_ob', 'a');
            navigate('/animais');
          } else {
            navigate('/meus-animais');
          }
        }
      } else {
        toast.error(`Erro ao salvar: ${resData.error || 'Tente novamente'}`);
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      toast.error('Erro de conexão com o servidor');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="p-8 text-center text-gray-500">Carregando dados...</div>;

  const inputClass = 'w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900';

  return (
    <div className="max-w-2xl mx-auto px-2 sm:px-0">
      <div className="bg-white shadow rounded-3xl p-5 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1">Cadastro Pessoal</h1>
        <p className="text-gray-500 mb-6 sm:mb-8 text-sm sm:text-base">
          Complete suas informações para continuar
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
            <input type="text" name="nomeCompleto" value={form.nomeCompleto}
              onChange={handleChange} className={inputClass} required />
          </div>

          {/* Telefone + Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="tel" name="telefone" value={form.telefone}
                onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input type="email" name="email" value={form.email} readOnly
                className="w-full px-4 py-3 border border-gray-300 bg-gray-100 rounded-2xl text-gray-900 cursor-not-allowed" />
            </div>
          </div>

          {/* CEP */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
            <input
              type="text" name="cep" maxLength={8} value={form.cep}
              onChange={e => {
                setForm(prev => ({ ...prev, cep: e.target.value }));
                if (e.target.value.length === 8) buscarCep(e.target.value);
              }}
              className={inputClass} required
            />
          </div>

          {/* Endereço + Complemento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
              <input type="text" name="endereco" value={form.endereco}
                onChange={handleChange} className={inputClass} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input type="text" name="complemento" value={form.complemento}
                onChange={handleChange} className={inputClass} />
            </div>
          </div>

          {/* Bairro + Cidade + Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input type="text" name="bairro" value={form.bairro}
                onChange={handleChange} className={inputClass} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <input type="text" name="cidade" value={form.cidade}
                onChange={handleChange} className={inputClass} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <input type="text" name="estado" maxLength={2} value={form.estado}
                onChange={handleChange} className={inputClass} required />
            </div>
          </div>

          {/* Tipo de Usuário */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Usuário</label>
            <select name="tipoUsuario" value={form.tipoUsuario} onChange={handleChange}
              className={inputClass}>
              <option value="PROPRIETARIO">Proprietário</option>
              <option value="VETERINARIO">Médico Veterinário</option>
            </select>
          </div>

          {/* ── Dados profissionais — só para veterinários ── */}
          {form.tipoUsuario === 'VETERINARIO' && (
            <div className="pt-2 border-t border-gray-100 space-y-5">
              <p className="text-sm font-semibold text-gray-600">Dados Profissionais</p>

              {/* CRMV */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CRMV <span className="text-red-500">*</span>
                </label>
                <input
                  type="text" name="crmv" value={form.crmv}
                  onChange={e => setForm(prev => ({ ...prev, crmv: maskCRMV(e.target.value) }))}
                  placeholder="Ex: 12345/SP" maxLength={9}
                  className={inputClass}
                />
                <p className="text-xs text-gray-400 mt-1">Ex: 12345/SP</p>
              </div>

              {/* Espécies atendidas — checkboxes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Espécies atendidas{' '}
                  <span className="text-gray-400 text-xs font-normal">(opcional)</span>
                </label>
                {especies.length === 0 ? (
                  <p className="text-xs text-gray-400">Carregando espécies...</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {especies.map(esp => {
                      const selecionada = form.especiesAtendidas.includes(esp.id);
                      return (
                        <label key={esp.id}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border cursor-pointer transition-colors select-none ${
                            selecionada
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-300'
                          }`}>
                          <input
                            type="checkbox"
                            className="accent-emerald-600 flex-shrink-0"
                            checked={selecionada}
                            onChange={() => toggleEspecie(esp.id)}
                          />
                          <span className="text-sm font-medium">{esp.nome}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Subespecialidade — select (único valor) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subespecialidade{' '}
                  <span className="text-gray-400 text-xs font-normal">(opcional)</span>
                </label>
                <select
                  value={form.subespecialidades[0] ?? ''}
                  onChange={e => setForm(prev => ({
                    ...prev,
                    subespecialidades: e.target.value ? [e.target.value] : [],
                  }))}
                  className={inputClass}
                >
                  <option value="">Selecione uma subespecialidade</option>
                  {SUBESPECIALIDADES.map(sub => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>

            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-4 rounded-3xl text-base sm:text-lg font-semibold mt-4 transition-colors">
            {saving ? 'Salvando...' : 'Salvar e Continuar'}
          </button>

        </form>
      </div>
    </div>
  );
}