'use strict';
// Seed: catálogo de exames de diagnóstico por imagem
// Fonte: tabela CSV exames_imagem_vet.csv (PR-0302 a PR-0420)

const { PrismaClient } = require('@prisma/client');
const _prisma = new PrismaClient();

const GRUPOS = [
  { nome: 'Radiografia - Membro Torácico',           categoria: 'Diagnóstico por Imagem', ordem: 1 },
  { nome: 'Radiografia - Membro Pélvico',            categoria: 'Diagnóstico por Imagem', ordem: 2 },
  { nome: 'Radiografia - Axial',                     categoria: 'Diagnóstico por Imagem', ordem: 3 },
  { nome: 'Radiografia - Membro (Bovino)',            categoria: 'Diagnóstico por Imagem', ordem: 4 },
  { nome: 'Ultrassonografia - Reprodutivo Fêmea',    categoria: 'Diagnóstico por Imagem', ordem: 5 },
  { nome: 'Ultrassonografia - Reprodutivo Macho',    categoria: 'Diagnóstico por Imagem', ordem: 6 },
  { nome: 'Ultrassonografia - Aparelho Locomotor',   categoria: 'Diagnóstico por Imagem', ordem: 7 },
  { nome: 'Ultrassonografia - Geral',                categoria: 'Diagnóstico por Imagem', ordem: 8 },
  { nome: 'Endoscopia',                              categoria: 'Diagnóstico por Imagem', ordem: 9 },
  { nome: 'Termografia',                             categoria: 'Diagnóstico por Imagem', ordem: 10 },
  { nome: 'Tomografia e Ressonância (Encaminhamento)', categoria: 'Diagnóstico por Imagem', ordem: 11 },
  { nome: 'Laparoscopia Diagnóstica',                categoria: 'Diagnóstico por Imagem', ordem: 12 },
];

