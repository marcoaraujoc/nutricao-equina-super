// backend/src/services/nrcCalculatorEquino.js
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Motor de cálculo NRC 2007 — Equinos
//
// Fonte: Código-fonte oficial do programa NRC 2007
//        https://webassets.nationalacademies.org/nrh/
//        Função calcVals() extraída e portada para Node.js/CommonJS
//
// Validado contra o programa oficial:
//   ✓ 500 kg Manutenção Average → DE=16.65 CP=630 Ca=20 P=14 Mg=7.5 Thi=30
//   ✓ 370 kg Moderado → DE=17.25 CP=568 Ca=26 Mg=8.51 Thi=41.8 Ribo=16.6
//   ✓ 650 kg Leve → DE=25.97 CP=909 Ca=39 Mg=12.35
// ─────────────────────────────────────────────────────────────────────────────

const FONTE = 'NRC_2007_CALCULADO';

// ─── Aliases: chave NRC → lista de nomes normalizados no banco ────────────────
// A comparação é feita com .toLowerCase().trim().normalize('NFC')
// → inclua todas as variantes que podem existir no tb_nutrientes

const ALIASES = {
  DE:          ['energia digestível', 'energia digestivel', 'de', 'digestible energy', 'ed'],
  CP:          ['proteína bruta', 'proteina bruta', 'pb', 'cp', 'crude protein', 'proteína', 'proteina'],
  Lys:         ['lisina', 'lys', 'lysine'],
  Ca:          ['cálcio', 'calcio', 'ca', 'calcium'],
  P:           ['fósforo', 'fosforo', 'p', 'phosphorus'],
  Na:          ['sódio', 'sodio', 'na', 'sodium'],
  Cl:          ['cloro', 'cloreto', 'cl', 'chloride', 'chlorine'],
  K:           ['potássio', 'potassio', 'k', 'potassium'],
  Mg:          ['magnésio', 'magnesio', 'mg', 'magnesium'],
  S:           ['enxofre', 's', 'sulfur', 'sulphur'],
  Co:          ['cobalto', 'co', 'cobalt'],
  Cu:          ['cobre', 'cu', 'copper'],
  I:           ['iodo', 'i', 'iodine', 'iodeto'],
  Fe:          ['ferro', 'fe', 'iron'],
  Mn:          ['manganês', 'manganes', 'mn', 'manganese'],
  Zn:          ['zinco', 'zn', 'zinc'],
  Se:          ['selênio', 'selenio', 'se', 'selenium'],
  vitA:        ['vitamina a', 'vit a', 'vita', 'vitamin a', 'vit. a'],
  vitD:        ['vitamina d', 'vit d', 'vitd', 'vitamin d', 'vit. d'],
  vitE:        ['vitamina e', 'vit e', 'vite', 'vitamin e', 'vit. e'],
  tiamina:     ['tiamina', 'thiamin', 'thiamine', 'vitamina b1', 'vit b1', 'b1', 'thi'],
  riboflavina: ['riboflavina', 'riboflavin', 'vitamina b2', 'vit b2', 'b2', 'ribo'],
};

// Unidade que o NRC 2007 usa para cada nutriente
const UNIDADE_NRC = {
  DE: 'Mcal', CP: 'g', Lys: 'g',
  Ca: 'g', P: 'g', Na: 'g', Cl: 'g', K: 'g', Mg: 'g', S: 'g',
  Co: 'mg', Cu: 'mg', I: 'mg', Fe: 'mg', Mn: 'mg', Zn: 'mg', Se: 'mg',
  vitA: 'UI', vitD: 'UI', vitE: 'UI',
  tiamina: 'mg', riboflavina: 'mg',
};

// ─── Helpers de mapeamento ───────────────────────────────────────────────────

const r2 = (n) => Math.round((n || 0) * 100) / 100;

// ─── Mapeamento de categorias do sistema → tipo NRC ──────────────────────────
// Cobre todos os valores cadastrados nas telas de Animal:
//   Adulto - Manutenção | Trabalhando | Éguas Prenhas |
//   Éguas em Lactação   | Potros em Crescimento | Garanhões

