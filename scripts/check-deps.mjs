// Verificação das dependências entre camadas do front-end (GOOD_PRACTICES.md §6, ARCHITECTURE.md).
//
// Lê os imports relativos de todo arquivo .ts em src/app e reprova os que quebram a regra
//   features → shared → core   (layout fica entre features e shared)
// - core: só importa core;
// - shared: core e shared;
// - layout: core, shared e layout;
// - cada feature: core, shared, ela mesma e as features listadas em FEATURE_DEPS;
// - os arquivos da raiz de src/app (app.ts, rotas, config) montam o app e podem importar tudo.
//
// Exceções conhecidas ficam em KNOWN_EXCEPTIONS, uma por linha, com o motivo: uma nova exceção
// tem de ser escrita aqui de propósito (e avisada), nunca entrar por descuido.
//
// Uso: `npm run check:deps` (também roda antes do `npm run build`).
//      `node scripts/check-deps.mjs --report` lista as dependências entre camadas.
// Sem dependências: só Node.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app');

/** Features que uma feature pode usar. */
const FEATURE_DEPS = {
  // A mesa se passa num mundo: usa o Worldbuild (explorador, cartões, serviço do mundo)
  'game-table': ['worldbuild'],
  // Os atalhos da página inicial abrem o "criar mesa" (QuickActionsService)
  home: ['tables'],
  // O Painel do Mestre reaproveita o "Abrir para os jogadores" (HostPanel) de Minhas mesas
  gm: ['tables'],
};

/** Imports fora da regra, aceitos por enquanto: "arquivo => alvo" (caminhos a partir de src/app). */
const KNOWN_EXCEPTIONS = new Map([
  [
    'features/worldbuild/worldbuild.ts => features/game-table/components/character-sheet/character-sheet',
    'A ficha do NPC do bestiário é a mesma ficha da mesa (CharacterSheetView), que ainda usa o ' +
      'TableSessionService direto. Sai quando a ficha usar só o SheetStore (SPEC.md §4).',
  ],
]);

// --- Leitura dos imports ------------------------------------------------------------

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const posix = (p) => p.split(sep).join('/');

/** Camada do arquivo: core, shared, layout, features/<nome> ou app (raiz de src/app). */
function layerOf(file) {
  const parts = relative(ROOT, file).split(sep);
  if (parts.length === 1) return 'app';
  return parts[0] === 'features' ? `features/${parts[1]}` : parts[0];
}

function allowed(from, to) {
  if (from === to || from === 'app') return true;
  if (to === 'core') return true;
  if (to === 'shared') return from !== 'core';
  if (to === 'layout') return from === 'app';
  if (to.startsWith('features/') && from.startsWith('features/')) {
    return (FEATURE_DEPS[from.slice('features/'.length)] ?? []).includes(to.slice('features/'.length));
  }
  return false;
}

// --- Verificação ----------------------------------------------------------------------

const report = process.argv.includes('--report');
const edges = new Map();
const problems = [];
const usedExceptions = new Set();

for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT)) {
    const target = resolve(dirname(file), match[1] ?? match[2]);
    if (!target.startsWith(ROOT)) continue;
    const from = layerOf(file);
    const to = layerOf(target);
    if (from === to) continue;
    const link = `${posix(relative(ROOT, file))} => ${posix(relative(ROOT, target))}`;
    const key = `${from} -> ${to}`;
    edges.set(key, [...(edges.get(key) ?? []), link]);
    if (allowed(from, to)) continue;
    if (KNOWN_EXCEPTIONS.has(link)) usedExceptions.add(link);
    else problems.push(`${key}: ${link}`);
  }
}

if (report) {
  for (const key of [...edges.keys()].sort()) console.log(`${key} (${edges.get(key).length})`);
}

// Exceção que não existe mais: tirar da lista (para ela não voltar sem ninguém notar)
const stale = [...KNOWN_EXCEPTIONS.keys()].filter((link) => !usedExceptions.has(link));
for (const link of stale) problems.push(`exceção que não acontece mais (tire de KNOWN_EXCEPTIONS): ${link}`);

if (problems.length) {
  console.error('Dependências entre camadas fora da regra (scripts/check-deps.mjs):');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Dependências entre camadas: ok (${usedExceptions.size} exceção conhecida).`);
