import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { ArrowLeft, Calendar } from 'lucide-react';

// -------------------------------------------------------------------
// Mapa completo de categorias NRC
// -------------------------------------------------------------------
const NRC_CATEGORIAS: Record<string, string[]> = {
  'Adulto - Manutenção': [
    'Temperamento Calmo',
    'Temperamento Médio',
    'Temperamento Nervoso',
  ],
  'Trabalhando': [
    'Exercício Leve',
    'Exercício Moderado',
    'Exercício Pesado',
    'Exercício Muito pesado',
  ],
  'Garanhões': [
    'Em serviço',
    'Fora de serviço',
  ],
  'Éguas Prenhas': [
    'Menos de 5 Meses',
    '5 Meses', '6 Meses', '7 Meses', '8 Meses',
    '9 Meses', '10 Meses', '11 Meses',
  ],
  'Éguas em Lactação': [
    '1 mês', '2 Meses', '3 Meses',
    '4 Meses', '5 Meses', '6 Meses',
  ],
  'Potros em Crescimento': [
    '4 Meses', '6 Meses', '12 Meses',
    '18 Meses', '18 Meses Exercício Leve', '18 Meses Exercício Moderado',
    '24 Meses', '24 Meses Exercício Leve', '24 Meses Exercício Moderado',
    '24 Meses Exercício Pesado', '24 Meses Exercício Muito Pesado',
  ],
};

// -------------------------------------------------------------------
// Interface
// -------------------------------------------------------------------
interface FormData {
  nome: string;
  especieId: number;
  racaId: number | null;
  peso: string;
  dataNascimento: string;
  idadeAnos: string;
  sexo: string;
  categoriaAnimal: string;
  tipoExercicio: string;
  veterinarioNome: string;
  veterinarioClinica: string;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/** Calcula idade em meses a partir da data ou da idade em anos */
const calcularIdadeEmMeses = (dataNascimento: string, idadeAnos: string): number | null => {
  if (dataNascimento) {
    const nasc = new Date(dataNascimento);
    if (isNaN(nasc.getTime())) return null;
    const hoje = new Date();
    return (
      (hoje.getFullYear() - nasc.getFullYear()) * 12 +
      (hoje.getMonth() - nasc.getMonth())
    );
  }
  if (idadeAnos && Number(idadeAnos) > 0) {
    return Number(idadeAnos) * 12;
  }
  return null;
};

/** Categorias NRC disponíveis por sexo e idade */
const getCategoriasDisponiveis = (
  sexo: string,
  dataNascimento: string,
  idadeAnos: string,
): string[] => {
  const meses = calcularIdadeEmMeses(dataNascimento, idadeAnos);

  // ≤ 24 meses → apenas Potros em Crescimento (independe do sexo)
  if (meses !== null && meses <= 24) {
    return ['Potros em Crescimento'];
  }

  if (sexo === 'Fêmea') {
    return ['Adulto - Manutenção', 'Trabalhando', 'Éguas Prenhas', 'Éguas em Lactação'];
  }
  if (sexo === 'Macho') {
    return ['Adulto - Manutenção', 'Trabalhando', 'Garanhões'];
  }
  return Object.keys(NRC_CATEGORIAS);
};

/** Tipos/estágios disponíveis — para Potros filtra por faixa etária */
const getTiposDisponiveis = (
  categoria: string,
  dataNascimento: string,
  idadeAnos: string,
): string[] => {
  if (categoria !== 'Potros em Crescimento') {
    return NRC_CATEGORIAS[categoria] ?? [];
  }

  const meses = calcularIdadeEmMeses(dataNascimento, idadeAnos);

  if (meses === null) return NRC_CATEGORIAS['Potros em Crescimento'];

  if (meses < 18) {
    return ['4 Meses', '6 Meses', '12 Meses'];
  }
  if (meses < 24) {
    return [
      '18 Meses',
      '18 Meses Exercício Leve',
      '18 Meses Exercício Moderado',
    ];
  }
  // >= 24 meses
  return [
    '24 Meses',
    '24 Meses Exercício Leve',
    '24 Meses Exercício Moderado',
    '24 Meses Exercício Pesado',
    '24 Meses Exercício Muito Pesado',
  ];
};

// -------------------------------------------------------------------
// Componente
// -------------------------------------------------------------------
const Animal = () => {
  const { refreshSelectedAnimal } = useSelectedAnimal();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile]   = useState<File | null>(null);
  const [especies, setEspecies]     = useState<{ id: number; nome: string }[]>([]);
  const [todasRacas, setTodasRacas] = useState<{ id: number; nome: string; especieId: number }[]>([]);
  const [racasFiltradas, setRacasFiltradas] = useState<{ id: number; nome: string }[]>([]);