const resolverAnimalType = (categoriaAnimal) => {
  const c = (categoriaAnimal || '').toLowerCase().normalize('NFC').trim();

  // Trabalhando / Trabalho / Em Trabalho / Working
  if (c.includes('trabalh') || c.includes('working')) return 'EXERCISE';

  // Éguas Prenhas / Gestante / Prenha / Pregnant
  if (c.includes('prenha') || c.includes('gestante') || c.includes('pregnant')) return 'PREGNANT';

  // Éguas em Lactação / Lactante / Lactating
  if (c.includes('lacta')) return 'LACTATING';

  // Potros em Crescimento / Crescimento / Growing
  if (c.includes('crescimento') || c.includes('potro') || c.includes('growing')) return 'GROWING';

  // Garanhões / Garanhão / Stallion
  if (c.includes('garanh') || c.includes('stallion')) return 'STALLION';

  // Adulto - Manutenção / Manutenção / Maintenance (default)
  return 'MAINTENANCE';
};

// ─── Mapeamento de tipo/estágio → parâmetros NRC ─────────────────────────────

const resolverWorkLoad = (tipoExercicio) => {
  const t = (tipoExercicio || '').toLowerCase().normalize('NFC').trim();
  // "Exercício Muito pesado" / "Muito Pesado" / "Intenso" / "Intense"
  if (t.includes('muito') || t.includes('intenso') || t.includes('intense')) return 4;
  // "Exercício Pesado" / "Pesado" / "Heavy"
  if (t.includes('pesado') || t.includes('heavy')) return 3;
  // "Exercício Moderado" / "Moderado" / "Moderate"
  if (t.includes('moderado') || t.includes('moderate')) return 2;
  // "Exercício Leve" / "Leve" / "Light" (default)
  return 1;
};

const resolverMaintLevel = (tipoExercicio) => {
  const t = (tipoExercicio || '').toLowerCase().normalize('NFC').trim();
  // Temperamento Calmo → Low (menos exigente)
  if (t.includes('calmo') || t.includes('low')) return 1;
  // Temperamento Nervoso → High (mais exigente)
  if (t.includes('nervoso') || t.includes('high')) return 3;
  // Temperamento Médio / Average → Average (default)
  return 2;
};

const resolverStallionLevel = (tipoExercicio) => {
  const t = (tipoExercicio || '').toLowerCase().normalize('NFC').trim();
  // "Em serviço" / "Breeding"
  if (t.includes('em servi') || t.includes('breeding')) return 1;
  // "Fora de serviço" / "Non-Breeding" (default)
  return 0;
};

const resolverMonthGest = (tipoExercicio) => {
  const t = (tipoExercicio || '').toLowerCase().normalize('NFC').trim();
  // "Menos de 5 Meses" / "Early" → mês 1 (< 5 = manutenção no NRC)
  if (t.includes('menos') || t.includes('early')) return 1;
  // "5 Meses", "6 Meses", ... "11 Meses"
  const match = t.match(/(\d+)\s*mes/);
  if (match) return Math.min(11, Math.max(1, parseInt(match[1])));
  return 1;
};

const resolverMonthLact = (tipoExercicio) => {
  const t = (tipoExercicio || '').toLowerCase().normalize('NFC').trim();
  // "1 mês", "2 Meses", ... "6 Meses"
  const match = t.match(/(\d+)/);
  if (match) return Math.min(6, Math.max(1, parseInt(match[1])));
  return 1;
};

const resolverAgeMeses = (tipoExercicio, dataNascimento) => {
  const t = (tipoExercicio || '').toLowerCase().normalize('NFC').trim();
  // "4 Meses", "6 Meses", "12 Meses"
  const match = t.match(/(\d+)/);
  if (match) return Math.min(26, Math.max(1, parseInt(match[1])));
  // fallback: calcular pela data de nascimento
  if (!dataNascimento) return 12;
  const nasc = new Date(dataNascimento);
  const hoje = new Date();
  const meses = (hoje.getFullYear() - nasc.getFullYear()) * 12
    + (hoje.getMonth() - nasc.getMonth());
  return Math.max(1, Math.min(26, meses));
};

// ─── Motor de cálculo — fiel ao calcVals() do programa oficial NRC 2007 ─────

