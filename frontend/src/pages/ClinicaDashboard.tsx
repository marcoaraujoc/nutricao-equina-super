// frontend/src/pages/ClinicaDashboard.tsx

import { useNavigate } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { FileText, Pill, Syringe, FlaskConical, Share2, Stethoscope } from 'lucide-react';

const MODULOS = [
  {
    key:      'evolucao',
    label:    'Evolução',
    descricao: 'Registro e acompanhamento de evoluções clínicas',
    icon:     FileText,
    cor:      'bg-blue-50 text-blue-600 border-blue-100',
  },
  {
    key:      'prescricao',
    label:    'Prescrição',
    descricao: 'Prescrições de medicamentos e protocolos terapêuticos',
    icon:     Pill,
    cor:      'bg-emerald-50 text-emerald-600 border-emerald-100',
  },
  {
    key:      'vacina',
    label:    'Vacinas',
    descricao: 'Aplicação e controle do calendário vacinal',
    icon:     Syringe,
    cor:      'bg-teal-50 text-teal-600 border-teal-100',
  },
  {
    key:      'exames',
    label:    'Exames',
    descricao: 'Solicitação e visualização de resultados de exames',
    icon:     FlaskConical,
    cor:      'bg-purple-50 text-purple-600 border-purple-100',
  },
  {
    key:      'encaminhamento',
    label:    'Encaminhamentos',
    descricao: 'Encaminhamentos para especialistas e outras clínicas',
    icon:     Share2,
    cor:      'bg-orange-50 text-orange-600 border-orange-100',
  },
] as const;

export default function ClinicaDashboard() {
  const navigate           = useNavigate();
  const { selectedAnimal } = useSelectedAnimal();

  const navegar = (modulo: string) => {
    const id = selectedAnimal?.id;
    navigate(id ? `/clinica/${modulo}/${id}` : `/clinica/${modulo}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-4xl mx-auto px-4 pt-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Stethoscope size={22} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Módulo Clínico</h1>
            <p className="text-sm text-gray-500">Gestão clínica integrada dos pacientes</p>
          </div>
        </div>

        {selectedAnimal && (
          <div className="mt-3 mb-8 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-xl">
            <span className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span className="text-xs text-emerald-700 font-medium">
              Paciente selecionado: {selectedAnimal.nome}
            </span>
          </div>
        )}

        {!selectedAnimal && (
          <div className="mt-3 mb-8 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-xl">
            <span className="text-xs text-amber-700 font-medium">
              Selecione um animal no menu lateral para acesso rápido
            </span>
          </div>
        )}

        {/* Cards de sub-módulos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULOS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => navegar(m.key)}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-left hover:shadow-md hover:border-emerald-200 transition-all group"
              >
                <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-4 ${m.cor}`}>
                  <Icon size={22} />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-emerald-700 transition-colors">
                  {m.label}
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed">{m.descricao}</p>
              </button>
            );
          })}
        </div>

      </div>
    </div>
  );
}