  const [formData, setFormData] = useState<FormData>({
    nome: '',
    especieId: 1,
    racaId: null,
    peso: '',
    dataNascimento: '',
    idadeAnos: '',
    sexo: 'Macho',
    categoriaAnimal: '',
    tipoExercicio: '',
    veterinarioNome: '',
    veterinarioClinica: '',
  });

  // -------------------------------------------------------------------
  // Computados
  // -------------------------------------------------------------------
  const especieAtual = especies.find((esp) => esp.id === formData.especieId);
  const isEquino =
    !!especieAtual &&
    (especieAtual.nome.toLowerCase().includes('equino') ||
      especieAtual.nome.toLowerCase().includes('cavalo'));

  const categoriasDisponiveis = useMemo(
    () => getCategoriasDisponiveis(formData.sexo, formData.dataNascimento, formData.idadeAnos),
    [formData.sexo, formData.dataNascimento, formData.idadeAnos],
  );

  const tiposDisponiveis: string[] = useMemo(
    () => formData.categoriaAnimal
      ? getTiposDisponiveis(formData.categoriaAnimal, formData.dataNascimento, formData.idadeAnos)
      : [],
    [formData.categoriaAnimal, formData.dataNascimento, formData.idadeAnos],
  );

  const temIdadeOuData = !!formData.dataNascimento || !!formData.idadeAnos;

  // -------------------------------------------------------------------
  // Efeitos de limpeza
  // -------------------------------------------------------------------

  // Limpa NRC quando não é equino
  useEffect(() => {
    if (!isEquino && (formData.categoriaAnimal || formData.tipoExercicio)) {
      setFormData((prev) => ({ ...prev, categoriaAnimal: '', tipoExercicio: '' }));
    }
  }, [isEquino]);

  // Limpa categoria/tipo quando ficam indisponíveis
  useEffect(() => {
    if (formData.categoriaAnimal && !categoriasDisponiveis.includes(formData.categoriaAnimal)) {
      setFormData((prev) => ({ ...prev, categoriaAnimal: '', tipoExercicio: '' }));
      return;
    }
    if (formData.tipoExercicio && !tiposDisponiveis.includes(formData.tipoExercicio)) {
      setFormData((prev) => ({ ...prev, tipoExercicio: '' }));
    }
  }, [categoriasDisponiveis, tiposDisponiveis]);

  // Filtra raças quando a espécie muda
  useEffect(() => {
    if (formData.especieId && todasRacas.length > 0) {
      const filtradas = todasRacas.filter((r) => r.especieId === formData.especieId);
      setRacasFiltradas(filtradas);
      setFormData((prev) => {
        if (!prev.racaId || !filtradas.some((r) => r.id === prev.racaId)) {
          return { ...prev, racaId: filtradas[0]?.id ?? null };
        }
        return prev;
      });
    }
  }, [formData.especieId, todasRacas]);