const ITENS = {
  'Radiografia - Membro Torácico': [
    { codigo: 'PR-0302', nome: 'Raio-X de Casco/Falange Distal - Membro Torácico Esquerdo',              sigla: 'RX Casco MT Esq',          especie: 'Equino' },
    { codigo: 'PR-0303', nome: 'Raio-X de Casco/Falange Distal - Membro Torácico Direito',               sigla: 'RX Casco MT Dir',          especie: 'Equino' },
    { codigo: 'PR-0304', nome: 'Raio-X de Articulação Interfalangeana Distal - Membro Torácico Esquerdo', sigla: 'RX AID MT Esq',           especie: 'Equino' },
    { codigo: 'PR-0305', nome: 'Raio-X de Articulação Interfalangeana Distal - Membro Torácico Direito',  sigla: 'RX AID MT Dir',           especie: 'Equino' },
    { codigo: 'PR-0306', nome: 'Raio-X de Articulação Interfalangeana Proximal - Membro Torácico Esquerdo', sigla: 'RX AIP MT Esq',         especie: 'Equino' },
    { codigo: 'PR-0307', nome: 'Raio-X de Articulação Interfalangeana Proximal - Membro Torácico Direito',  sigla: 'RX AIP MT Dir',         especie: 'Equino' },
    { codigo: 'PR-0308', nome: 'Raio-X de Boleto (Articulação Metacarpofalangeana) - Membro Torácico Esquerdo', sigla: 'RX Boleto MT Esq', especie: 'Equino' },
    { codigo: 'PR-0309', nome: 'Raio-X de Boleto (Articulação Metacarpofalangeana) - Membro Torácico Direito',  sigla: 'RX Boleto MT Dir', especie: 'Equino' },
    { codigo: 'PR-0310', nome: 'Raio-X de Metacarpo - Membro Torácico Esquerdo',                         sigla: 'RX Metacarpo MT Esq',      especie: 'Equino' },
    { codigo: 'PR-0311', nome: 'Raio-X de Metacarpo - Membro Torácico Direito',                          sigla: 'RX Metacarpo MT Dir',      especie: 'Equino' },
    { codigo: 'PR-0312', nome: 'Raio-X de Carpo - Membro Torácico Esquerdo',                             sigla: 'RX Carpo MT Esq',          especie: 'Equino' },
    { codigo: 'PR-0313', nome: 'Raio-X de Carpo - Membro Torácico Direito',                              sigla: 'RX Carpo MT Dir',          especie: 'Equino' },
    { codigo: 'PR-0314', nome: 'Raio-X de Antebraço (Rádio-Ulna) - Membro Torácico Esquerdo',           sigla: 'RX Antebraço MT Esq',      especie: 'Equino' },
    { codigo: 'PR-0315', nome: 'Raio-X de Antebraço (Rádio-Ulna) - Membro Torácico Direito',            sigla: 'RX Antebraço MT Dir',      especie: 'Equino' },
    { codigo: 'PR-0316', nome: 'Raio-X de Cotovelo - Membro Torácico Esquerdo',                          sigla: 'RX Cotovelo MT Esq',       especie: 'Equino' },
    { codigo: 'PR-0317', nome: 'Raio-X de Cotovelo - Membro Torácico Direito',                           sigla: 'RX Cotovelo MT Dir',       especie: 'Equino' },
    { codigo: 'PR-0318', nome: 'Raio-X de Úmero - Membro Torácico Esquerdo',                            sigla: 'RX Úmero MT Esq',          especie: 'Equino' },
    { codigo: 'PR-0319', nome: 'Raio-X de Úmero - Membro Torácico Direito',                             sigla: 'RX Úmero MT Dir',          especie: 'Equino' },
    { codigo: 'PR-0320', nome: 'Raio-X de Escápula - Membro Torácico Esquerdo',                          sigla: 'RX Escápula MT Esq',       especie: 'Equino' },
    { codigo: 'PR-0321', nome: 'Raio-X de Escápula - Membro Torácico Direito',                           sigla: 'RX Escápula MT Dir',       especie: 'Equino' },
  ],

  'Radiografia - Membro Pélvico': [
    { codigo: 'PR-0322', nome: 'Raio-X de Casco/Falange Distal - Membro Pélvico Esquerdo',               sigla: 'RX Casco MP Esq',          especie: 'Equino' },
    { codigo: 'PR-0323', nome: 'Raio-X de Casco/Falange Distal - Membro Pélvico Direito',                sigla: 'RX Casco MP Dir',          especie: 'Equino' },
    { codigo: 'PR-0324', nome: 'Raio-X de Articulação Interfalangeana Distal - Membro Pélvico Esquerdo', sigla: 'RX AID MP Esq',            especie: 'Equino' },
    { codigo: 'PR-0325', nome: 'Raio-X de Articulação Interfalangeana Distal - Membro Pélvico Direito',  sigla: 'RX AID MP Dir',            especie: 'Equino' },
    { codigo: 'PR-0326', nome: 'Raio-X de Articulação Interfalangeana Proximal - Membro Pélvico Esquerdo', sigla: 'RX AIP MP Esq',          especie: 'Equino' },
    { codigo: 'PR-0327', nome: 'Raio-X de Articulação Interfalangeana Proximal - Membro Pélvico Direito',  sigla: 'RX AIP MP Dir',          especie: 'Equino' },
    { codigo: 'PR-0328', nome: 'Raio-X de Boleto (Articulação Metatarsofalangeana) - Membro Pélvico Esquerdo', sigla: 'RX Boleto MP Esq',  especie: 'Equino' },
    { codigo: 'PR-0329', nome: 'Raio-X de Boleto (Articulação Metatarsofalangeana) - Membro Pélvico Direito',  sigla: 'RX Boleto MP Dir',  especie: 'Equino' },
    { codigo: 'PR-0330', nome: 'Raio-X de Metatarso - Membro Pélvico Esquerdo',                          sigla: 'RX Metatarso MP Esq',      especie: 'Equino' },
    { codigo: 'PR-0331', nome: 'Raio-X de Metatarso - Membro Pélvico Direito',                           sigla: 'RX Metatarso MP Dir',      especie: 'Equino' },
    { codigo: 'PR-0332', nome: 'Raio-X de Tarso (Jarrete) - Membro Pélvico Esquerdo',                    sigla: 'RX Tarso MP Esq',          especie: 'Equino' },
    { codigo: 'PR-0333', nome: 'Raio-X de Tarso (Jarrete) - Membro Pélvico Direito',                     sigla: 'RX Tarso MP Dir',          especie: 'Equino' },
    { codigo: 'PR-0334', nome: 'Raio-X de Tíbia - Membro Pélvico Esquerdo',                              sigla: 'RX Tíbia MP Esq',          especie: 'Equino' },
    { codigo: 'PR-0335', nome: 'Raio-X de Tíbia - Membro Pélvico Direito',                               sigla: 'RX Tíbia MP Dir',          especie: 'Equino' },
    { codigo: 'PR-0336', nome: 'Raio-X de Femoropatelar (Joelho) - Membro Pélvico Esquerdo',             sigla: 'RX Joelho MP Esq',         especie: 'Equino' },
    { codigo: 'PR-0337', nome: 'Raio-X de Femoropatelar (Joelho) - Membro Pélvico Direito',              sigla: 'RX Joelho MP Dir',         especie: 'Equino' },
    { codigo: 'PR-0338', nome: 'Raio-X de Fêmur - Membro Pélvico Esquerdo',                              sigla: 'RX Fêmur MP Esq',          especie: 'Equino' },
    { codigo: 'PR-0339', nome: 'Raio-X de Fêmur - Membro Pélvico Direito',                               sigla: 'RX Fêmur MP Dir',          especie: 'Equino' },
    { codigo: 'PR-0340', nome: 'Raio-X de Coxofemoral - Membro Pélvico Esquerdo',                        sigla: 'RX Coxofemoral MP Esq',    especie: 'Equino' },
    { codigo: 'PR-0341', nome: 'Raio-X de Coxofemoral - Membro Pélvico Direito',                         sigla: 'RX Coxofemoral MP Dir',    especie: 'Equino' },
  ],

  'Radiografia - Axial': [
    { codigo: 'PR-0342', nome: 'Raio-X de Crânio - Seios Paranasais',                sigla: 'RX Seios Paranasais', especie: 'Equino' },
    { codigo: 'PR-0343', nome: 'Raio-X de Crânio - Dentário (Arcada Superior)',      sigla: 'RX Dentário Sup',     especie: 'Equino' },
    { codigo: 'PR-0344', nome: 'Raio-X de Crânio - Dentário (Arcada Inferior)',      sigla: 'RX Dentário Inf',     especie: 'Equino' },
    { codigo: 'PR-0345', nome: 'Raio-X de Coluna Cervical',                          sigla: 'RX Cervical',         especie: 'Equino' },
    { codigo: 'PR-0346', nome: 'Raio-X de Coluna Torácica/Lombar (Dorso)',           sigla: 'RX Dorso',            especie: 'Equino' },
    { codigo: 'PR-0347', nome: 'Raio-X de Tórax',                                   sigla: 'RX Tórax',            especie: 'Equino' },
    { codigo: 'PR-0348', nome: 'Raio-X de Abdome',                                  sigla: 'RX Abdome',           especie: 'Equino' },
    { codigo: 'PR-0349', nome: 'Raio-X de Crânio - Seios Frontais',                 sigla: 'RX Seios Frontais',   especie: 'Bovino' },
    { codigo: 'PR-0350', nome: 'Raio-X de Retículo - Corpo Estranho Metálico',      sigla: 'RX Retículo',         especie: 'Bovino' },
    { codigo: 'PR-0351', nome: 'Raio-X de Tórax (Bovino)',                          sigla: 'RX Tórax Bov',        especie: 'Bovino' },
  ],

  'Radiografia - Membro (Bovino)': [
    { codigo: 'PR-0352', nome: 'Raio-X de Casco/Falanges - Membro Esquerdo',             sigla: 'RX Casco Esq',        especie: 'Bovino' },
    { codigo: 'PR-0353', nome: 'Raio-X de Casco/Falanges - Membro Direito',              sigla: 'RX Casco Dir',        especie: 'Bovino' },
    { codigo: 'PR-0354', nome: 'Raio-X de Articulação Interfalangeana - Membro Esquerdo', sigla: 'RX AIF Esq',          especie: 'Bovino' },
    { codigo: 'PR-0355', nome: 'Raio-X de Articulação Interfalangeana - Membro Direito',  sigla: 'RX AIF Dir',          especie: 'Bovino' },
    { codigo: 'PR-0356', nome: 'Raio-X de Carpo/Tarso - Membro Esquerdo',                sigla: 'RX Carpo-Tarso Esq',  especie: 'Bovino' },
    { codigo: 'PR-0357', nome: 'Raio-X de Carpo/Tarso - Membro Direito',                 sigla: 'RX Carpo-Tarso Dir',  especie: 'Bovino' },
  ],

  'Ultrassonografia - Reprodutivo Fêmea': [
    { codigo: 'PR-0358', nome: 'Diagnóstico de Gestação Precoce (até 30 dias)',                                           sigla: 'USG Gestação Precoce', especie: 'Ambas' },
    { codigo: 'PR-0359', nome: 'Diagnóstico de Gestação (30-90 dias)',                                                    sigla: 'USG Gestação 30-90d',  especie: 'Ambas' },
    { codigo: 'PR-0360', nome: 'Diagnóstico de Gestação (acima de 90 dias)',                                              sigla: 'USG Gestação +90d',    especie: 'Ambas' },
    { codigo: 'PR-0361', nome: 'Sexagem Fetal',                                                                           sigla: 'USG Sexagem',          especie: 'Ambas' },
    { codigo: 'PR-0362', nome: 'Avaliação Folicular Ovariana',                                                            sigla: 'USG Folicular',        especie: 'Ambas' },
    { codigo: 'PR-0363', nome: 'Avaliação de Corpo Lúteo',                                                                sigla: 'USG Corpo Lúteo',      especie: 'Ambas' },
    { codigo: 'PR-0364', nome: 'Avaliação de Cistos Ovarianos',                                                           sigla: 'USG Cisto Ovariano',   especie: 'Ambas' },
    { codigo: 'PR-0365', nome: 'Avaliação Uterina (Útero não gestante)',                                                  sigla: 'USG Útero',            especie: 'Ambas' },
    { codigo: 'PR-0366', nome: 'Avaliação de Endometrite/Acúmulo de Líquido Uterino',                                    sigla: 'USG Endometrite',      especie: 'Ambas' },
    { codigo: 'PR-0367', nome: 'Monitoramento de Ciclo Estral',                                                           sigla: 'USG Ciclo Estral',     especie: 'Ambas' },
    { codigo: 'PR-0368', nome: 'Avaliação Ultrassonográfica de Hidrópsia (Placenta/Âmnio)',                               sigla: 'USG Hidrópsia',        especie: 'Equino' },
    { codigo: 'PR-0369', nome: 'Avaliação Ultrassonográfica de Placenta (Espessura Combinada Útero-Placentária)',         sigla: 'USG Placenta',         especie: 'Equino' },
    { codigo: 'PR-0370', nome: 'Avaliação Ultrassonográfica de Gemelaridade',                                             sigla: 'USG Gemelar',          especie: 'Bovino' },
  ],

  'Ultrassonografia - Reprodutivo Macho': [
    { codigo: 'PR-0371', nome: 'Avaliação Ultrassonográfica Testicular',                                 sigla: 'USG Testicular',            especie: 'Ambas' },
    { codigo: 'PR-0372', nome: 'Avaliação Ultrassonográfica de Epidídimo',                               sigla: 'USG Epidídimo',             especie: 'Ambas' },
    { codigo: 'PR-0373', nome: 'Avaliação Ultrassonográfica de Cordão Espermático',                      sigla: 'USG Cordão Espermático',    especie: 'Ambas' },
    { codigo: 'PR-0374', nome: 'Avaliação Ultrassonográfica de Glândulas Acessórias (Próstata/Vesículas Seminais)', sigla: 'USG Glândulas Acessórias', especie: 'Ambas' },
    { codigo: 'PR-0375', nome: 'Avaliação Ultrassonográfica do Pênis e Prepúcio',                        sigla: 'USG Pênis/Prepúcio',        especie: 'Ambas' },
  ],

  'Ultrassonografia - Aparelho Locomotor': [
    { codigo: 'PR-0376', nome: 'Ultrassonografia de Tendão Flexor Digital Superficial - Membro Esquerdo',          sigla: 'USG TFDS Esq',               especie: 'Equino' },
    { codigo: 'PR-0377', nome: 'Ultrassonografia de Tendão Flexor Digital Superficial - Membro Direito',           sigla: 'USG TFDS Dir',               especie: 'Equino' },
    { codigo: 'PR-0378', nome: 'Ultrassonografia de Tendão Flexor Digital Profundo - Membro Esquerdo',             sigla: 'USG TFDP Esq',               especie: 'Equino' },
    { codigo: 'PR-0379', nome: 'Ultrassonografia de Tendão Flexor Digital Profundo - Membro Direito',              sigla: 'USG TFDP Dir',               especie: 'Equino' },
    { codigo: 'PR-0380', nome: 'Ultrassonografia de Ligamento Suspensor do Boleto - Membro Esquerdo',              sigla: 'USG Lig. Suspensor Esq',     especie: 'Equino' },
    { codigo: 'PR-0381', nome: 'Ultrassonografia de Ligamento Suspensor do Boleto - Membro Direito',               sigla: 'USG Lig. Suspensor Dir',     especie: 'Equino' },
    { codigo: 'PR-0382', nome: 'Ultrassonografia de Bainha do Tendão Flexor Digital (Carpal/Tarsal) - Membro Esquerdo', sigla: 'USG Bainha Flexora Esq', especie: 'Equino' },
    { codigo: 'PR-0383', nome: 'Ultrassonografia de Bainha do Tendão Flexor Digital (Carpal/Tarsal) - Membro Direito',  sigla: 'USG Bainha Flexora Dir', especie: 'Equino' },
    { codigo: 'PR-0384', nome: 'Ultrassonografia de Aparato Podotroclear (Acesso Transcuneal) - Membro Esquerdo',  sigla: 'USG Podotroclear Esq',       especie: 'Equino' },
    { codigo: 'PR-0385', nome: 'Ultrassonografia de Aparato Podotroclear (Acesso Transcuneal) - Membro Direito',   sigla: 'USG Podotroclear Dir',       especie: 'Equino' },
    { codigo: 'PR-0386', nome: 'Ultrassonografia de Articulação do Boleto (Tecidos Moles) - Membro Esquerdo',      sigla: 'USG Boleto TM Esq',          especie: 'Equino' },
    { codigo: 'PR-0387', nome: 'Ultrassonografia de Articulação do Boleto (Tecidos Moles) - Membro Direito',       sigla: 'USG Boleto TM Dir',          especie: 'Equino' },
    { codigo: 'PR-0388', nome: 'Ultrassonografia de Articulação do Carpo (Tecidos Moles) - Membro Esquerdo',       sigla: 'USG Carpo TM Esq',           especie: 'Equino' },
    { codigo: 'PR-0389', nome: 'Ultrassonografia de Articulação do Carpo (Tecidos Moles) - Membro Direito',        sigla: 'USG Carpo TM Dir',           especie: 'Equino' },
    { codigo: 'PR-0390', nome: 'Ultrassonografia de Articulação do Tarso (Tecidos Moles) - Membro Esquerdo',       sigla: 'USG Tarso TM Esq',           especie: 'Equino' },
    { codigo: 'PR-0391', nome: 'Ultrassonografia de Articulação do Tarso (Tecidos Moles) - Membro Direito',        sigla: 'USG Tarso TM Dir',           especie: 'Equino' },
    { codigo: 'PR-0392', nome: 'Ultrassonografia de Ligamento Colateral do Boleto - Membro Esquerdo',              sigla: 'USG Lig. Colateral Boleto Esq', especie: 'Equino' },
    { codigo: 'PR-0393', nome: 'Ultrassonografia de Ligamento Colateral do Boleto - Membro Direito',               sigla: 'USG Lig. Colateral Boleto Dir', especie: 'Equino' },
  ],

  'Ultrassonografia - Geral': [
    { codigo: 'PR-0394', nome: 'Ultrassonografia Abdominal Completa',                         sigla: 'USG Abdome Total',           especie: 'Ambas' },
    { codigo: 'PR-0395', nome: 'Ultrassonografia Abdominal Focada (Cólica Equina)',           sigla: 'USG Cólica',                 especie: 'Ambas' },
    { codigo: 'PR-0396', nome: 'Ultrassonografia Torácica',                                   sigla: 'USG Tórax',                  especie: 'Ambas' },
    { codigo: 'PR-0397', nome: 'Ecocardiograma',                                              sigla: 'ECOCG',                      especie: 'Ambas' },
    { codigo: 'PR-0398', nome: 'Ultrassonografia Renal',                                      sigla: 'USG Renal',                  especie: 'Ambas' },
    { codigo: 'PR-0399', nome: 'Ultrassonografia Hepática',                                   sigla: 'USG Hepática',               especie: 'Ambas' },
    { codigo: 'PR-0400', nome: 'Ultrassonografia de Linfonodos',                              sigla: 'USG Linfonodos',             especie: 'Ambas' },
    { codigo: 'PR-0401', nome: 'Ultrassonografia de Glândula Mamária/Úbere',                  sigla: 'USG Úbere',                  especie: 'Ambas' },
    { codigo: 'PR-0402', nome: 'Ultrassonografia Oftálmica',                                  sigla: 'USG Ocular',                 especie: 'Ambas' },
    { codigo: 'PR-0403', nome: 'Ultrassonografia Guiada para Punção/Biópsia',                 sigla: 'USG Guiada PAAF/Biópsia',   especie: 'Ambas' },
  ],

  'Endoscopia': [
    { codigo: 'PR-0404', nome: 'Endoscopia de Vias Aéreas Superiores (Repouso)',          sigla: 'Endoscopia VAS Repouso',  especie: 'Equino' },
    { codigo: 'PR-0405', nome: 'Endoscopia Dinâmica de Vias Aéreas (Overground)',         sigla: 'Endoscopia Dinâmica',     especie: 'Equino' },
    { codigo: 'PR-0406', nome: 'Gastroscopia',                                             sigla: 'Gastroscopia',            especie: 'Equino' },
    { codigo: 'PR-0407', nome: 'Rinoscopia',                                               sigla: 'Rinoscopia',              especie: 'Ambas' },
    { codigo: 'PR-0408', nome: 'Traqueobroncoscopia',                                      sigla: 'Traqueobroncoscopia',     especie: 'Ambas' },
    { codigo: 'PR-0409', nome: 'Lavado Broncoalveolar Guiado por Endoscopia',             sigla: 'LBA Endoscópico',         especie: 'Equino' },
    { codigo: 'PR-0410', nome: 'Cistoscopia',                                              sigla: 'Cistoscopia',             especie: 'Ambas' },
  ],

  'Termografia': [
    { codigo: 'PR-0411', nome: 'Termografia Infravermelha de Membros (Avaliação Bilateral)', sigla: 'Termografia Membros',  especie: 'Equino' },
    { codigo: 'PR-0412', nome: 'Termografia Infravermelha de Dorso/Região do Selim',         sigla: 'Termografia Dorso',    especie: 'Equino' },
    { codigo: 'PR-0413', nome: 'Termografia Infravermelha Escrotal',                         sigla: 'Termografia Escrotal', especie: 'Bovino' },
    { codigo: 'PR-0414', nome: 'Termografia Infravermelha de Casco',                         sigla: 'Termografia Casco',    especie: 'Equino' },
  ],

  'Tomografia e Ressonância (Encaminhamento)': [
    { codigo: 'PR-0415', nome: 'Tomografia Computadorizada de Cabeça',               sigla: 'TC Cabeça',        especie: 'Equino' },
    { codigo: 'PR-0416', nome: 'Tomografia Computadorizada de Membro Distal',        sigla: 'TC Membro Distal', especie: 'Equino' },
    { codigo: 'PR-0417', nome: 'Ressonância Magnética de Membro Distal (Standing)',  sigla: 'RM Membro Distal', especie: 'Equino' },
    { codigo: 'PR-0418', nome: 'Ressonância Magnética de Cabeça/Encéfalo',           sigla: 'RM Encéfalo',      especie: 'Equino' },
  ],

  'Laparoscopia Diagnóstica': [
    { codigo: 'PR-0419', nome: 'Laparoscopia Diagnóstica Abdominal',                      sigla: 'Laparoscopia Diagnóstica', especie: 'Equino' },
    { codigo: 'PR-0420', nome: 'Laparoscopia Diagnóstica para Deslocamento de Abomaso',   sigla: 'Laparoscopia Abomaso',     especie: 'Bovino' },
  ],
};

async function seedImagemExames(prismaClient) {
  const prisma = prismaClient || _prisma;
  let gruposCount = 0;
  let itensCount  = 0;

  for (const grupoData of GRUPOS) {
    const grupo = await prisma.imagemExameGrupo.upsert({
      where:  { nome: grupoData.nome },
      update: { categoria: grupoData.categoria, ordem: grupoData.ordem },
      create: grupoData,
    });
    gruposCount++;

    const itens = ITENS[grupoData.nome] ?? [];
    for (const item of itens) {
      await prisma.imagemExameItem.upsert({
        where:  { codigo: item.codigo },
        update: { nome: item.nome, sigla: item.sigla, especie: item.especie, grupoId: grupo.id },
        create: { grupoId: grupo.id, codigo: item.codigo, nome: item.nome, sigla: item.sigla, especie: item.especie },
      });
      itensCount++;
    }
  }

  console.log(`  ✓ Exames de imagem: ${gruposCount} grupos, ${itensCount} itens`);
}

module.exports = { seedImagemExames };

if (require.main === module) {
  seedImagemExames()
    .catch(e => console.error(e))
    .finally(() => _prisma.$disconnect());
}
