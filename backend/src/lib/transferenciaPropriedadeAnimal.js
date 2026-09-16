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
const { gerarSenhaInicial } = require('./senhaInicial');

// ⚠️ A senha inicial deixou de ser CONSTANTE (2026-09-08) — ver `lib/senhaInicial.js`.
// A exportação FICA porque há chamador externo; hoje ela só descreve a regra.
const SENHA_PADRAO_INICIAL = 'derivada do cadastro — ver lib/senhaInicial.js';

/**
 * Resolve o novo proprietário (encontra por e-mail ou cria) e o vincula à
 * empresa do animal — mesma forma que `ProprietarioController.criar` grava.
 */
async function resolverOuCriarProprietario(tx, req, { empresaId, equipeId, dados }) {
  const email = normalizeEmail(dados.email);
  let user = await findUserByEmail(tx, email);
  let isNovoUsuario = false;

  // 🔴 A SENHA É CALCULADA UMA VEZ E DEVOLVIDA (2026-09-15): o novo proprietário
  // criado aqui não recebia credencial nenhuma — o e-mail de transferência só
  // avisava do animal, e a pessoa ficava com uma conta que não sabia abrir.
  // ⚠️ Recalculá-la no controller produziria outra senha se qualquer dado divergisse
  // (foi o defeito do cadastro de paciente, corrigido na mesma data). Por isso ela
  // sobe junto com o resultado, e não é recomposta em lugar nenhum.
  let senhaInicial = null;

  if (!user) {
    senhaInicial = gerarSenhaInicial({ email, nome: dados.fullName, telefone: dados.phone });
    user = await tx.user.create({
      data: {
        fullName:           dados.fullName.trim(),
        email,
        phone:              dados.phone  || null,
        phone2:             dados.phone2 || null,
        passwordHash:       await bcrypt.hash(senhaInicial, 10),
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

  return { userId: user.id, isNovoUsuario, nome: dadosDaEmpresa.fullName, email, senhaInicial };
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

  const { userId: novoProprietarioId, isNovoUsuario, nome, email, senhaInicial } = await resolverOuCriarProprietario(tx, req, {
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

  return { novoProprietarioId, isNovoUsuario, nomeNovoProprietario: nome, emailNovoProprietario: email, senhaInicial };
}

module.exports = { transferirPropriedadeAnimal, SENHA_PADRAO_INICIAL };
