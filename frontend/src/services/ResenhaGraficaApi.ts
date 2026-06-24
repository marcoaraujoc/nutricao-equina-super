// src/services/ResenhaGraficaApi.ts

import api from './api';
import type {
  ResenhaGraficaResponse,
  TracoResenha,
  VistaResenha,
  MarcacaoResumo,
} from '../types/resenhaGrafica';

interface RespostaPadrao<T> {
  sucesso: boolean;
  dados: T;
  mensagem: string;
}

export async function buscarResenhaPorVista(
  animalId: number,
  vista: VistaResenha,
): Promise<ResenhaGraficaResponse> {
  const { data } = await api.get<RespostaPadrao<ResenhaGraficaResponse>>(
    `/animais/${animalId}/resenha/${vista}`,
  );
  return data.dados;
}

export async function salvarResenhaPorVista(
  animalId: number,
  vista: VistaResenha,
  vetorTracos: TracoResenha[],
  snapshotPng: string | null,
): Promise<void> {
  await api.put<RespostaPadrao<unknown>>(`/animais/${animalId}/resenha/${vista}`, {
    vetorTracos,
    snapshotPng,
  });
}

export async function listarMarcacoesDoAnimal(animalId: number): Promise<MarcacaoResumo[]> {
  const { data } = await api.get<RespostaPadrao<MarcacaoResumo[]>>(
    `/animais/${animalId}/resenha/marcacoes`,
  );
  return data.dados;
}
