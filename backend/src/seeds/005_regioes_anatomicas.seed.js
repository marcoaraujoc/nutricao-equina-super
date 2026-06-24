/**
 * Seed: Regiões anatômicas equinas para o módulo de Resenha Gráfica.
 *
 * Polígonos calibrados sobre o SVG fiel (viewBox completo 0 0 1165.44 815.39).
 * Coordenadas no espaço original do SVG — se o asset for re-vetorizado,
 * estes polígonos precisam ser recalibrados.
 * Polígonos são caixas retangulares simples (4 pontos) — suficiente para o
 * protótipo; refinar com mais vértices é débito técnico.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const regioes = [
  // ─── Vista LATERAL (viewBox recorte: 0 0 1165 470) ────────────────────────
  { codigo: 'cabeca_dir',        labelPt: 'Cabeça (lado direito)',           labelEn: 'Head (right side)',              labelEs: 'Cabeza (lado derecho)',           vista: 'LATERAL',            poligono: [[0,0],[330,0],[330,170],[0,170]],          ordem: 1 },
  { codigo: 'dorso_garupa_dir',  labelPt: 'Dorso / garupa (lado direito)',   labelEn: 'Back / rump (right side)',       labelEs: 'Dorso / grupa (lado derecho)',    vista: 'LATERAL',            poligono: [[0,170],[330,170],[330,300],[0,300]],       ordem: 2 },
  { codigo: 'membro_ant_dir',    labelPt: 'Membro anterior (lado direito)',  labelEn: 'Forelimb (right side)',          labelEs: 'Miembro anterior (lado derecho)', vista: 'LATERAL',            poligono: [[0,300],[150,300],[150,460],[0,460]],       ordem: 3 },
  { codigo: 'membro_post_dir',   labelPt: 'Membro posterior (lado direito)', labelEn: 'Hindlimb (right side)',          labelEs: 'Miembro posterior (lado derecho)',vista: 'LATERAL',            poligono: [[150,300],[330,300],[330,460],[150,460]],   ordem: 4 },
  { codigo: 'cabeca_esq',        labelPt: 'Cabeça (lado esquerdo)',          labelEn: 'Head (left side)',               labelEs: 'Cabeza (lado izquierdo)',         vista: 'LATERAL',            poligono: [[835,0],[1165,0],[1165,170],[835,170]],     ordem: 5 },
  { codigo: 'dorso_garupa_esq',  labelPt: 'Dorso / garupa (lado esquerdo)', labelEn: 'Back / rump (left side)',        labelEs: 'Dorso / grupa (lado izquierdo)', vista: 'LATERAL',            poligono: [[835,170],[1165,170],[1165,300],[835,300]], ordem: 6 },
  { codigo: 'membro_ant_esq',    labelPt: 'Membro anterior (lado esquerdo)',labelEn: 'Forelimb (left side)',           labelEs: 'Miembro anterior (lado izquierdo)',vista: 'LATERAL',           poligono: [[835,300],[1015,300],[1015,460],[835,460]], ordem: 7 },
  { codigo: 'membro_post_esq',   labelPt: 'Membro posterior (lado esquerdo)',labelEn: 'Hindlimb (left side)',          labelEs: 'Miembro posterior (lado izquierdo)',vista: 'LATERAL',          poligono: [[1015,300],[1165,300],[1165,460],[1015,460]],ordem: 8 },

  // ─── Vista CABECA_FRONTAL (recorte: x=520, y=145, w=210, h=415) ──────────
  { codigo: 'testa',             labelPt: 'Testa',                           labelEn: 'Forehead',                      labelEs: 'Frente',                         vista: 'CABECA_FRONTAL',     poligono: [[520,145],[730,145],[730,300],[520,300]],   ordem: 1 },
  { codigo: 'fronte_nasal',      labelPt: 'Fronte nasal',                    labelEn: 'Nasal bridge',                  labelEs: 'Frente nasal',                   vista: 'CABECA_FRONTAL',     poligono: [[520,300],[730,300],[730,450],[520,450]],   ordem: 2 },
  { codigo: 'queixo',            labelPt: 'Queixo',                          labelEn: 'Chin',                          labelEs: 'Mentón',                         vista: 'CABECA_FRONTAL',     poligono: [[520,450],[730,450],[730,560],[520,560]],   ordem: 3 },

  // ─── Vista FOCINHO (recorte: x=590, y=550, w=185, h=155) ─────────────────
  { codigo: 'beico',             labelPt: 'Beiço',                           labelEn: 'Muzzle / lip',                  labelEs: 'Hocico',                         vista: 'FOCINHO',            poligono: [[590,550],[775,550],[775,705],[590,705]],   ordem: 1 },

  // ─── Vista PESCOCO_INFERIOR (recorte: x=385, y=270, w=170, h=480) ─────────
  { codigo: 'pescoco_inferior',  labelPt: 'Pescoço (vista inferior)',        labelEn: 'Neck (lower view)',             labelEs: 'Cuello (vista inferior)',         vista: 'PESCOCO_INFERIOR',   poligono: [[385,270],[555,270],[555,750],[385,750]],   ordem: 1 },

  // ─── Vista MEMBROS_ANTERIORES (recorte: x=0, y=480, w=300, h=335) ─────────
  { codigo: 'membro_ant_esq_post',labelPt: 'Membro anterior esquerdo (visão posterior)', labelEn: 'Left forelimb (posterior view)',  labelEs: 'Miembro anterior izquierdo (vista posterior)', vista: 'MEMBROS_ANTERIORES', poligono: [[0,480],[150,480],[150,815],[0,815]],       ordem: 1 },
  { codigo: 'membro_ant_dir_post',labelPt: 'Membro anterior direito (visão posterior)',  labelEn: 'Right forelimb (posterior view)', labelEs: 'Miembro anterior derecho (vista posterior)',  vista: 'MEMBROS_ANTERIORES', poligono: [[150,480],[300,480],[300,815],[150,815]],   ordem: 2 },

  // ─── Vista MEMBROS_POSTERIORES (recorte: x=870, y=480, w=295, h=335) ──────
  { codigo: 'membro_post_esq_post',labelPt: 'Membro posterior esquerdo (visão posterior)',labelEn: 'Left hindlimb (posterior view)',  labelEs: 'Miembro posterior izquierdo (vista posterior)', vista: 'MEMBROS_POSTERIORES', poligono: [[870,480],[1017,480],[1017,815],[870,815]],  ordem: 1 },
  { codigo: 'membro_post_dir_post',labelPt: 'Membro posterior direito (visão posterior)', labelEn: 'Right hindlimb (posterior view)', labelEs: 'Miembro posterior derecho (vista posterior)',  vista: 'MEMBROS_POSTERIORES', poligono: [[1017,480],[1165,480],[1165,815],[1017,815]], ordem: 2 },
];

async function main() {
  console.log(`Seeding ${regioes.length} regiões anatômicas equinas...`);

  for (const regiao of regioes) {
    await prisma.regiaoAnatomicaEquino.upsert({
      where: { codigo: regiao.codigo },
      update: {
        labelPt: regiao.labelPt,
        labelEn: regiao.labelEn,
        labelEs: regiao.labelEs,
        vista: regiao.vista,
        poligono: regiao.poligono,
        ordem: regiao.ordem,
      },
      create: regiao,
    });
  }

  console.log('Seed de regiões anatômicas equinas concluído.');
}

main()
  .catch((e) => { console.error('Erro no seed de regiões:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
