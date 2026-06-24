'use strict';
// Seed: catálogo de laboratórios e exames clínicos com correlação de tipo de amostra
// Fontes: Paddock (SP), Genesi (RJ), LACVET/Jockey Club (RJ)

const { PrismaClient } = require('@prisma/client');
const _prisma = new PrismaClient();
const prisma  = _prisma;

// ─── Tipos de amostra canônicos ──────────────────────────────────────────────
const S  = 'Sangue Total com EDTA';   // tubo roxo — hemograma, PCR, hemoparasitas
const SR = 'Soro Sanguíneo';          // tubo amarelo/vermelho — bioquímica, sorologias, hormônios
const PF = 'Plasma Fluoreto';         // tubo cinza — glicose, lactato, frutosamina
const PC = 'Plasma Citratado';        // tubo azul — coagulograma, TAP, TTPA, VHS
const U  = 'Urina';                   // urinálise, urocultura, clearance
const F  = 'Fezes';                   // parasitológico, coprocultura, sangue oculto
const SW = 'Swab';                    // cultura bacteriana/fúngica de secreções
const RC = 'Raspado Cutâneo';         // pesquisa de sarna, fungo, dermatófitos
const LC = 'Líquido Cavitário';       // pleural, peritoneal, sinovial
const LQ = 'Líquor';                  // líquido cefalorraquidiano
const FR = 'Fragmento / Biópsia';     // histopatologia, citologia tecidual

