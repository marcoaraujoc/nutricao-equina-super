import { useNavigate, useLocation } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import SeletorAnimalInteligente from './SeletorAnimalInteligente';

interface AnimalOpcao {
  id:              number;
  nome:            string;
  photoUrl?:       string | null;
  dataNascimento?: string | null;
  idadeAnos?:      number | null;
  raca?:           { nome: string } | null;
  especie?:        { nome: string } | null;
  user?:           { id?: number; fullName: string; email: string } | null;
  /** Paciente INATIVO (somente leitura) — continua na lista, mas marcado. */
  inativo?:        boolean | null;
}

interface SeletorAnimalProps {
  animais:         AnimalOpcao[];
  animalIdAtual?:  string | number | null;
  rotaBase:        string;
  className?:      string;
}

function toAnimal(a: AnimalOpcao) {
  return {
    id:             a.id,
    nome:           a.nome,
    photoUrl:       a.photoUrl       ?? undefined,
    dataNascimento: a.dataNascimento ?? undefined,
    idadeAnos:      a.idadeAnos      ?? undefined,
    raca:           a.raca           ?? undefined,
    especie:        a.especie        ?? undefined,
    user:           a.user           ?? undefined,
  };
}

export default function SeletorAnimal({
  animais,
  animalIdAtual,
  rotaBase,
  className = '',
}: SeletorAnimalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedAnimal } = useSelectedAnimal();

  const currentId = animalIdAtual ? String(animalIdAtual) : '';

  if (animais.length <= 1) return null;

  const atual = animais.find(a => String(a.id) === currentId) ?? null;

  const escolher = (a: AnimalOpcao) => {
    setSelectedAnimal(toAnimal(a));
    // Preserva a query atual (ex.: ?tipo=laboratorial em Resultado de Exame)
    navigate(`${rotaBase}/${a.id}${location.search}`);
  };

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
      {/* 🔴 DIGITAR O NOME, em vez de rolar a lista (a pedido, 2026-09-08).
          Este componente era um `<select>` puro, e por isso as telas que o usam
          (Dieta, Resultado de Exame, Relatório Nutricional) obrigavam a percorrer
          centenas de pacientes até achar "Zeus" — enquanto o Atendimento já resolvia
          em três letras.
          ⚠️ A troca é AQUI, no componente, e não em cada tela: é o que faz as três
          ganharem a busca de uma vez, e o que impede a próxima tela de nascer com o
          seletor antigo.
          ⚠️ O que este componente acrescenta ao combobox é a NAVEGAÇÃO (ele leva para
          `rotaBase/:id` preservando a query) e o `SelectedAnimalContext`. O combobox
          não sabe nada disso, e não deve saber — ele é a escolha, não o destino. */}
      <SeletorAnimalInteligente
        animais={animais}
        animalAtual={atual}
        onSelecionar={escolher}
      />
    </div>
  );
}
