import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function CadastroPessoal() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    nomeCompleto: '',
    telefone: '',
    email: '',
    cep: '',
    endereco: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    tipoUsuario: 'PROPRIETARIO',
  });

  // Carrega os dados do usuário logado do banco ao abrir a tela
  useEffect(() => {
    const loadUserData = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/users/me', {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setForm({
            nomeCompleto: data.fullName || '',
            telefone: data.phone || '',
            email: data.email || '',
            cep: data.cep || '',
            endereco: data.endereco || '',
            complemento: data.complemento || '',
            bairro: data.bairro || '',
            cidade: data.cidade || '',
            estado: data.estado || '',
            tipoUsuario: data.userType || 'PROPRIETARIO',
          });
        }
      } catch (err) {
        console.error('Erro ao carregar dados do usuário:', err);
      } finally {
        setLoading(false);
      }
    };

    loadUserData();
  }, []);

  const buscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (data.erro) return alert('CEP não encontrado');

      setForm(prev => ({
        ...prev,
        endereco: data.logradouro || '',
        bairro: data.bairro || '',
        cidade: data.localidade || '',
        estado: data.uf || '',
      }));
    } catch {
      alert('Erro ao buscar CEP');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('✅ Cadastro Pessoal enviado:', form);
    alert('Cadastro salvo com sucesso!');
    window.location.href = '/cavalos';
  };

  if (loading) return <div className="p-8 text-center">Carregando dados...</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white shadow rounded-3xl p-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-1">Cadastro Pessoal</h1>
        <p className="text-gray-500 mb-8">Complete suas informações para continuar</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
            <input type="text" name="nomeCompleto" value={form.nomeCompleto} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" required />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="tel" name="telefone" value={form.telefone} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input type="email" name="email" value={form.email} readOnly className="w-full px-4 py-3 border border-gray-300 bg-gray-100 rounded-2xl text-gray-900" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
            <input type="text" name="cep" maxLength={8} value={form.cep} onChange={e => {
              setForm(prev => ({ ...prev, cep: e.target.value }));
              if (e.target.value.length === 8) buscarCep(e.target.value);
            }} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" required />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
              <input type="text" name="endereco" value={form.endereco} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input type="text" name="complemento" value={form.complemento} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input type="text" name="bairro" value={form.bairro} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <input type="text" name="cidade" value={form.cidade} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <input type="text" name="estado" maxLength={2} value={form.estado} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900" required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Usuário</label>
            <select name="tipoUsuario" value={form.tipoUsuario} onChange={handleChange} className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500 text-gray-900">
              <option value="PROPRIETARIO">Proprietário</option>
              <option value="VETERINARIO">Médico Veterinário</option>
            </select>
          </div>

          <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-3xl text-lg font-semibold mt-8">
            Salvar e Continuar
          </button>
        </form>
      </div>
    </div>
  );
}