const calcNRC = (params) => {
  const {
    animalType,
    matureWeight,
    intakeLevel  = 2.0,
    maintLevel   = 2,    // 1=Low 2=Average 3=High
    stallionLevel = 0,   // 0=Non-Breeding 1=Breeding
    workLoad     = 1,    // 1=Light 2=Moderate 3=Heavy 4=Intense
    workLoadGrow = 0,
    monthOfGest  = 0,
    monthOfLact  = 1,
    age          = 24,   // meses (GROWING)
  } = params;

  let BodyWeight, DM_req, SweatLoss = 0;
  let DE_req=0, CP_req=0, LYS_req=0, Ca_req=0, P_req=0;
  let Mg_req=0, K_req=0, Na_req=0, Cl_req=0, S_req=0;
  let Co_req=0, Cu_req=0, I_req=0, Fe_req=0, Mn_req=0, Zn_req=0, Se_req=0;
  let VitA_req=0, VitD_req=0, VitE_req=0, Thi_req=0, Ribo_req=0;

  switch (animalType) {

    // ── Manutenção ─────────────────────────────────────────────────────────
    case 'MAINTENANCE':
      BodyWeight = matureWeight;
      DM_req = (intakeLevel / 100) * BodyWeight;
      if (maintLevel === 1) { DE_req = 0.0303 * BodyWeight; CP_req = 1.08 * BodyWeight; }
      if (maintLevel === 2) { DE_req = 0.0333 * BodyWeight; CP_req = 1.26 * BodyWeight; }
      if (maintLevel === 3) { DE_req = 0.0363 * BodyWeight; CP_req = 1.44 * BodyWeight; }
      LYS_req = 0.043 * CP_req;
      Ca_req = 0.04 * BodyWeight;  P_req = 0.028 * BodyWeight;
      Mg_req = 0.015 * BodyWeight; K_req = 0.05 * BodyWeight;
      Na_req = 0.02 * BodyWeight;  Cl_req = 0.08 * BodyWeight;
      S_req  = 1.5  * DM_req;  Co_req = 0.05 * DM_req;
      Cu_req = 0.2  * BodyWeight; I_req = 0.35 * DM_req;
      Fe_req = 40   * DM_req;  Mn_req = 40  * DM_req;
      Zn_req = 40   * DM_req;  Se_req = 0.1 * DM_req;
      VitA_req = 30  * BodyWeight; VitD_req = 6.6 * BodyWeight;
      VitE_req = 1.0 * BodyWeight;
      Thi_req  = 0.06 * BodyWeight; Ribo_req = 0.04 * BodyWeight;
      break;

    // ── Trabalho / Exercício ───────────────────────────────────────────────
    case 'EXERCISE':
      BodyWeight = matureWeight;
      DM_req = (intakeLevel / 100) * BodyWeight;
      if (workLoad === 1) { // Light
        SweatLoss = 0.0025 * BodyWeight;
        DE_req = 0.0333 * BodyWeight * 1.2;
        CP_req = 1.26 * BodyWeight + 0.089 * BodyWeight + SweatLoss * 7.8 * 2.0 / 0.79;
        Ca_req = 0.06 * BodyWeight;  P_req = 0.036 * BodyWeight;
        Mg_req = 0.019 * BodyWeight; VitE_req = 1.6 * BodyWeight;
        Thi_req = 0.06 * BodyWeight; Ribo_req = 0.04 * BodyWeight;
      }
      if (workLoad === 2) { // Moderate
        SweatLoss = 0.005 * BodyWeight;
        DE_req = 0.0333 * BodyWeight * 1.4;
        CP_req = 1.26 * BodyWeight + 0.177 * BodyWeight + SweatLoss * 7.8 * 2.0 / 0.79;
        Ca_req = 0.07 * BodyWeight;  P_req = 0.042 * BodyWeight;
        Mg_req = 0.023 * BodyWeight; VitE_req = 1.8 * BodyWeight;
        Thi_req = 0.113 * BodyWeight; Ribo_req = 0.045 * BodyWeight;
      }
      if (workLoad === 3) { // Heavy
        SweatLoss = 0.01 * BodyWeight;
        DE_req = 0.0333 * BodyWeight * 1.6;
        CP_req = 1.26 * BodyWeight + 0.266 * BodyWeight + SweatLoss * 7.8 * 2.0 / 0.79;
        Ca_req = 0.08 * BodyWeight;  P_req = 0.058 * BodyWeight;
        Mg_req = 0.03 * BodyWeight;  VitE_req = 2.0 * BodyWeight;
        Thi_req = 0.125 * BodyWeight; Ribo_req = 0.05 * BodyWeight;
      }
      if (workLoad === 4) { // Intense (Very Heavy)
        SweatLoss = 0.02 * BodyWeight;
        DE_req = 0.0363 * BodyWeight * 1.9;
        CP_req = 1.26 * BodyWeight + 0.354 * BodyWeight + SweatLoss * 7.8 * 2.0 / 0.79;
        Ca_req = 0.08 * BodyWeight;  P_req = 0.058 * BodyWeight;
        Mg_req = 0.03 * BodyWeight;  VitE_req = 2.0 * BodyWeight;
        Thi_req = 0.125 * BodyWeight; Ribo_req = 0.05 * BodyWeight;
      }
      LYS_req = 0.043 * CP_req;
      K_req  = 0.05 * BodyWeight + 2.8 * SweatLoss;
      Na_req = 0.02 * BodyWeight + 3.1 * SweatLoss;
      Cl_req = 0.08 * BodyWeight + 5.3 * SweatLoss;
      S_req  = 1.5  * DM_req; Co_req = 0.05 * DM_req;
      Cu_req = 10.0 * DM_req; I_req  = 0.35 * DM_req;
      Fe_req = 40   * DM_req; Mn_req = 40   * DM_req;
      Zn_req = 40   * DM_req; Se_req = 0.1  * DM_req;
      VitA_req = 45  * BodyWeight; VitD_req = 6.6 * BodyWeight;
      break;

    // ── Garanhão ───────────────────────────────────────────────────────────
    case 'STALLION':
      BodyWeight = matureWeight;
      DM_req = (intakeLevel / 100) * BodyWeight;
      if (stallionLevel === 0) { // Non-Breeding
        DE_req = 0.0363 * BodyWeight; CP_req = 1.44 * BodyWeight;
        Ca_req = 0.04 * BodyWeight;   P_req  = 0.028 * BodyWeight;
        Mg_req = 0.015 * BodyWeight;  K_req  = 0.05  * BodyWeight;
        Na_req = 0.02 * BodyWeight;   Cl_req = 0.08  * BodyWeight;
        Cu_req = 0.2 * BodyWeight;
        VitA_req = 30 * BodyWeight;   VitE_req = 1.0 * BodyWeight;
      } else { // Breeding — assume light work load
        SweatLoss = 0.0025 * BodyWeight;
        DE_req = 0.0363 * BodyWeight * 1.2;
        CP_req = 1.44 * BodyWeight + SweatLoss * 7.8 * 2 / 0.79 + 0.089 * BodyWeight;
        Ca_req = 0.06 * BodyWeight;   P_req  = 0.036 * BodyWeight;
        Mg_req = 0.019 * BodyWeight;
        K_req  = 0.05  * BodyWeight + (1.4 / 0.5) * SweatLoss;
        Na_req = 0.02  * BodyWeight + 3.1 * SweatLoss;
        Cl_req = 0.08  * BodyWeight + 5.3 * SweatLoss;
        Cu_req = 10.0  * DM_req;
        VitA_req = 45  * BodyWeight;  VitE_req = 1.6 * BodyWeight;
      }
      LYS_req = 0.043 * CP_req;
      S_req  = 1.5  * DM_req; Co_req = 0.05 * DM_req; I_req  = 0.35 * DM_req;
      Fe_req = 40   * DM_req; Mn_req = 40   * DM_req; Zn_req = 40   * DM_req;
      Se_req = 0.1  * DM_req; VitD_req = 6.6 * BodyWeight;
      Thi_req = 0.06 * BodyWeight; Ribo_req = 0.04 * BodyWeight;
      break;

    // ── Gestante ───────────────────────────────────────────────────────────
    case 'PREGNANT': {
      DM_req = (intakeLevel / 100) * matureWeight;
      BodyWeight = matureWeight;
      let FetalMass = 0, PUMass = 0, FetalGain = 0;
      if (monthOfGest < 5) {
        DE_req = 0.0333 * BodyWeight; CP_req = 1.26 * BodyWeight;
        Ca_req = 0.04 * BodyWeight;   P_req  = 0.028 * BodyWeight;
        Mg_req = 0.015 * BodyWeight;  K_req  = 0.05  * BodyWeight;
        Na_req = 0.02  * BodyWeight;  Cl_req = 0.08  * BodyWeight;
        Cu_req = 0.2   * BodyWeight;  I_req  = 0.35  * DM_req;
        Fe_req = 40    * DM_req;
      } else {
        const GestDay    = monthOfGest * 30.4;
        const BirthWeight = 0.097 * matureWeight;
        FetalMass = (0.0000001 * Math.pow(GestDay, 3.5512)) * 0.01 * BirthWeight;
        PUMass    = (-0.0135 + 0.00009 * GestDay) * BodyWeight;
        FetalGain = (0.00000035512 * Math.pow(GestDay, 2.5512)) * 0.01 * BirthWeight
                    + 0.00009 * BodyWeight;
        DE_req = (0.0333 * BodyWeight)
               + (0.0333 * 2 * (FetalMass + PUMass))
               + ((0.03 * FetalGain * 9.4) + (0.2 * FetalGain * 5.6)) / 0.6;
        CP_req = (1.26 * BodyWeight) + (FetalGain * 1000 * 2.0 * 0.2 / 0.79);
        if (monthOfGest < 7) {
          Ca_req = 0.04  * BodyWeight; P_req  = 0.028  * BodyWeight;
          Mg_req = 0.015 * BodyWeight; K_req  = 0.05   * BodyWeight;
          Na_req = 0.02  * BodyWeight; Cl_req = 0.08   * BodyWeight;
          Cu_req = 0.2   * BodyWeight; I_req  = 0.35   * DM_req; Fe_req = 40 * DM_req;
        } else if (monthOfGest < 9) {
          Ca_req = 0.056  * BodyWeight; P_req  = 0.04    * BodyWeight;
          Mg_req = 0.0152 * BodyWeight; K_req  = 0.05    * BodyWeight;
          Na_req = 0.02   * BodyWeight; Cl_req = 0.08    * BodyWeight;
          Cu_req = 0.2    * BodyWeight; I_req  = 0.35    * DM_req; Fe_req = 40 * DM_req;
        } else {
          Ca_req = 0.072  * BodyWeight; P_req  = 0.0525  * BodyWeight;
          Mg_req = 0.0153 * BodyWeight; K_req  = 0.0517  * BodyWeight;
          Na_req = 0.022  * BodyWeight; Cl_req = 0.082   * BodyWeight;
          Cu_req = 0.25   * BodyWeight; I_req  = 0.4     * DM_req; Fe_req = 50 * DM_req;
        }
      }
      LYS_req = 0.043 * CP_req;
      S_req  = 1.5  * DM_req; Co_req = 0.05 * DM_req;
      Mn_req = 40   * DM_req; Zn_req = 40   * DM_req; Se_req = 0.1 * DM_req;
      VitA_req = 60  * matureWeight; VitD_req = 6.6 * matureWeight;
      VitE_req = 1.0 * matureWeight;
      Thi_req  = 0.06 * matureWeight; Ribo_req = 0.04 * matureWeight;
      BodyWeight = BodyWeight + (FetalMass + PUMass) * 1.25;
      break;
    }

    // ── Lactante ───────────────────────────────────────────────────────────
    case 'LACTATING': {
      BodyWeight = matureWeight;
      DM_req = (intakeLevel / 100) * BodyWeight;
      const MilkVals = [0.0326, 0.0324, 0.0299, 0.0271, 0.0244, 0.0218];
      const idx      = Math.min(Math.max(monthOfLact - 1, 0), 5);
      const MilkProd = MilkVals[idx] * BodyWeight;
      DE_req = (BodyWeight > 700 ? 0.0333 : 0.0363) * BodyWeight
             + (MilkProd * 10 * 50) / (1000 * 0.6);
      CP_req  = 1.44 * BodyWeight + MilkProd * 50;
      LYS_req = 0.043 * 1.44 * BodyWeight + MilkProd * 3.3;
      if (monthOfLact < 4) {
        Na_req = 0.02 * BodyWeight + MilkProd * 0.17;
        Ca_req = 0.04 * BodyWeight + (MilkProd * 1.2) / 0.5;
        P_req  = (0.01 / 0.45) * BodyWeight + (MilkProd * 0.75) / 0.45;
        Mg_req = 0.015 * BodyWeight + (MilkProd * 0.09) / 0.4;
        K_req  = 0.05  * BodyWeight + (MilkProd * 0.7) / 0.5;
      } else if (monthOfLact < 6) {
        Na_req = 0.02 * BodyWeight + MilkProd * 0.14;
        Ca_req = 0.04 * BodyWeight + (MilkProd * 0.8) / 0.5;
        P_req  = (0.01 / 0.45) * BodyWeight + (MilkProd * 0.5) / 0.45;
        Mg_req = 0.015 * BodyWeight + (MilkProd * 0.09) / 0.4;
        K_req  = 0.05  * BodyWeight + (MilkProd * 0.4) / 0.5;
      } else {
        Na_req = 0.02 * BodyWeight + MilkProd * 0.14;
        Ca_req = 0.04 * BodyWeight + (MilkProd * 0.8) / 0.5;
        P_req  = (0.01 / 0.45) * BodyWeight + (MilkProd * 0.5) / 0.45;
        Mg_req = 0.015 * BodyWeight + (MilkProd * 0.045) / 0.4;
        K_req  = 0.05  * BodyWeight + (MilkProd * 0.4) / 0.5;
      }
      Cl_req = 0.091 * BodyWeight; S_req  = 1.5  * DM_req; Co_req = 0.05 * DM_req;
      Cu_req = 0.25  * BodyWeight; I_req  = 0.35 * DM_req; Fe_req = 50  * DM_req;
      Mn_req = 40    * DM_req;     Zn_req = 40   * DM_req; Se_req = 0.1 * DM_req;
      VitA_req = 60  * BodyWeight; VitD_req = 6.6 * BodyWeight; VitE_req = 2.0 * BodyWeight;
      Thi_req  = 0.075 * BodyWeight; Ribo_req = 0.05 * BodyWeight;
      break;
    }

    // ── Crescimento ────────────────────────────────────────────────────────
    case 'GROWING': {
      BodyWeight = matureWeight * (9.7 + (90.3 * (1.0 - Math.exp(-0.0772 * age)))) / 100.0;
      const DailyGain = matureWeight * (6.97121 * Math.exp(-0.0772 * age)) / (30.4 * 100);
      DM_req = (intakeLevel / 100) * BodyWeight;
      // Sem trabalho adicional (workLoadGrow=0)
      DE_req = ((56.5 * Math.pow(age, -0.145)) / 1000) * BodyWeight
             + (1.99 + 1.21 * age - 0.021 * age * age) * DailyGain;
      if (age < 6.5) {
        CP_req  = 1.44 * BodyWeight + ((DailyGain * 1000 * 0.2) / 0.5) / 0.79;
        Cl_req  = 0.093 * BodyWeight; VitD_req = 22.2 * BodyWeight;
      } else if (age < 8.5) {
        CP_req  = 1.44 * BodyWeight + ((DailyGain * 1000 * 0.2) / 0.45) / 0.79;
        Cl_req  = 0.085 * BodyWeight; VitD_req = 17.4 * BodyWeight;
      } else if (age < 10.5) {
        CP_req  = 1.44 * BodyWeight + ((DailyGain * 1000 * 0.2) / 0.40) / 0.79;
        Cl_req  = 0.085 * BodyWeight; VitD_req = 17.4 * BodyWeight;
      } else if (age < 11.5) {
        CP_req  = 1.44 * BodyWeight + ((DailyGain * 1000 * 0.2) / 0.35) / 0.79;
        Cl_req  = 0.085 * BodyWeight; VitD_req = 17.4 * BodyWeight;
      } else {
        CP_req  = 1.44 * BodyWeight + ((DailyGain * 1000 * 0.2) / 0.30) / 0.79;
        Cl_req  = 0.0825 * BodyWeight;
        VitD_req = age < 18.5 ? 15.9 * BodyWeight : 13.7 * BodyWeight;
      }
      Mg_req = 0.015 * BodyWeight + 1.25 * DailyGain;
      K_req  = 0.05  * BodyWeight + 3.0  * DailyGain;
      Na_req = 0.02  * BodyWeight + 1.0  * DailyGain;
      LYS_req = 0.043 * CP_req;
      Ca_req  = 0.072 * BodyWeight + 32   * DailyGain;
      P_req   = 0.04  * BodyWeight + 17.8 * DailyGain;
      S_req   = 1.5   * DM_req; Co_req = 0.05 * DM_req;
      Cu_req  = 0.25  * BodyWeight; I_req = 0.35 * DM_req;
      Fe_req  = 50    * DM_req; Mn_req = 40  * DM_req;
      Zn_req  = 40    * DM_req; Se_req = 0.1 * DM_req;
      VitA_req = 45  * BodyWeight; VitE_req = 2.0 * BodyWeight;
      Thi_req  = 0.075 * BodyWeight; Ribo_req = 0.05 * BodyWeight;
      break;
    }

    default:
      BodyWeight = matureWeight;
      DM_req = (intakeLevel / 100) * BodyWeight;
  }

  return {
    BodyWeight: r2(BodyWeight || matureWeight),
    DMI:  r2(DM_req),
    DE:   r2(DE_req),   CP:   r2(CP_req),  Lys: r2(LYS_req),
    Ca:   r2(Ca_req),   P:    r2(P_req),   Na:  r2(Na_req),
    Cl:   r2(Cl_req),   K:    r2(K_req),   Mg:  r2(Mg_req),
    S:    r2(S_req),    Co:   r2(Co_req),  Cu:  r2(Cu_req),
    I:    r2(I_req),    Fe:   r2(Fe_req),  Mn:  r2(Mn_req),
    Zn:   r2(Zn_req),  Se:   r2(Se_req),
    vitA: r2(VitA_req), vitD: r2(VitD_req), vitE: r2(VitE_req),
    tiamina: r2(Thi_req), riboflavina: r2(Ribo_req),
  };
};