const LABS = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    nome:    'Laboratório Paddock',
    contato: '(11) 3031-5543',
    email:   'info@laboratoriopaddock.com.br',
    site:    'www.laboratoriopaddock.com.br',
    grupos: [
      {
        nome: 'Imunologia', ordem: 1,
        itens: [
          { nome: 'Piroplasmose (F.C.)',                                              t: [SR] },
          { nome: 'Piroplasmose (ELISA)',                                             t: [SR] },
          { nome: 'Durina - Trypanosoma equiperdum (F.C.)',                           t: [SR] },
          { nome: 'Estomatite Vesicular (ELISA)',                                     t: [SR] },
          { nome: 'Arterite Viral Equina (SN)',                                       t: [SR] },
          { nome: 'Sarcocystis neurona – EPM (SAG ELISA)',                            t: [SR, LQ] },
          { nome: 'Encefalomielite Equina (SN)',                                      t: [SR] },
          { nome: 'Herpes Virus (SN)',                                                t: [SR] },
          { nome: 'West Nile Virus (WNV-ELISA)',                                      t: [SR] },
          { nome: 'Rhodococcus equi (IDGA)',                                          t: [SR] },
          { nome: 'Brucelose (AAT) – Brucella abortus',                               t: [SR] },
          { nome: 'Leptospirose (Soroaglutinação)',                                   t: [SR] },
          { nome: 'Toxoplasmose (IFI)',                                               t: [SR] },
          { nome: 'Erliquiose – A.phagocytophila (ELISA)',                            t: [SR, S] },
          { nome: 'Erliquiose Granulocítica - Anaplasma phagocytophila (IFI)',        t: [SR, S] },
          { nome: 'Erliquiose Monocítica – Neorickettsia risticii (IFI)',             t: [SR, S] },
        ],
      },
      {
        nome: 'Exames Oficiais MAPA', ordem: 2,
        itens: [
          { nome: 'AIE - Anemia Infecciosa Equina (IDGA)',  t: [SR] },
          { nome: 'AIE - Anemia Infecciosa Equina (ELISA)', t: [SR] },
          { nome: 'Mormo (F.C.)',                           t: [SR] },
        ],
      },
      {
        nome: 'Microbiologia – Cultura e Antibiograma', ordem: 3,
        itens: [
          { nome: 'Cultura e Antibiograma – Anaeróbios',          t: [SW] },
          { nome: 'Cultura e Antibiograma – Bacteriana',          t: [SW] },
          { nome: 'Cultura e Antibiograma – Fezes',               t: [F] },
          { nome: 'Cultura e Antibiograma – Fungos',              t: [SW, RC] },
          { nome: 'Cultura e Antibiograma – Salmonella (Fezes)',   t: [F] },
          { nome: 'T. equigenitalis (Metrite Contagiosa)',         t: [SW] },
        ],
      },
      {
        nome: 'Endocrinologia', ordem: 4,
        itens: [
          { nome: 'Progesterona',              t: [SR] },
          { nome: 'T3 (Triiodotironina)',       t: [SR] },
          { nome: 'T4 (Tetraiodotironina)',     t: [SR] },
          { nome: 'T4 Livre (Tiroxina Livre)',  t: [SR] },
          { nome: 'Estrógenos Totais',          t: [SR] },
        ],
      },
      {
        nome: 'Histopatologia', ordem: 5,
        itens: [
          { nome: 'Histopatologia – Um Fragmento',       t: [FR] },
          { nome: 'Histopatologia – Múltiplos Fragmentos', t: [FR] },
        ],
      },
      {
        nome: 'Biologia Molecular – PCR', ordem: 6,
        itens: [
          { nome: 'Pool de Babesia sp. (caballi, equi...)',             t: [S] },
          { nome: 'Pool de Ehrlichia sp. (N.risticii, A.phagocyto...)', t: [S] },
          { nome: 'Leptospira interrogans (PCR)',                        t: [S, U] },
          { nome: 'Surra – Trypanosoma evansi (PCR)',                   t: [S] },
        ],
      },
      {
        nome: 'Outros', ordem: 7,
        itens: [
          { nome: 'PRP – Plasma Rico em Plaquetas',                                                          t: [S] },
          { nome: 'IgG em potros – Avaliação da Transferência de Imunidade Passiva pelo colostro',           t: [SR] },
          { nome: 'Acompanhamento da calcificação em potros (Clearence Fracional de Fósforo)',               t: [S, U] },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    nome:    'Laboratório Genesi',
    contato: '(21) 2491-9757',
    email:   null,
    site:    null,
    grupos: [
      {
        nome: 'Hematologia', ordem: 1,
        itens: [
          { nome: 'Hemograma 1 (Eritrograma + Leucograma + Contagem de Plaquetas + PPT)',                                              t: [S] },
          { nome: 'Hemograma 2 (Hemograma 1 + Pesq. Hematozoários sem capa leucocitária)',                                             t: [S] },
          { nome: 'Hemograma 3 (Hemograma 1 + Pesq. Hematozoários com capa leucocitária)',                                             t: [S] },
          { nome: 'Hemograma Completo (Hemograma 3 + Pesq. de Microfilárias por Knott Modificado)',                                    t: [S] },
          { nome: 'Hemograma Aves e Répteis',                                                                                          t: [S] },
          { nome: 'Hemograma Equino (Hemograma 3 + Fibrinogênio)',                                                                     t: [S, PC] },
          { nome: 'Coagulograma (TAP + TTPA)',                                                                                         t: [PC] },
        ],
      },
      {
        nome: 'Bioquímica', ordem: 2,
        itens: [
          { nome: 'Albumina',                                    t: [SR] },
          { nome: 'ALT (Alanina Aminotransferase)',              t: [SR] },
          { nome: 'Amilase (cinética)',                          t: [SR] },
          { nome: 'AST (Aspartato Aminotransferase)',            t: [SR] },
          { nome: 'Bilirrubinas (Total, Direta e Indireta)',     t: [SR] },
          { nome: 'Cálcio',                                      t: [SR] },
          { nome: 'Cálcio Iônico',                              t: [SR, S] },
          { nome: 'Colesterol Total',                            t: [SR] },
          { nome: 'Colesterol Total e Frações (HDL, VLDL, LDL)', t: [SR] },
          { nome: 'Colinesterase',                               t: [SR] },
          { nome: 'Creatinina (Sérica ou Urinária)',             t: [SR, U] },
          { nome: 'Creatina Quinase (CK)',                       t: [SR] },
          { nome: 'Desidrogenase Lática (LDH)',                  t: [SR] },
          { nome: 'Ferritina',                                   t: [SR] },
          { nome: 'Ferro Sérico',                                t: [SR] },
          { nome: 'Fosfatase Alcalina',                          t: [SR] },
          { nome: 'Fósforo',                                     t: [SR] },
          { nome: 'Frutosamina',                                 t: [SR, PF] },
          { nome: 'Gama GT (Gama Glutamil Transferase)',          t: [SR] },
          { nome: 'Glicose',                                     t: [SR, PF] },
          { nome: 'Lactato',                                     t: [PF] },
          { nome: 'Lipase Cinética',                             t: [SR] },
          { nome: 'Lipídeos Totais',                             t: [SR] },
          { nome: 'Lipidograma (Colesterol, LDL, HDL, VLDL, Triglicerídeos, Lipídeos)', t: [SR] },
          { nome: 'Potássio',                                    t: [SR] },
          { nome: 'Proteína Total e Frações (Albumina e Globulina)', t: [SR] },
          { nome: 'Sódio',                                       t: [SR] },
          { nome: 'Sódio e Potássio',                            t: [SR] },
          { nome: 'Sódio, Potássio, Cálcio e Fósforo',          t: [SR] },
          { nome: 'Triglicerídeos',                              t: [SR] },
          { nome: 'Uréia',                                       t: [SR] },
        ],
      },
      {
        nome: 'Bioquímica Especial / Terapêutica', ordem: 3,
        itens: [
          { nome: 'Ácido Fólico (Folato)',                                  t: [SR] },
          { nome: 'Ácido Fólico + Cobalamina',                              t: [SR] },
          { nome: 'Ácidos Biliares Totais (amostra única ou pré prandial)', t: [SR] },
          { nome: 'Ácidos Biliares Totais – Teste de Estímulo',             t: [SR] },
          { nome: 'Brometo de Potássio',                                    t: [SR] },
          { nome: 'Calcidiol – Vitamina D3 (25-H)',                         t: [SR] },
          { nome: 'Calcitriol – Vitamina D3 (1-25-H)',                      t: [SR] },
          { nome: 'Cobalamina (Vitamina B12)',                               t: [SR] },
          { nome: 'Eletroforese de Proteínas',                               t: [SR] },
          { nome: 'Fenobarbital',                                            t: [SR] },
          { nome: 'Fosfatase Alcalina Total e Frações',                      t: [SR] },
          { nome: 'Lipase Pancreática Específica QUANTITATIVA',              t: [SR] },
          { nome: 'Lipase Pancreática Qualitativa (SNAP cPL)',               t: [SR] },
          { nome: 'SDMA (Dimetilarginina Simétrica)',                        t: [SR] },
          { nome: 'Tripsina Imunrreativa (TLI)',                             t: [SR] },
        ],
      },
      {
        nome: 'Painéis', ordem: 4,
        itens: [
          { nome: 'Pré-Operatório (Hemograma 3 / ALT / FA / Uréia / Creatinina)',                                                                                                t: [S, SR] },
          { nome: 'Genesi (Hemograma 2 / ALT / Fosfatase Alcalina / PPT e Frações / Colesterol / Triglicerídeos / Glicose / Uréia / Creatinina)',                                t: [S, SR] },
          { nome: 'Animal Ictérico (Hemograma 2 / AST / ALT / Bilirrubina Total e Frações / FA / GGT / Uréia)',                                                                   t: [S, SR] },
          { nome: 'Avaliação Hemoparasitas Canino (Hemograma 3 / Pesq. Filária Knott / Snap 4DX / PCR Babesia)',                                                                   t: [S, SR] },
          { nome: 'Bioquímico Reduzido (ALT / AST / Fosfatase Alcalina / Glicose / Uréia / Creatinina)',                                                                           t: [SR] },
          { nome: 'Check Up Anual (Hemograma 3 / PPT e Frações / ALT / FA / GGT / Uréia / Glicose / Colesterol / Triglicerídeos)',                                                t: [S, SR] },
          { nome: 'Check Up Canino (Hemograma 2 / ALT / PPT e Frações / FA / Uréia / Creatinina)',                                                                                 t: [S, SR] },
          { nome: 'Check Up Felino (Hemograma 2 / ALT / GGT / PPT e Frações / Uréia / Creatinina)',                                                                               t: [S, SR] },
          { nome: 'Geriátrico (Hemograma 2 / FA / PPT e Frações / Uréia / Creatinina)',                                                                                            t: [S, SR] },
          { nome: 'Geriátrico Felino + T4 (Hemograma 2 / ALT / GGT / AST / PPT e Frações / Uréia / Creatinina / Glicose / T4 Total por RIE)',                                    t: [S, SR] },
          { nome: 'Hepático (Hemograma 3 / ALT / AST / FA / GGT / PPT / Albumina / Globulina / Uréia / Glicose / Bilirrubina Total e Frações)',                                   t: [S, SR] },
          { nome: 'Internação Básico (Sódio / Potássio / Fósforo / Cloreto / Cálcio Iônico)',                                                                                      t: [SR] },
          { nome: 'Pancreático (Hemograma 3 / ALT / Fósforo / PPT e Frações / Bilirrubinas / Amilase / Lipase / Glicose / Creatinina / Lipase Específica Qualitativa)',           t: [S, SR] },
          { nome: 'Pré Anestésico (Hemograma 2 / ALT / Albumina / FA / Uréia / Creatinina / Glicose)',                                                                             t: [S, SR] },
          { nome: 'Renal Básico 1 (Hemograma 2 / Sódio / Potássio / Fósforo / Uréia / Creatinina)',                                                                               t: [S, SR] },
          { nome: 'Renal Básico 2 (Hemograma 1 / Sódio / Potássio / Uréia / Cálcio / Cloro / Fósforo / Creatinina)',                                                             t: [S, SR] },
          { nome: 'Renal Completo (Hemograma 3 / Uréia / Creatinina / Albumina / Sódio / Potássio / Fósforo / Cálcio Iônico / EAS + Relação Proteína:Creatinina)',               t: [S, SR, U] },
          { nome: 'Renal e Hepático (Hemograma 3 / Uréia / Creatinina / EAS / ALT / AST / FA / Bilirrubinas / GGT / PPT e Frações)',                                             t: [S, SR, U] },
          { nome: 'Diagnóstico de Hiperadrenocorticismo (Hemog. 1 / ALT / FA / Glicose / Colesterol / Triglicerídeos / Creatinina / Sódio e Potássio / Teste Supressão Dexametasona)', t: [S, SR] },
          { nome: 'Diabético Básico (Hemograma 2 / Glicose / Frutosamina / Colesterol / EAS)',                                                                                     t: [S, SR, U] },
          { nome: 'Diabético Completo (Hemograma 2 / PPT e Frações / Glicose / Frutosamina / ALT / FA / Bilirrubinas / Colesterol / Creatinina / Uréia / Cálcio / Fósforo / Sódio e Potássio / EAS)', t: [S, SR, U] },
          { nome: 'Gastroentérico Filhotes Cão (Hemograma 3 / Parasitológico de Fezes / Coprocultura / Antígenos Parvovírus)',                                                    t: [S, SR, F] },
          { nome: 'Dermatológico 1 (Pesquisa Sarna e Fungo / Cultura de Dermatófitos / Citologia Secreção Cutânea)',                                                               t: [RC, SW] },
          { nome: 'Dermatológico 2 (Pesquisa Sarna e Fungo / Cultura e Antibiograma / Cultura Fúngica / Citologia Cutânea)',                                                      t: [RC, SW] },
        ],
      },
      {
        nome: 'Sistema Urinário e Cálculos', ordem: 5,
        itens: [
          { nome: 'Análise Qualitativa de Cálculo Biliar',                    t: [FR] },
          { nome: 'Análise Qualitativa de Cálculo Urinário',                  t: [FR] },
          { nome: 'Urinálise (EAS)',                                           t: [U] },
          { nome: 'Urinálise (EAS) + Relação Proteína:Creatinina Urinária',   t: [U] },
        ],
      },
      {
        nome: 'Parasitologia / Testes Gastrointestinais', ordem: 6,
        itens: [
          { nome: 'Coprologia Funcional com Citologia',  t: [F] },
          { nome: 'Exame Micológico Direto',             t: [RC, SW] },
          { nome: 'Parasitológico de Fezes',             t: [F] },
          { nome: 'Pesquisa de Ácaros Promotores de Sarna', t: [RC] },
          { nome: 'Pesquisa de Esporotricose',           t: [SW, RC] },
          { nome: 'Teste de Knott Modificado',           t: [S] },
          { nome: 'Pesquisa de Sarna e Fungo',           t: [RC] },
        ],
      },
      {
        nome: 'Imunologia', ordem: 7,
        itens: [
          { nome: 'Babesia canis IgM com Titulação',                               t: [SR] },
          { nome: 'Babesia canis IgG com Titulação',                               t: [SR] },
          { nome: 'Babesia canis IgM e IgG Qualitativo',                           t: [SR] },
          { nome: 'Check Up Ehrlichia canis + Babesia canis (IgM e IgG Qualitativo ELISA)', t: [SR] },
          { nome: 'Cinomose Canina – Antígenos',                                   t: [S] },
          { nome: 'Cinomose – IgM DOT ELISA',                                     t: [SR] },
          { nome: 'Cinomose – IgG DOT ELISA',                                     t: [SR] },
          { nome: 'Cinomose e Parvovirose – IgM DOT ELISA',                       t: [SR] },
          { nome: 'Coronavírus Felino – Apoio Diagnóstico PIF',                   t: [SR, LC] },
          { nome: 'Dirofilaria immitis – Antígenos',                               t: [S, SR] },
          { nome: 'Ehrlichia canis – ELISA IgM com Titulação',                    t: [SR] },
          { nome: 'Ehrlichia canis – ELISA IgG com Titulação',                    t: [SR] },
          { nome: 'Ehrlichia canis – ELISA IgM + IgG com Titulação',              t: [SR] },
          { nome: 'FIV/FeLV – ELISA',                                             t: [SR] },
          { nome: 'FIV/FeLV – Imunocromatografia',                                t: [S, SR] },
          { nome: 'Check Up Viral Felino (FIV + FeLV ELISA + Coronavírus PIF)',   t: [SR] },
          { nome: 'Giárdia sp.',                                                   t: [F] },
          { nome: 'Leishmania Visceral Canina – ELISA + RIFI Diluição Plena',     t: [SR] },
          { nome: 'Leishmania Visceral Canina (Anti rk39) – Imunocromatografia',  t: [SR, S] },
          { nome: 'Leptospirose SAM',                                              t: [SR] },
          { nome: 'Leptospirose Canina – IgM',                                    t: [SR] },
          { nome: 'Leptospirose Canina ELISA – IgG com Titulação',                t: [SR] },
          { nome: 'Parvovírus Canino – Antígenos',                                t: [F, SW] },
          { nome: 'Toxoplasmose Canina – IgM e IgG',                              t: [SR] },
          { nome: 'Snap 2DE (Dirofilaria + Ehrlichia canis)',                      t: [S] },
          { nome: 'Snap 3DEL (Dirofilaria + Ehrlichia + Leishmania)',             t: [S] },
          { nome: 'Snap 4DX (Dirofilaria, Anaplasma, Borrelia, Ehrlichia)',       t: [S] },
        ],
      },
      {
        nome: 'Microbiologia', ordem: 8,
        itens: [
          { nome: 'Coloração de Gram',                                               t: [SW] },
          { nome: 'Coloração de Ziehl-Neelsen',                                     t: [SW, RC] },
          { nome: 'Cultura e Antibiograma Automatizados com Antibióticos Veterinários e MIC', t: [SW] },
          { nome: 'Cultura e Antibiograma – Aeróbios',                              t: [SW] },
          { nome: 'Cultura e Antibiograma – Anaeróbios Facultativos',               t: [SW] },
          { nome: 'Cultura e Antibiograma – Aeróbios + Anaeróbios Facultativos',   t: [SW] },
          { nome: 'Urocultura com Antibiograma',                                    t: [U] },
          { nome: 'Otocultura com Antibiograma (1 orelha)',                         t: [SW] },
          { nome: 'Painel Diagnóstico Otite (Citologia / Otocultura / Otocultura Fúngica)', t: [SW] },
          { nome: 'Cultura Bacteriana Especial (Nocardia, Actinomyces ou Mycobacterium)',   t: [SW, RC] },
          { nome: 'Cultura Fúngica (Sporothrix, Cryptococcus, etc.)',               t: [SW, RC] },
          { nome: 'Cultura de Fungos Dermatófitos',                                 t: [RC] },
          { nome: 'Cultura Fúngica com Antifungigrama',                             t: [SW, RC] },
          { nome: 'Rastreamento Infecção Renal (Gram / Urocultura / EAS)',          t: [U, S] },
        ],
      },
      {
        nome: 'Endocrinologia – Quimioluminescência', ordem: 9,
        itens: [
          { nome: '17-OH Hidroxiprogesterona',                                       t: [SR] },
          { nome: 'Cortisol',                                                        t: [SR] },
          { nome: 'Cortisol – 2 dosagens pós ACTH ou pós Dexametasona',             t: [SR] },
          { nome: 'Cortisol – 3 dosagens pós ACTH ou pós Dexametasona',             t: [SR] },
          { nome: 'Insulina',                                                        t: [SR] },
          { nome: 'Perfil Tireoidiano 1 (TSH + T4 Total + T4 Livre)',               t: [SR] },
          { nome: 'Perfil Tireoidiano 2 (TSH + T3 + T4 Livre + T4 Total)',          t: [SR] },
          { nome: 'Progesterona',                                                    t: [SR] },
          { nome: 'T3 – Triiodotironina',                                           t: [SR] },
          { nome: 'T3 + T4 Total',                                                  t: [SR] },
          { nome: 'T4 Livre',                                                        t: [SR] },
          { nome: 'T4 Total Basal ou Pós Levotiroxina',                             t: [SR] },
          { nome: 'Teste Reposição Hormonal (T4 Basal + T4 Medicamento)',           t: [SR] },
          { nome: 'TSH – Kit Veterinário',                                           t: [SR] },
        ],
      },
      {
        nome: 'Endocrinologia – Radioimunoensaio', ordem: 10,
        itens: [
          { nome: '17 Hidroxi Progesterona (RIE)',                                            t: [SR] },
          { nome: 'Cortisol Basal (RIE)',                                                     t: [SR] },
          { nome: 'Cortisol – 2 dosagens pós ACTH ou pós Dexametasona (RIE)',                t: [SR] },
          { nome: 'Cortisol – 3 dosagens pós ACTH ou pós Dexametasona (RIE)',                t: [SR] },
          { nome: 'T4 Total Basal ou Pós Levrotiroxina (RIE)',                               t: [SR] },
          { nome: 'T4 Livre por Diálise (RIE)',                                              t: [SR] },
        ],
      },
      {
        nome: 'Citologia / Histologia / Diagnóstico Oncológico', ordem: 11,
        itens: [
          { nome: 'Citologia Otológica (até 2 lâminas)',                               t: [SW] },
          { nome: 'Citologia de Secreção Cutânea',                                    t: [SW, RC] },
          { nome: 'Análise Completa de Líquido Cavitário (Citologia + Exame Físico e Químico)', t: [LC] },
          { nome: 'Análise de Líquor',                                                t: [LQ] },
          { nome: 'Exame Citológico por Tecido (nódulos/tumores)',                    t: [FR] },
          { nome: 'Mielograma',                                                       t: [FR] },
          { nome: 'Exame Histopatológico',                                            t: [FR] },
          { nome: 'Histopatologia Cadeia Mamária (Unilateral)',                       t: [FR] },
          { nome: 'Histopatologia Cadeia Mamária (Bilateral)',                        t: [FR] },
        ],
      },
      {
        nome: 'Biologia Molecular – RT-PCR', ordem: 12,
        itens: [
          { nome: 'Anaplasma spp. (PCR)',                                                                                      t: [S] },
          { nome: 'Anaplasma platys (PCR)',                                                                                    t: [S] },
          { nome: 'Babesia canis (PCR)',                                                                                       t: [S] },
          { nome: 'Babesia spp. (PCR)',                                                                                        t: [S] },
          { nome: 'Chlamydia psittaci – Aves (PCR)',                                                                          t: [SW] },
          { nome: 'Coronavírus Felino – PIF (PCR)',                                                                           t: [S, LC] },
          { nome: 'Ehrlichia canis (PCR)',                                                                                     t: [S] },
          { nome: 'Ehrlichia spp. (PCR)',                                                                                     t: [S] },
          { nome: 'FeLV – Vírus da Leucemia Felina (PCR)',                                                                    t: [S] },
          { nome: 'FIV – Vírus da Imunodeficiência Felina (PCR)',                                                             t: [S] },
          { nome: 'FeLV – DNA Proviral (PCR)',                                                                                t: [S] },
          { nome: 'Leishmania infantum (PCR)',                                                                                t: [S] },
          { nome: 'Leptospira spp. (PCR)',                                                                                    t: [S, U] },
          { nome: 'Mycoplasma haemofelis (PCR)',                                                                              t: [S] },
          { nome: 'Parvovírus Canino (PCR)',                                                                                  t: [S, F] },
          { nome: 'Vírus da Cinomose Canina (PCR)',                                                                          t: [S, SW] },
          { nome: 'PCR Infecciosas Canino 1 (Anaplasma platys + Ehrlichia canis + Babesia canis)',                           t: [S] },
          { nome: 'PCR Infecciosas Canino 2 (Anaplasma platys + Ehrlichia canis + Babesia canis + Leishmania infantum)',     t: [S] },
          { nome: 'Painel Hemoparasitas Completo (Anaplasma + Ehrlichia + Babesia + Leishmania + Mycoplasma + Dirofilaria)', t: [S] },
          { nome: 'PCR Real Time Quantitativo',                                                                               t: [S] },
        ],
      },
      {
        nome: 'Silvestres e Exóticos', ordem: 13,
        itens: [
          { nome: 'Hemograma Aves e Répteis',                                                                                                       t: [S] },
          { nome: 'Sexagem de Aves',                                                                                                                t: [S, SW] },
          { nome: 'Painel Check Up Silvestre (Hemograma / Pesq. Hematozoários / TGO / TGP / Ácido Úrico / Creatinina / Fosfatase Alcalina)',       t: [S, SR] },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    nome:    'LACVET – Jockey Club Brasileiro',
    contato: '(21) 3534-9391',
    email:   'lacvet@jcb.com.br',
    site:    null,
    grupos: [
      {
        nome: 'Hematologia', ordem: 1,
        itens: [
          { nome: 'Hemograma Completo',                                          t: [S] },
          { nome: 'Hemograma Simples',                                           t: [S] },
          { nome: 'Hemograma Completo + Pesquisa de Hematozoários',              t: [S] },
          { nome: 'Hemograma Simples + Pesquisa de Hematozoários',               t: [S] },
          { nome: 'Pesquisa de Hematozoários',                                   t: [S] },
          { nome: 'Hemograma Completo + Proteínas Totais + Fibrinogênio',        t: [S, PC] },
          { nome: 'Hematócrito + Proteínas Totais + Fibrinogênio',              t: [S, PC] },
          { nome: 'Velocidade de Hemossedimentação (VHS)',                       t: [PC, S] },
        ],
      },
      {
        nome: 'Bioquímica', ordem: 2,
        itens: [
          { nome: 'Albumina',                t: [SR] },
          { nome: 'Globulina',               t: [SR] },
          { nome: 'Uréia',                   t: [SR] },
          { nome: 'Creatinina',              t: [SR] },
          { nome: 'Bilirrubina Total e Frações', t: [SR] },
          { nome: 'AST (TGO)',               t: [SR] },
          { nome: 'ALT (TGP)',               t: [SR] },
          { nome: 'LDH',                     t: [SR] },
          { nome: 'CK (Creatinaquinase)',     t: [SR] },
          { nome: 'GGT',                     t: [SR] },
          { nome: 'Fosfatase Alcalina',      t: [SR] },
          { nome: 'Glicose',                 t: [SR, PF] },
          { nome: 'Lactato',                 t: [PF] },
          { nome: 'Cálcio',                  t: [SR] },
          { nome: 'Fósforo',                 t: [SR] },
          { nome: 'Proteína Total',          t: [SR] },
          { nome: 'Ferro Sanguíneo',         t: [SR] },
          { nome: 'Colesterol',              t: [SR] },
          { nome: 'Triglicerídeos',          t: [SR] },
        ],
      },
      {
        nome: 'Outros', ordem: 3,
        itens: [
          { nome: 'Parasitológico de Fezes',             t: [F] },
          { nome: 'Pesquisa de Sangue Oculto em Fezes',  t: [F] },
          { nome: 'EAS (Urinálise Completa)',             t: [U] },
          { nome: 'PRP – Plasma Rico em Plaquetas',      t: [S] },
          { nome: 'Soro Autólogo',                       t: [SR] },
        ],
      },
      {
        nome: 'Perfis', ordem: 4,
        itens: [
          { nome: 'Check Up (Hemograma Completo + Proteínas Totais + Uréia + Creatinina + AST + GGT + Fosfatase Alcalina + Bilirrubina e Frações)',                                     t: [S, SR] },
          { nome: 'Hepático (Hemograma Completo + AST + Fosfatase Alcalina + GGT + Uréia + Proteínas Totais + Albumina + Globulina + Bilirrubina e Frações)',                           t: [S, SR] },
          { nome: 'Pré-Operatório (Hemograma Completo + Proteínas Totais + AST + GGT + Lactato + Glicose + Uréia + Creatinina)',                                                        t: [S, SR] },
          { nome: 'Renal (Hemograma Completo + Uréia + Creatinina + Cálcio + Fósforo + EAS)',                                                                                           t: [S, SR, U] },
          { nome: 'Muscular (Hemograma Completo + AST + LDH + CK)',                                                                                                                     t: [S, SR] },
          { nome: 'Treinamento (Hemograma Completo + Proteínas Totais + CK + AST + Lactato + Cálcio + Fósforo)',                                                                       t: [S, SR] },
          { nome: 'Cólica (Hemograma Completo + Proteínas Totais + Lactato + Uréia + Creatinina)',                                                                                      t: [S, SR] },
        ],
      },
    ],
  },
];

async function seedLaboratorios() {
  console.log('Seeding laboratórios e catálogo de exames...');

  for (const lab of LABS) {
    const labRecord = await prisma.laboratorio.upsert({
      where:  { nome: lab.nome },
      update: { contato: lab.contato, email: lab.email, site: lab.site, ativo: true },
      create: { nome: lab.nome, contato: lab.contato, email: lab.email, site: lab.site },
    });

    for (const grupo of lab.grupos) {
      const grupoRecord = await prisma.exameGrupo.upsert({
        where:  { laboratorioId_nome: { laboratorioId: labRecord.id, nome: grupo.nome } },
        update: { ordem: grupo.ordem, ativo: true },
        create: { laboratorioId: labRecord.id, nome: grupo.nome, ordem: grupo.ordem },
      });

      for (const item of grupo.itens) {
        await prisma.exameItem.upsert({
          where:  { grupoId_nome: { grupoId: grupoRecord.id, nome: item.nome } },
          update: { ativo: true, tiposAmostra: item.t },
          create: { grupoId: grupoRecord.id, nome: item.nome, tiposAmostra: item.t },
        });
      }
    }

    console.log(`  ✓ ${lab.nome} — ${lab.grupos.length} grupos`);
  }

  console.log('Laboratórios cadastrados com sucesso.');
}

module.exports = { seedLaboratorios };

if (require.main === module) {
  seedLaboratorios()
    .catch(console.error)
    .finally(() => _prisma.$disconnect());
}
