// backend/src/lib/transferenciaPropriedadeAnimal.js
//
// Transferência de Propriedade do animal — GESTOR/ADMIN troca o dono de um
// paciente já cadastrado (Doação/Venda/Aluguel), a partir da tela do animal.
//
// Resolve/cria o NOVO proprietário seguindo o MESMO padrão que
// `AnimalController.criar` já usa para criar proprietário inline (busca por
// e-mail → cria se não existir, senha padrão + troca obrigatória, perfil da
// empresa via `lib/proprietarioPerfil.js` + `lib/usuarioEmpresa.js`) — sem chamar
// `ProprietarioController`, reaproveitando as mesmas primitivas que ele usa.
//
// O que muda no Animal é SÓ `userId` + `propriedadeDesde` — empresaId/equipeId,
// veterinarioNome/veterinarioClinica, localizacaoId etc. ficam intactos. É isso
// que garante "se o animal for do mesmo veterinário, o acesso dele não muda":
// nada relacionado a equipe/vet é tocado aqui.
'use strict';

const bcrypt = require('bcryptjs');
const { normalizeEmail, findUserByEmail } = require('./email');
const { garantirPerfil: garantirPerfilProprietario, salvarPerfil: salvarPerfilProprietario } = require('./proprietarioPerfil');
const { salvarVinculo } = require('./usuarioEmpresa');
const { salvarLocalidades, normalizarLocalidades } = require('./proprietarioLocalidades');
const { registrarTransferenciaPropriedade } = require('./auditoria');

const SENHA_PADRAO_INICIAL = 'Inicial_001';

/**
 * Resolve o novo proprietário (encontra por e-mail ou cria) e o vincula à
 * empresa do animal — mesma forma que `ProprietarioController.criar` grava.
 */
async function resolverOuCriarProprietario(tx, req, { empresaId, equipeId, dados }) {
  const email = normalizeEmail(dados.email);
  let user = await findUserByEmail(tx, email);
  let isNovoUsuario = false;

  if (!user) {
    user = await tx.user.create({
      data: {
        fullName:           dados.fullName.trim(),
        email,
        phone:              dados.phone  || null,
        phone2:             dados.phone2 || null,
        passwordHash:       await bcrypt.hash(SENHA_PADRAO_INICIAL, 10),
        role:               'USER',
        userType:           'PROPRIETARIO',
        mustChangePassword: true,
        empresaId,
        equipeId,
      },
    });
    isNovoUsuario = true;
  }

  const dadosDaEmpresa = {
    fullName:          dados.fullName?.trim() || user.fullName || 'Proprietário',
    phone:             dados.phone  || null,
    phone2:            dados.phone2 || null,
    cep:               dados.cep               || null,
    endereco:          dados.endereco          || null,
    complemento:       dados.complemento       || null,
    bairro:            dados.bairro            || null,
    cidade:            dados.cidade            || null,
    estado:            dados.estado            || null,
    cpf:               dados.cpf               || null,
    cnpj:              dados.cnpj              || null,
    mensalista:        !!dados.mensalista,
    valorAssistencia:  dados.mensalista ? Number(dados.valorAssistencia) || 0 : null,
    frequenciaVisitas: dados.frequenciaVisitas != null ? Number(dados.frequenciaVisitas) : null,
    diaVencimentoFatura: Number(dados.diaVencimentoFatura),
    ativo: true,
  };

  await garantirPerfilProprietario(tx, user.id, empresaId, dadosDaEmpresa);
  await salvarPerfilProprietario(tx, user.id, empresaId, dadosDaEmpresa);
  await salvarVinculo(tx, user.id, empresaId, { perfil: 'PROPRIETARIO', ...dadosDaEmpresa });

  const { localidades } = normalizarLocalidades(dados.localidades);
  await salvarLocalidades(tx, user.id, empresaId, localidades);

  return { userId: user.id, isNovoUsuario, nome: dadosDaEmpresa.fullName, email };
}

/**
 * Transfere a propriedade de `animal` para o proprietário descrito em
 * `novoProprietario`, dentro da transaction `tx`. Fecha a janela de posse atual,
 * abre a próxima, atualiza `Animal.userId`/`propriedadeDesde` e registra a
 * auditoria — tudo atômico.
 *
 * @param {object} params { animal, motivo, novoProprietario }
 *   `animal` é o registro carregado (precisa de id, userId, empresaId, equipeId).
 *   `motivo` ∈ {DOACAO, VENDA, ALUGUEL} (já validado pelo controller).
 */
async function transferirPropriedadeAnimal(tx, req, { animal, motivo, novoProprietario }) {
  const proprietarioAnteriorId = animal.userId;

  const { userId: novoProprietarioId, isNovoUsuario, nome, email } = await resolverOuCriarProprietario(tx, req, {
    empresaId: animal.empresaId,
    equipeId:  req.equipeId ?? animal.equipeId ?? null,
    dados:     novoProprietario,
  });

  const agora = new Date();

  // Fecha a janela de posse ATUAL...
  await tx.animalProprietarioHistorico.updateMany({
    where: { animalId: animal.id, dataFim: null },
    data:  { dataFim: agora, motivoTransferencia: motivo },
  });

  // ...e abre a próxima, já do novo dono.
  await tx.animalProprietarioHistorico.create({
    data: {
      animalId:       animal.id,
      proprietarioId: novoProprietarioId,
      dataInicio:     agora,
      empresaId:      animal.empresaId,
      criadoPorId:    req.user?.id ?? null,
    },
  });

  await tx.animal.update({
    where: { id: animal.id },
    data:  { userId: novoProprietarioId, propriedadeDesde: agora },
  });

  await registrarTransferenciaPropriedade(tx, req, {
    animalId: animal.id,
    deProprietarioId: proprietarioAnteriorId,
    paraProprietarioId: novoProprietarioId,
    motivo,
  });

  return { novoProprietarioId, isNovoUsuario, nomeNovoProprietario: nome, emailNovoProprietario: email };
}

module.exports = { transferirPropriedadeAnimal, SENHA_PADRAO_INICIAL };