// ─── buildMapExigencias ───────────────────────────────────────────────────────
/**
 * Converte o resultado do calcNRC para o formato mapExigencias do service.
 *
 * Cria uma entrada para CADA alias do nutriente, normalizado do mesmo jeito
 * que normalizarNomeNutriente() no service (lowercase + trim + NFC).
 * Isso garante que o lookup funcione independente de como o nutriente
 * foi cadastrado em tb_nutrientes.
 */
const buildMapExigencias = (nrcResult) => {
  const map = {};
  for (const [nrcKey, aliases] of Object.entries(ALIASES)) {
    const valor = nrcResult[nrcKey];
    if (valor === undefined || valor === null) continue;
    const entry = { valorExigido: valor, unidadeNRC: UNIDADE_NRC[nrcKey] };
    for (const alias of aliases) {
      map[alias.toLowerCase().trim().normalize('NFC')] = entry;
    }
  }
  return map;
};

// ─── Interface pública ────────────────────────────────────────────────────────
/**
 * Recebe o objeto animal do banco e retorna mapExigencias pronto para o service.
 */
const calcular = (animal) => {
  const animalType = resolverAnimalType(animal.categoriaAnimal);

  const params = {
    animalType,
    matureWeight: animal.peso || 500,
    intakeLevel:  2.0,

    // Manutenção: temperamento define o nível (Calmo=Low, Médio=Average, Nervoso=High)
    maintLevel:    resolverMaintLevel(animal.tipoExercicio),

    // Trabalhando: nível de exercício
    workLoad:      resolverWorkLoad(animal.tipoExercicio),

    // Garanhão: em serviço ou fora
    stallionLevel: resolverStallionLevel(animal.tipoExercicio),

    // Éguas Prenhas: mês de gestação extraído do tipoExercicio
    monthOfGest:   resolverMonthGest(animal.tipoExercicio),

    // Éguas em Lactação: mês de lactação extraído do tipoExercicio
    monthOfLact:   resolverMonthLact(animal.tipoExercicio),

    // Potros em Crescimento: idade em meses extraída do tipoExercicio
    age:           resolverAgeMeses(animal.tipoExercicio, animal.dataNascimento),

    workLoadGrow: 0,
  };

  const resultado = calcNRC(params);
  return buildMapExigencias(resultado);
};

module.exports = { calcular, calcNRC, buildMapExigencias, FONTE, ALIASES, UNIDADE_NRC };