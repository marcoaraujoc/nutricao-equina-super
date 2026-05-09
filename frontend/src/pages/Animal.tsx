import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { ArrowLeft } from 'lucide-react';

const Animal = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(true);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [especies, setEspecies] = useState<any[]>([]);
  const [todasRacas, setTodasRacas] = useState<any[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    nome: '',
    especieId: 1,
    racaId: null as number | null,
    peso: '',
    dataNascimento: '',
    sexo: 'Macho',
    exercise: '',
  });

  // ==================== FUNÇÃO FORMATAR DATA ====================
  const formatarDataBR = (data: string | Date | null | undefined): string => {
  if (!data) return '-';

  // Se for string no formato yyyy-mm-dd, parseia diretamente
  if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}/.test(data)) {
    const [ano, mes, dia] = data.split('T')[0].split('-');
    return `${dia}/${mes}/${ano}`;
  }

  const dataObj = new Date(data instanceof Date ? data.toISOString() : data);
  if (isNaN(dataObj.getTime())) return '-';

  const dia = String(dataObj.getUTCDate()).padStart(2, '0');
  const mes = String(dataObj.getUTCMonth() + 1).padStart(2, '0');
  const ano = dataObj.getUTCFullYear();

  return `${dia}/${mes}/${ano}`;
};

  const especieAtual = especies.find(esp => esp.id === formData.especieId);
  const isEquino = !!especieAtual && 
    (especieAtual.nome.toLowerCase().includes('equino') || 
     especieAtual.nome.toLowerCase().includes('animal'));

  // Reseta exercise quando a espécie não é equina
  useEffect(() => {
    if (!isEquino && formData.exercise !== '') {
      setFormData(prev => ({ ...prev, exercise: '' }));
    }
  }, [isEquino]);

  // Carrega espécies, raças e dados do animal
  useEffect(() => {
    const loadData = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          api.get('/especies'),
          api.get('/racas')
        ]);
        setEspecies(espRes.data);
        setTodasRacas(racRes.data);

        if (isEditMode && id) {
          const animalRes = await api.get(`/animais/${id}`);
          const animal = animalRes.data;

          setFormData({
            nome: animal.nome,
            especieId: animal.especieId,
            racaId: animal.racaId,
            peso: animal.peso.toString(),
            dataNascimento: animal.dataNascimento ? animal.dataNascimento.split('T')[0] : '',
            sexo: animal.sexo,
            exercise: animal.exercise || '',
          });

          if (animal.photoUrl) setPhotoPreview(animal.photoUrl);
        }
      } catch (error) {
        console.error('Erro ao carregar dados', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, isEditMode]);

  // Melhoria na seleção automática de raça
  useEffect(() => {
    if (formData.especieId && todasRacas.length > 0) {
      const filtradas = todasRacas.filter((r: any) => r.especieId === formData.especieId);
      setRacasFiltradas(filtradas);

      if (filtradas.length > 0) {
        setFormData(prev => {
          if (!prev.racaId || !filtradas.some(r => r.id === prev.racaId)) {
            return { ...prev, racaId: filtradas[0].id };
          }
          return prev;
        });
      }
    }
  }, [formData.especieId, todasRacas]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    console.log('📤 Enviando -> racaId:', formData.racaId);

    if (!formData.nome?.trim()) {
      alert('❌ Nome do animal é obrigatório');
      setSubmitting(false);
      return;
    }

    if (!formData.racaId) {
      alert('❌ Raça é obrigatória');
      setSubmitting(false);
      return;
    }

    if (isEquino && !formData.exercise?.trim()) {
      alert('❌ Nível de exercício é obrigatório para equinos');
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        nome: formData.nome.trim(),
        especieId: formData.especieId,
        racaId: formData.racaId,
        peso: parseFloat(formData.peso) || 0,
        dataNascimento: formData.dataNascimento || null,
        sexo: formData.sexo,
        exercise: isEquino ? formData.exercise : null,
      };

      if (photoFile) {
        const formDataUpload = new FormData();
        formDataUpload.append('nome', payload.nome);
        formDataUpload.append('especieId', String(payload.especieId));
        formDataUpload.append('racaId', String(payload.racaId));
        formDataUpload.append('peso', String(payload.peso));
        formDataUpload.append('dataNascimento', payload.dataNascimento || '');
        formDataUpload.append('sexo', payload.sexo);
        formDataUpload.append('exercise', payload.exercise || '');
        formDataUpload.append('foto', photoFile);

        const config = { headers: { 'Content-Type': 'multipart/form-data' } };

        if (isEditMode) {
          await api.put(`/animais/${id}`, formDataUpload, config);
        } else {
          await api.post('/animais', formDataUpload, config);
        }
      } else {
        if (isEditMode) {
          await api.put(`/animais/${id}`, payload);
        } else {
          await api.post('/animais', payload);
        }
      }

      alert(isEditMode ? '✅ Animal atualizado com sucesso!' : '✅ Animal cadastrado com sucesso!');
      navigate('/meus-animais');
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || '❌ Erro ao salvar animal');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-6 md:p-8 border border-gray-100">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => navigate('/meus-animais')}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={24} />
              <span className="text-lg">Voltar</span>
            </button>
          </div>

          {/* Foto + Nome */}
          <div className="flex gap-6 mb-10">
            <label className="cursor-pointer group flex-shrink-0">
              <div className="w-40 h-40 rounded-3xl border-4 border-emerald-600 overflow-hidden bg-gray-100 shadow-inner transition-all group-hover:scale-105">
                {photoPreview ? (
                  <img src={photoPreview} alt="Foto" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-emerald-600 text-center p-4">
                    <div>
                      <span className="block text-sm font-medium">Adicionar foto</span>
                      <span className="text-xs">Clique aqui</span>
                    </div>
                  </div>
                )}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </label>

            <div className="flex-1 pt-4">
              <input
                type="text"
                required
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                className="w-full text-4xl font-bold text-gray-900 focus:outline-none border-b border-transparent focus:border-emerald-600"
                placeholder="Nome do Animal"
              />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                <select
                  value={formData.especieId}
                  onChange={(e) => setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                >
                  {especies.map((esp: any) => (
                    <option key={esp.id} value={esp.id}>{esp.nome}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                <select
                  value={formData.sexo}
                  onChange={(e) => setFormData({ ...formData, sexo: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                >
                  <option value="Macho">Macho</option>
                  <option value="Fêmea">Fêmea</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Raça <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.racaId || ''}
                onChange={(e) => setFormData({ ...formData, racaId: parseInt(e.target.value) })}
                required
                className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
              >
                {racasFiltradas.map((raca: any) => (
                  <option key={raca.id} value={raca.id}>{raca.nome}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peso (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={formData.peso}
                  onChange={(e) => setFormData({ ...formData, peso: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                />
              </div>
              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                  <input
                    type="text"
                    placeholder="dd/mm/aaaa"
                    required
                    autoComplete="off"
                    value={formData.dataNascimento
                      ? formData.dataNascimento.split('-').reverse().join('/')
                      : ''}
                    onChange={(e) => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 2) val = val.slice(0, 2) + '/' + val.slice(2);
                    if (val.length > 5) val = val.slice(0, 5) + '/' + val.slice(5);
                    val = val.slice(0, 10);

                    const parts = val.split('/');
                    if (parts.length === 3 && parts[2].length === 4) {
                      const dia = parseInt(parts[0]);
                      const mes = parseInt(parts[1]);
                      const ano = parseInt(parts[2]);

                      // Valida se a data realmente existe
                      const dataObj = new Date(ano, mes - 1, dia);
                      const dataValida =
                        dataObj.getFullYear() === ano &&
                        dataObj.getMonth() === mes - 1 &&
                        dataObj.getDate() === dia;

                      if (!dataValida) {
                        alert('❌ Data inválida. Verifique o dia, mês e ano informados.');
                        setFormData({ ...formData, dataNascimento: '' });
                        return;
                      }

                      const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
                      setFormData({ ...formData, dataNascimento: iso });
                    } else {
                      setFormData({ ...formData, dataNascimento: val });
                    }
                  }}
                    className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                  />
                </div>
            </div>

            {isEquino && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nível de Exercício <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.exercise}
                  onChange={(e) => setFormData({ ...formData, exercise: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                >
                  <option value="">Selecione o nível de exercício</option>
                  <option value="Exercicio leve">Exercício Leve</option>
                  <option value="Exercicio Moderado">Exercício Moderado</option>
                  <option value="Exercicio Pesado">Exercício Pesado</option>
                  <option value="Exercicio Muito Pesado">Exercício Muito Pesado</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-3.5 rounded-2xl font-semibold text-lg transition-colors"
            >
              {submitting 
                ? (isEditMode ? 'Atualizando Animal...' : 'Cadastrando Animal...') 
                : (isEditMode ? 'Atualizar Animal' : 'Cadastrar Animal')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Animal;