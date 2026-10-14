import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config/env';
import { createContext } from '../src/context';
import { openDatabase } from '../src/db/database';
import type { TableState } from '../src/domain';
import { newId } from '../src/lib/ids';

/**
 * Dados de exemplo para testar localmente (dados fictícios, nada pessoal):
 * - conta "Mestre" (mestre@zehenia.local) com uma mesa;
 * - conta "Jogadora" (jogador@zehenia.local), já membro da mesa;
 * - uma cena com um personagem da jogadora, um NPC com ficha secreta, uma anotação pública,
 *   uma só do mestre, uma parede e uma porta; uma segunda cena (só o mestre a recebe).
 *
 * A senha das duas contas é SEED_PASSWORD do `.env` (gerada aleatoriamente pelo setup: nenhuma
 * senha fica escrita no código). Rodar de novo não duplica nada.
 */
if (existsSync('.env')) process.loadEnvFile('.env');
const password = process.env['SEED_PASSWORD'];
if (!password || password.length < 12 || /troque/.test(password)) {
  console.error('Defina SEED_PASSWORD no .env (rode `npm run setup`).');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const ctx = createContext(config, db);

async function account(name: string, email: string) {
  const found = ctx.users.credentialsByEmail(email);
  if (found) return found.user;
  return (await ctx.auth.register({ name, email, password: password! })).user;
}

const gm = await account('Mestre', 'mestre@zehenia.local');
const player = await account('Jogadora', 'jogador@zehenia.local');

if (ctx.tables.listForUser(gm.id).length) {
  console.log('Dados de exemplo já existem.');
} else {
  const now = Date.now();
  const world = ctx.worlds.listByOwner(gm.id)[0];
  const tableId = newId();
  ctx.tables.create({
    id: tableId,
    ownerId: gm.id,
    worldId: world.id,
    name: 'Mesa de testes',
    system: 'Sistema próprio',
    description: 'Mesa criada pelo seed para testar o servidor.',
    maxPlayers: 4,
    accent: '#4f86f7',
    createdAt: now,
  });
  ctx.tables.addMember(tableId, player.id, 'player', now);

  const bars = [
    { id: 'status-body', label: 'Corpo', color: '#ef4444', value: 24, max: 24 },
    { id: 'status-mind', label: 'Mente', color: '#22c55e', value: 24, max: 24 },
    { id: 'status-spirit', label: 'Espírito', color: '#4f86f7', value: 24, max: 24 },
  ];
  const token = (enabled: boolean) => ({ size: 1, vision: { enabled, range: 18 }, bars, tags: [] });
  const state: TableState = {
    activeSceneId: 'cena-taverna',
    sceneFolders: [],
    entries: [
      { id: 'pc-lyra', kind: 'character', name: 'Lyra', createdAt: now, ownerUserId: player.id, token: token(true) },
      { id: 'npc-goblin', kind: 'npc', name: 'Goblin', createdAt: now, token: token(false), sheet: { race: 'Goblin', subrace: '', labels: ['Segredo do mestre'], relations: [], themes: [], inventory: [], notes: [], eiros: 0, studies: [] } },
      { id: 'act-golpe', kind: 'automation', name: 'Golpe', createdAt: now, ownerEntryId: 'pc-lyra', icon: 'swords', roll: { dice: '2d12', modifier: 1 } },
      { id: 'act-emboscada', kind: 'automation', name: 'Emboscada (do mestre)', createdAt: now, icon: 'skull', roll: { dice: '2d12', modifier: 3 } },
    ],
    scenes: [
      {
        id: 'cena-taverna',
        name: 'Taverna',
        gridSize: 70,
        showGrid: true,
        tokens: [
          { id: 'tk-lyra', entryId: 'pc-lyra', x: 315, y: 315 },
          { id: 'tk-goblin', entryId: 'npc-goblin', x: 735, y: 315, bars, sheet: { race: 'Goblin', subrace: '', labels: ['Ficha secreta do token'], relations: [], themes: [], inventory: [], notes: [], eiros: 0, studies: [] } },
        ],
        fog: { enabled: false },
        walls: [
          { id: 'parede-1', kind: 'line', points: [{ x: 490, y: 140 }, { x: 490, y: 560 }] },
          { id: 'porta-1', kind: 'door', points: [{ x: 490, y: 560 }, { x: 490, y: 700 }], open: false },
        ],
        drawings: [],
        notes: [
          { id: 'nota-publica', x: 200, y: 200, title: 'Balcão', text: 'Cerveja a 2 Eiros.', color: '#facc15', gmOnly: false },
          { id: 'nota-secreta', x: 800, y: 200, title: 'Alçapão', text: 'Só o mestre vê esta nota.', color: '#ef4444', gmOnly: true },
        ],
      },
      { id: 'cena-masmorra', name: 'Masmorra (preparação secreta)', gridSize: 70, showGrid: true, tokens: [], walls: [], drawings: [], notes: [] },
    ],
    chat: [],
  };
  ctx.tables.saveState(tableId, JSON.stringify(state), 1, now);
  console.log('Mesa de exemplo criada.');
}

console.log(`
Contas de exemplo (senha = SEED_PASSWORD do arquivo .env):
  mestre:  mestre@zehenia.local
  jogador: jogador@zehenia.local`);
db.close();