  // -------------------------------------------------------------------
  // Carregamento inicial
  // -------------------------------------------------------------------
  useEffect(() => {
    const loadData = async () => {
      try {
        const [espRes, racRes] = await Promise.all([
          api.get('/especies'),
          api.get('/racas'),
        ]);

        const especiesData = espRes.data?.dados ?? espRes.data ?? [];
        const racasData   = racRes.data?.dados  ?? racRes.data  ?? [];
        setEspecies(especiesData);
        setTodasRacas(racasData);

        if (isEditMode && id) {
          const animalRes = await api.get(`/animais/${id}`);
          const animal = animalRes.data?.dados ?? animalRes.data;

          setFormData({
            nome:               animal.nome               ?? '',
            especieId:          animal.especieId          ?? 1,
            racaId:             animal.racaId             ?? null,
            peso:               animal.peso?.toString()   ?? '',
            dataNascimento:     animal.dataNascimento ? animal.dataNascimento.split('T')[0] : '',
            idadeAnos:          animal.idadeAnos ? String(animal.idadeAnos) : '',
            sexo:               animal.sexo               ?? 'Macho',
            categoriaAnimal:    animal.categoriaAnimal    ?? '',
            tipoExercicio:      animal.tipoExercicio      ?? '',
            veterinarioNome:    animal.veterinarioNome    ?? '',
            veterinarioClinica: animal.veterinarioClinica ?? '',
          });

          if (animal.photoUrl) setPhotoPreview(animal.photoUrl);
        }
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
        toast.error('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, isEditMode]);

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDateTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(0, 2) + '/' + val.slice(2);
    if (val.length > 5) val = val.slice(0, 5) + '/' + val.slice(5);
    val = val.slice(0, 10);

    const parts = val.split('/');
    if (parts.length === 3 && parts[2].length === 4) {
      const dia = parseInt(parts[0]);
      const mes = parseInt(parts[1]);
      const ano = parseInt(parts[2]);
      const dataObj = new Date(ano, mes - 1, dia);
      const dataValida =
        dataObj.getFullYear() === ano &&
        dataObj.getMonth() === mes - 1 &&
        dataObj.getDate() === dia;

      if (!dataValida) {
        toast.error('Data inválida. Verifique o dia, mês e ano informados.');
        setFormData((prev) => ({ ...prev, dataNascimento: '' }));
        return;
      }
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      if (dataObj > hoje) {
        toast.error('A data de nascimento não pode ser uma data futura.');
        setFormData((prev) => ({ ...prev, dataNascimento: '' }));
        return;
      }
      setFormData((prev) => ({
        ...prev,
        dataNascimento: `${parts[2]}-${parts[1]}-${parts[0]}`,
        idadeAnos: '',
      }));
    } else {
      setFormData((prev) => ({ ...prev, dataNascimento: val }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (!formData.nome?.trim()) {
      toast.error('Nome do animal é obrigatório');
      setSubmitting(false);
      return;
    }
    if (!formData.racaId) {
      toast.error('Raça é obrigatória');
      setSubmitting(false);
      return;
    }
    if (!formData.dataNascimento && !formData.idadeAnos) {
      toast.error('Informe a data de nascimento ou a idade do animal');
      setSubmitting(false);
      return;
    }
    if (formData.peso && Number(formData.peso) <= 0) {
      toast.error('O peso deve ser um valor positivo');
      setSubmitting(false);
      return;
    }
    if (formData.idadeAnos && Number(formData.idadeAnos) <= 0) {
      toast.error('A idade deve ser um valor positivo');
      setSubmitting(false);
      return;
    }
    if (isEquino && (!formData.categoriaAnimal || !formData.tipoExercicio)) {
      toast.error('Categoria e tipo de exercício são obrigatórios para equinos');
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        nome:               formData.nome.trim(),
        especieId:          formData.especieId,
        racaId:             formData.racaId,
        peso:               parseFloat(formData.peso) || 0,
        dataNascimento:     formData.dataNascimento || null,
        idadeAnos:          formData.dataNascimento ? null : (Number(formData.idadeAnos) || null),
        sexo:               formData.sexo,
        categoriaAnimal:    isEquino ? formData.categoriaAnimal : null,
        tipoExercicio:      isEquino ? formData.tipoExercicio   : null,
        veterinarioNome:    formData.veterinarioNome    || null,
        veterinarioClinica: formData.veterinarioClinica || null,
      };

      if (photoFile) {
        const fd = new FormData();
        fd.append('nome',               payload.nome);
        fd.append('especieId',          String(payload.especieId));
        fd.append('racaId',             String(payload.racaId));
        fd.append('peso',               String(payload.peso));
        fd.append('dataNascimento',     payload.dataNascimento     ?? '');
        fd.append('idadeAnos',          payload.idadeAnos != null ? String(payload.idadeAnos) : '');
        fd.append('sexo',               payload.sexo);
        fd.append('categoriaAnimal',    payload.categoriaAnimal    ?? '');
        fd.append('tipoExercicio',      payload.tipoExercicio      ?? '');
        fd.append('veterinarioNome',    payload.veterinarioNome    ?? '');
        fd.append('veterinarioClinica', payload.veterinarioClinica ?? '');
        fd.append('foto', photoFile);

        const config = { headers: { 'Content-Type': 'multipart/form-data' } };
        if (isEditMode) await api.put(`/animais/${id}`, fd, config);
        else            await api.post('/animais', fd, config);
      } else {
        if (isEditMode) await api.put(`/animais/${id}`, payload);
        else            await api.post('/animais', payload);
      }

      toast.success(isEditMode ? 'Animal atualizado com sucesso!' : 'Animal cadastrado com sucesso!');
      await refreshSelectedAnimal();
      navigate('/meus-animais');
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { mensagem?: string } } })
          .response?.data?.mensagem ?? 'Erro ao salvar animal';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white shadow-2xl rounded-3xl p-4 md:p-8 border border-gray-100">

          {/* Voltar */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate('/meus-animais')}
              className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ArrowLeft size={20} />
              <span className="text-base md:text-lg">Voltar</span>
            </button>
          </div>

          {/* Foto + Nome */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <label className="cursor-pointer group flex-shrink-0 self-center sm:self-start">
              <div className="w-28 h-28 sm:w-40 sm:h-40 rounded-3xl border-4 border-emerald-600 overflow-hidden bg-gray-100 shadow-inner transition-all group-hover:scale-105">
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
            <div className="flex-1 pt-2 sm:pt-4">
              <input
                type="text"
                required
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                className="w-full text-2xl sm:text-4xl font-bold text-gray-900 focus:outline-none border-b border-transparent focus:border-emerald-600"
                placeholder="Nome do Animal"
              />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Espécie + Sexo */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                <select
                  value={formData.especieId}
                  onChange={(e) =>
                    setFormData({ ...formData, especieId: parseInt(e.target.value), racaId: null })
                  }
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                >
                  {especies.map((esp) => (
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

            {/* Raça + Peso */}
            <div className="grid grid-cols-2 gap-4">
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
                  <option value="">Selecione</option>
                  {racasFiltradas.map((raca) => (
                    <option key={raca.id} value={raca.id}>{raca.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Peso (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  required
                  placeholder="Ex: 450"
                  value={formData.peso}
                  onChange={(e) => setFormData({ ...formData, peso: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                />
              </div>
            </div>

            {/* Idade + Data de Nascimento */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Idade (anos)
                  {!temIdadeOuData && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Ex: 5"
                  value={formData.idadeAnos}
                  disabled={!!formData.dataNascimento}
                  onChange={(e) => setFormData({ ...formData, idadeAnos: e.target.value })}
                  className={`w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 ${
                    formData.dataNascimento ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''
                  }`}
                />
                {formData.dataNascimento && (
                  <p className="text-xs text-gray-400 mt-1">Calculada pela data</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nascimento
                  {!temIdadeOuData && <span className="text-red-500 ml-1">*</span>}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="dd/mm/aaaa"
                    autoComplete="off"
                    value={
                      formData.dataNascimento
                        ? formData.dataNascimento.split('-').reverse().join('/')
                        : ''
                    }
                    onChange={handleDateTextChange}
                    className="w-full border border-gray-300 rounded-2xl px-4 py-3 pr-10 text-gray-900"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center">
                    <Calendar size={18} className="text-emerald-600 pointer-events-none" />
                    <input
                      type="date"
                      max={new Date().toISOString().split('T')[0]}
                      value={formData.dataNascimento?.includes('-') ? formData.dataNascimento : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        setFormData({ ...formData, dataNascimento: val, idadeAnos: '' });
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </div>
                </div>
                {formData.dataNascimento && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, dataNascimento: '' })}
                    className="mt-1 text-xs text-gray-400 hover:text-red-500 underline"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {/* Perfil NRC — apenas equinos */}
            {isEquino && (
              <>
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-sm font-semibold text-gray-600 mb-1">Perfil NRC</p>
                  {!temIdadeOuData && (
                    <p className="text-xs text-amber-600">
                      Informe a idade ou data de nascimento para ver as categorias disponíveis.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categoria <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.categoriaAnimal}
                    onChange={(e) =>
                      setFormData({ ...formData, categoriaAnimal: e.target.value, tipoExercicio: '' })
                    }
                    required
                    disabled={!temIdadeOuData}
                    className={`w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900 ${
                      !temIdadeOuData ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="">Selecione a categoria</option>
                    {categoriasDisponiveis.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {formData.categoriaAnimal && tiposDisponiveis.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tipo / Estágio <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.tipoExercicio}
                      onChange={(e) => setFormData({ ...formData, tipoExercicio: e.target.value })}
                      required
                      className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                    >
                      <option value="">Selecione o tipo</option>
                      {tiposDisponiveis.map((tipo) => (
                        <option key={tipo} value={tipo}>{tipo}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Veterinário */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-600 mb-3">Veterinário Responsável</p>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Nome do veterinário (opcional)"
                  value={formData.veterinarioNome}
                  onChange={(e) => setFormData({ ...formData, veterinarioNome: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                />
                <input
                  type="text"
                  placeholder="Clínica / Hospital (opcional)"
                  value={formData.veterinarioClinica}
                  onChange={(e) => setFormData({ ...formData, veterinarioClinica: e.target.value })}
                  className="w-full border border-gray-300 rounded-2xl px-4 py-3 text-gray-900"
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white py-3.5 rounded-2xl font-semibold text-base md:text-lg transition-colors"
            >
              {submitting
                ? isEditMode ? 'Atualizando...' : 'Cadastrando...'
                : isEditMode ? 'Atualizar Animal' : 'Cadastrar Animal'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Animal;