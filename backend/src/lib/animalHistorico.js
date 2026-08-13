// backend/src/lib/animalHistorico.js
//
// Histórico de PESO, LOCALIZAÇÃO e BAIA do animal (tb_animal_historico) — um
// snapshot por alteração, chamado por AnimalController.criar/atualizar logo após
// gravar o animal. Alimenta o gráfico de peso e a linha do tempo de local/baia em
// AnimalDetail (GraficosAnimalController).
'use strict';

/**
 * Grava um snapshot quando peso, localizacaoId, local OU baia mudou em relação ao
 * estado anterior. `antes: null` (cadastro novo) sempre grava o ponto de partida.
 * Nunca lança — uma falha aqui não pode derrubar o cadastro/edição do animal.
 */
async function registrarHistoricoAnimal(client, { animalId, antes, depois, criadoPorId }) {
  const pesoAntes  = antes ? Number(antes.peso ?? 0) : null;
  const pesoDepois = Number(depois.peso ?? 0);
  const mudou = !antes
    || pesoAntes !== pesoDepois
    || (antes.localizacaoId ?? null) !== (depois.localizacaoId ?? null)
    || (antes.local ?? null)         !== (depois.local ?? null)
    || (antes.baia ?? null)          !== (depois.baia ?? null);
  if (!mudou) return;

  try {
    await client.animalHistorico.create({
      data: {
        animalId,
        peso:          depois.peso ?? null,
        localizacaoId: depois.localizacaoId ?? null,
        local:         depois.local ?? null,
        baia:          depois.baia ?? null,
        criadoPorId:   criadoPorId ?? null,
      },
    });
  } catch (err) {
    console.error('[animalHistorico] falha ao registrar snapshot:', err.message);
  }
}

module.exports = { registrarHistoricoAnimal };
