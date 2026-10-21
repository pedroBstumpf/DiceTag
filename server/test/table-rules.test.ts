import { describe, expect, it } from 'vitest';
import { defaultToken, type Scene, type TableEntry, type TableState, type WorldItem } from '../src/domain';
import { COMMAND_RULES, type RuleContext } from '../src/realtime/command-rules';
import { COMMAND_SCHEMAS, COMMAND_TYPES } from '../src/realtime/command-schemas';
import { eventVisibleTo, playerVision, projectLore, projectState } from '../src/realtime/projection';
import { performRoll } from '../src/realtime/rolls';
import { VisionCache } from '../src/realtime/vision';
import { WorldView } from '../src/realtime/world';

// --- Mesa de exemplo ---------------------------------------------------------------

const bars = (spirit = 24) => [
  { id: 'status-body', label: 'Corpo', color: '#ef4444', value: 24, max: 24 },
  { id: 'status-mind', label: 'Mente', color: '#22c55e', value: 24, max: 24 },
  { id: 'status-spirit', label: 'Espírito', color: '#4f86f7', value: spirit, max: 24 },
];
const token = (spirit = 24) => ({ size: 1, vision: { enabled: true, range: 18 }, bars: bars(spirit), tags: [] });
const sheet = (labels: string[]) => ({
  race: '',
  subrace: '',
  labels,
  relations: [],
  inventory: [],
  notes: [{ id: 'background', title: 'Background', content: 'segredo pessoal' }],
  eiros: 0,
  studies: [{ id: 'study-1', text: 'Esgrima', sa: 0, sn: 5 }],
  themes: [
    {
      id: 'theme-1',
      name: 'Guerreira',
      tags: [
        { id: 'forca', text: 'Força', level: 3 },
        { id: 'fogo', text: 'Fogo', level: 4, magic: true },
      ],
      flaws: [{ id: 'medo', text: 'Medo', level: -2 }],
      goal: '',
      goalProgress: 0,
      goalAbandon: 0,
    },
  ],
});

function table(): TableState {
  const entries: TableEntry[] = [
    { id: 'pc-ana', kind: 'character', name: 'Ana', createdAt: 1, ownerUserId: 'u-ana', token: token(), sheet: sheet(['A']) as never },
    { id: 'pc-bia', kind: 'character', name: 'Bia', createdAt: 1, ownerUserId: 'u-bia', token: token(), sheet: sheet(['B']) as never },
    { id: 'npc-orc', kind: 'npc', name: 'Orc', createdAt: 1, token: token(), sheet: sheet(['secreto']) as never },
    { id: 'npc-pet', kind: 'npc', name: 'Lobo', createdAt: 1, token: token(), controllerUserId: 'u-ana', sheet: sheet(['pet']) as never },
    { id: 'act-ana', kind: 'automation', name: 'Golpe', createdAt: 1, ownerEntryId: 'pc-ana' },
    { id: 'act-gm', kind: 'automation', name: 'Emboscada', createdAt: 1 },
    { id: 'act-orc', kind: 'automation', name: 'Machadada', createdAt: 1, ownerEntryId: 'npc-orc' },
  ];
  return {
    activeSceneId: 's1',
    entries,
    sceneFolders: [{ id: 'f1', name: 'Capítulo 2' }],
    chat: [],
    lore: { revealed: ['pasta-publica'] },
    scenes: [
      {
        id: 's1',
        name: 'Ponte',
        gridSize: 70,
        showGrid: true,
        tokens: [
          { id: 't-ana', entryId: 'pc-ana', x: 100, y: 100 },
          { id: 't-orc', entryId: 'npc-orc', x: 500, y: 100, sheet: sheet(['ficha do token']) as never },
          { id: 't-orc2', entryId: 'npc-orc', x: 600, y: 100, inventoryPublic: true, sheet: sheet(['outro token']) as never },
        ],
        walls: [
          { id: 'w1', kind: 'line', points: [{ x: 300, y: 0 }, { x: 300, y: 400 }] },
          { id: 'd1', kind: 'door', points: [{ x: 300, y: 400 }, { x: 300, y: 500 }], open: false },
        ],
        notes: [
          { id: 'n-pub', x: 0, y: 0, title: 'Placa', text: '', color: '#facc15', gmOnly: false },
          { id: 'n-gm', x: 0, y: 0, title: 'Armadilha', text: '', color: '#ef4444', gmOnly: true },
        ],
        effects: [{ id: 'fx-bia', kind: 'explosion', color: '#ef4444', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, seed: 1, scale: 1, ownerUserId: 'u-bia' }],
      },
      { id: 's2', name: 'Covil (segredo)', gridSize: 70, showGrid: true, folderId: 'f1' },
    ],
  };
}

/** Mundo da mesa: uma Raça, um item numa pasta revelada e um item secreto. */
const worldItems: Record<string, WorldItem> = {
  'pasta-publica': { id: 'pasta-publica', type: 'folder', name: 'Pública', parentId: null, createdAt: 0, updatedAt: 0 },
  espada: { id: 'espada', type: 'item', name: 'Espada', parentId: 'pasta-publica', createdAt: 0, updatedAt: 0 },
  reliquia: { id: 'reliquia', type: 'item', name: 'Relíquia', parentId: null, createdAt: 0, updatedAt: 0 },
  elfo: { id: 'elfo', type: 'race', name: 'Elfo', parentId: null, createdAt: 0, updatedAt: 0, traits: ['Visão no escuro'], statusMods: { 'status-mind': 2 } },
};
const world = new WorldView((id) => worldItems[id] ?? null);

/** A mesa com a cena aberta alterada. */
function withScene(state: TableState, patch: Partial<Scene>): TableState {
  return { ...state, scenes: state.scenes.map((s) => (s.id === state.activeSceneId ? { ...s, ...patch } : s)) };
}

const gm: RuleContext['viewer'] = { role: 'gm', userId: 'u-gm' };
const ana: RuleContext['viewer'] = { role: 'player', userId: 'u-ana' };

/** Cena dos jogadores e estado projetado, como a sala calcula. */
const sceneOf = (state: TableState) => new VisionCache((e) => e.token ?? defaultToken(e.kind)).sceneOf(state);
const viewOf = (state: TableState, viewer: RuleContext['viewer'] = ana) => projectState(state, viewer, sceneOf(state));

/** Valida o formato e aplica a regra, como a sala faz. */
function run(type: (typeof COMMAND_TYPES)[number], payload: unknown, viewer = ana, state = table()) {
  const parsed = COMMAND_SCHEMAS[type].safeParse(payload);
  if (!parsed.success) return { ok: false as const, reason: 'formato' };
  const rule = COMMAND_RULES[type] as (p: unknown, c: RuleContext) => { ok: boolean; reason?: string; payload?: any };
  return rule(parsed.data, { state, viewer, userName: viewer.role === 'gm' ? 'Mestre' : 'Ana', now: 42, full: false, world });
}

// --- Formato -------------------------------------------------------------------------

describe('formato dos comandos', () => {
  it('há esquema e regra para todo comando do front-end', () => {
    expect(COMMAND_TYPES.length).toBeGreaterThanOrEqual(49);
    for (const type of COMMAND_TYPES) expect(COMMAND_RULES[type]).toBeTypeOf('function');
  });

  it('nomes que alterariam o protótipo não são comandos', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(COMMAND_TYPES).not.toContain(name);
  });

  it('recusa campos desconhecidos, ids inválidos e valores fora do limite', () => {
    expect(run('moveToken', { placementId: 't-ana', x: 1, y: 1, admin: true }, gm).ok).toBe(false);
    expect(run('moveToken', { placementId: '../x', x: 1, y: 1 }, gm).ok).toBe(false);
    expect(run('moveToken', { placementId: 't-ana', x: 1e9, y: 1 }, gm).ok).toBe(false);
    expect(run('addNote', { sceneId: 's1', note: { id: 'n', x: 0, y: 0, title: '', text: '', color: 'red;background:url(x)', gmOnly: false } }, gm).ok).toBe(false);
  });

  it('memória da névoa: no máximo 600 células por lado e dados do tamanho declarado', () => {
    const mask = (cols: number, data: string) => ({ sceneId: 's1', explored: { cell: 10, cols, rows: 10, data } });
    expect(run('setExplored', mask(10, 'AAAAAAAAAAAAAAAAAA=='), gm).ok).toBe(true);
    expect(run('setExplored', mask(601, ''), gm).ok).toBe(false);
    expect(run('setExplored', mask(10, 'A'.repeat(1000)), gm).ok).toBe(false);
  });

  it('o cliente não pode enviar resultado de rolagem pelo chat', () => {
    const message = { id: 'm', at: 0, userId: 'u-ana', author: 'Ana', role: 'player', text: 'oi', roll: { total: 99 } };
    expect(run('addChatMessage', { message }).ok).toBe(false);
  });
});

// --- Permissões --------------------------------------------------------------------

describe('permissões no servidor', () => {
  it('preparação da mesa é só do mestre', () => {
    for (const [type, payload] of [
      ['setActiveScene', { sceneId: 's2' }],
      ['setFog', { sceneId: 's1', enabled: true }],
      ['removeWall', { sceneId: 's1', wallId: 'w1' }],
      ['toggleLoreReveal', { folderId: 'x' }],
      ['clearChat', {}],
      ['setExplored', { sceneId: 's1' }],
      ['toggleTokenPublic', { placementId: 't-orc', part: 'sheet' }],
    ] as const) {
      expect(run(type, payload).ok, type).toBe(false);
      expect(run(type, payload, gm).ok, type).toBe(true);
    }
  });

  it('jogador move o próprio token, não o dos outros', () => {
    expect(run('moveToken', { placementId: 't-ana', x: 150, y: 100 }).ok).toBe(true);
    expect(run('moveToken', { placementId: 't-orc', x: 150, y: 100 }).ok).toBe(false);
    expect(run('moveTokens', { moves: [{ placementId: 't-ana', x: 1, y: 1 }, { placementId: 't-orc', x: 2, y: 2 }] }).ok).toBe(false);
  });

  it('paredes e portas fechadas bloqueiam o jogador; o mestre move livre', () => {
    expect(run('moveToken', { placementId: 't-ana', x: 400, y: 100 }).reason).toMatch(/parede/);
    expect(run('moveToken', { placementId: 't-ana', x: 400, y: 450 }).ok).toBe(false);
    expect(run('moveToken', { placementId: 't-ana', x: 400, y: 100 }, gm).ok).toBe(true);
  });

  it('paredes valem em todo movimento do jogador: só x ou só y, camada, segundo token e outra cena', () => {
    // x e y em comandos separados: cada um passa pela parede
    expect(run('updatePlacement', { placementId: 't-ana', patch: { x: 400 } }).reason).toMatch(/parede/);
    expect(run('updatePlacement', { placementId: 't-ana', patch: { x: 200 } }).ok).toBe(true);
    // Trocar de camada é do mestre
    expect(run('updatePlacement', { placementId: 't-ana', patch: { level: 1 } }).ok).toBe(false);
    expect(run('updatePlacement', { placementId: 't-ana', patch: { level: 1 } }, gm).ok).toBe(true);
    // Um token por ficha na cena (um segundo, do outro lado da parede, seria um atalho)
    const copy = { id: 't-ana-2', entryId: 'pc-ana', x: 400, y: 100 };
    expect(run('placeToken', { sceneId: 's1', placement: copy }).reason).toMatch(/já tem um token/);
    expect(run('placeToken', { sceneId: 's1', placement: copy }, gm).ok).toBe(true);
    // Só na camada dos jogadores
    expect(run('placeToken', { sceneId: 's1', placement: { id: 't-pet', entryId: 'npc-pet', x: 1, y: 1, level: 1 } }).ok).toBe(false);
    // Token numa cena que não está aberta: o jogador nem a vê
    const elsewhere = { ...table(), activeSceneId: 's2' };
    expect(run('moveToken', { placementId: 't-ana', x: 150, y: 100 }, ana, elsewhere).ok).toBe(false);
  });

  it('personagem de outro jogador não é editável (diferente do modo local)', () => {
    expect(run('updateEntry', { entryId: 'pc-bia', patch: { name: 'Hackeada' } }).ok).toBe(false);
    expect(run('updateEntry', { entryId: 'pc-ana', patch: { name: 'Ana Clara' } }).ok).toBe(true);
  });

  it('jogador não escolhe controlador, não vincula a outra conta nem altera o SN dos estudos', () => {
    expect(run('updateEntry', { entryId: 'pc-ana', patch: { controllerUserId: 'u-ana' } }).ok).toBe(false);
    expect(run('updateEntry', { entryId: 'pc-ana', patch: { ownerUserId: 'u-bia' } }).ok).toBe(false);
    const studies = [{ id: 'study-1', text: 'Esgrima', sa: 0, sn: 1 }];
    expect(run('updateEntry', { entryId: 'pc-ana', patch: { sheet: { ...sheet(['A']), studies } } }).reason).toMatch(/SN/);
    expect(run('updateEntry', { entryId: 'pc-ana', patch: { sheet: { ...sheet(['A']), studies } } }, gm).ok).toBe(true);
  });

  it('NPC: só quem controla edita; ações do mestre não são do jogador', () => {
    expect(run('updateEntry', { entryId: 'npc-pet', patch: { name: 'Lobo Alfa' } }).ok).toBe(true);
    expect(run('updateEntry', { entryId: 'npc-orc', patch: { name: 'x' } }).ok).toBe(false);
    expect(run('updateEntry', { entryId: 'act-gm', patch: { name: 'x' } }).ok).toBe(false);
    expect(run('removeEntry', { entryId: 'act-ana' }).ok).toBe(true);
  });

  it('personagem criado pelo jogador fica sempre com a conta dele', () => {
    const entry = { id: 'pc-nova', kind: 'character', name: 'Nova', createdAt: 1, ownerUserId: 'u-bia', controllerUserId: 'u-ana' };
    const result = run('addEntry', { entry });
    expect(result.ok).toBe(true);
    expect(result.payload.entry.ownerUserId).toBe('u-ana');
    expect(result.payload.entry.controllerUserId).toBeUndefined();
    expect(run('addEntry', { entry: { id: 'npc-x', kind: 'npc', name: 'x', createdAt: 1 } }).ok).toBe(false);
  });

  it('jogador não cria anotação secreta nem mexe nas do mestre', () => {
    const note = { id: 'n-novo', x: 0, y: 0, title: 'x', text: '', color: '#ffffff', gmOnly: true };
    expect(run('addNote', { sceneId: 's1', note }).payload.note.gmOnly).toBe(false);
    expect(run('removeNote', { sceneId: 's1', noteId: 'n-gm' }).ok).toBe(false);
    expect(run('updateNote', { sceneId: 's1', noteId: 'n-pub', patch: { gmOnly: true } }).ok).toBe(false);
  });

  it('jogador só mexe na cena aberta', () => {
    const stroke = { id: 'st', points: [{ x: 0, y: 0 }], color: '#ffffff', width: 4, opacity: 1 };
    expect(run('addStroke', { sceneId: 's1', stroke }).ok).toBe(true);
    expect(run('addStroke', { sceneId: 's2', stroke }).ok).toBe(false);
  });

  it('efeito fixo: dono carimbado; só o dono e o mestre removem', () => {
    const fx = { id: 'fx-novo', kind: 'heal', color: '#22c55e', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, seed: 3, scale: 1, ownerUserId: 'u-bia' };
    expect(run('addFixedFx', { sceneId: 's1', fx }).payload.fx.ownerUserId).toBe('u-ana');
    expect(run('removeFixedFx', { sceneId: 's1', fxId: 'fx-bia' }).ok).toBe(false);
    expect(run('removeFixedFx', { sceneId: 's1', fxId: 'fx-bia' }, { role: 'player', userId: 'u-bia' }).ok).toBe(true);
  });

  it('chat: autor, conta, papel e horário vêm do servidor', () => {
    const message = { id: 'm1', at: 0, userId: 'u-gm', author: 'Mestre', role: 'gm', text: 'confia' };
    const result = run('addChatMessage', { message });
    expect(result.payload.message).toMatchObject({ userId: 'u-ana', author: 'Ana', role: 'player', at: 42 });
  });

  it('ids repetidos e mesa cheia são recusados', () => {
    const scene = { id: 's1', name: 'Dup', gridSize: 70, showGrid: true };
    expect(run('addScene', { scene }, gm).ok).toBe(false);
    const parsed = COMMAND_SCHEMAS.addScene.parse({ scene: { ...scene, id: 's9' } });
    expect(COMMAND_RULES.addScene(parsed, { state: table(), viewer: gm, userName: 'Mestre', now: 0, full: true, world }).ok).toBe(false);
  });
});

// --- Ficha ---------------------------------------------------------------------------------

describe('ficha: regras do servidor para o jogador', () => {
  const updateSheet = (s: unknown, viewer = ana) => run('updateEntry', { entryId: 'pc-ana', patch: { sheet: s } }, viewer);
  const updateBars = (b: unknown, viewer = ana) => run('updateEntry', { entryId: 'pc-ana', patch: { token: { ...token(), bars: b } } }, viewer);

  it('esquema: níveis fora das regras e campos desconhecidos são recusados (até para o mestre)', () => {
    const [first] = sheet(['A']).themes;
    const withTag = (level: number) => ({ ...sheet(['A']), themes: [{ ...first, tags: [{ id: 'x', text: 'X', level }] }] });
    expect(updateSheet(withTag(6), gm).ok).toBe(true);
    expect(updateSheet(withTag(99), gm).ok).toBe(false);
    expect(updateSheet({ ...sheet(['A']), themes: [{ ...first, flaws: [{ id: 'f', text: 'F', level: 2 }] }] }, gm).ok).toBe(false);
    expect(updateSheet({ ...sheet(['A']), eiros: -1 }, gm).ok).toBe(false);
    expect(updateSheet({ ...sheet(['A']), admin: true }, gm).ok).toBe(false);
  });

  it('jogador muda o valor das barras de status, mas não o máximo nem as remove; o mestre muda', () => {
    const hurt = bars().map((b) => (b.id === 'status-body' ? { ...b, value: 10 } : b));
    const stronger = bars().map((b) => (b.id === 'status-body' ? { ...b, max: 99 } : b));
    expect(updateBars(hurt).ok).toBe(true);
    expect(updateBars(stronger).reason).toMatch(/máximo/);
    expect(updateBars(bars().slice(1)).reason).toMatch(/removidas/);
    expect(updateBars(stronger, gm).ok).toBe(true);
  });

  it('raça: o servidor aplica a do mundo (rótulos e máximo); o que o cliente diz ter aplicado é ignorado', () => {
    const forged = { ...sheet(['A']), raceRef: { id: 'elfo' }, race: 'Elfo', appliedRaces: { race: { labels: [], mods: { 'status-mind': 50 } } } };
    const result = updateSheet(forged);
    expect(result.ok).toBe(true);
    expect(result.payload.patch.sheet.appliedRaces.race.mods).toEqual({ 'status-mind': 2 });
    expect(result.payload.patch.sheet.labels).toEqual(['A', 'Visão no escuro']);
    expect(result.payload.patch.token.bars.find((b: { id: string }) => b.id === 'status-mind').max).toBe(26);

    expect(updateSheet({ ...sheet(['A']), raceRef: { id: 'reliquia' } }).reason).toMatch(/Raça/);
    // Sem trocar a raça, o "aplicado" forjado some (vale o gravado)
    const sneaky = { ...sheet(['A']), appliedRaces: { race: { labels: [], mods: { 'status-mind': 50 } } } };
    expect(updateSheet(sneaky).payload.patch.sheet.appliedRaces).toBeUndefined();
  });

  it('inventário: item do mundo só se revelado; item da mesa só se existe', () => {
    const withItem = (item: object) => ({ ...sheet(['A']), inventory: [{ id: 'linha', ...item }] });
    expect(updateSheet(withItem({ itemId: 'espada' })).ok).toBe(true);
    expect(updateSheet(withItem({ itemId: 'reliquia' })).ok).toBe(false);
    expect(updateSheet(withItem({ itemId: 'nao-existe', table: true })).ok).toBe(false);
    expect(updateSheet(withItem({ itemId: 'reliquia' }), gm).ok).toBe(true);
  });

  it('token novo do jogador leva só a posição (ficha, barras e liberações vêm da ficha de origem)', () => {
    const placement = { id: 't-pet', entryId: 'npc-pet', x: 1, y: 1, bars: bars(), sheet: sheet(['forjada']), size: 6, sheetPublic: true };
    expect(run('placeToken', { sceneId: 's1', placement }).payload.placement).toEqual({ id: 't-pet', entryId: 'npc-pet', x: 1, y: 1 });
  });

  it('personagem novo do jogador começa com o máximo padrão das barras', () => {
    const entry = { id: 'pc-nova', kind: 'character', name: 'Nova', createdAt: 1, token: { ...token(), bars: bars().map((b) => ({ ...b, max: 99 })) } };
    expect(run('addEntry', { entry }).reason).toMatch(/máximo/);
    expect(run('addEntry', { entry: { ...entry, token: token() } }).ok).toBe(true);
  });
});

// --- Projeção --------------------------------------------------------------------------

describe('o que cada um recebe (projeção)', () => {
  it('o mestre recebe tudo', () => {
    const state = table();
    expect(viewOf(state, gm)).toBe(state);
  });

  it('o jogador não recebe cenas em preparação, anotações secretas nem pastas de cenas', () => {
    const view = viewOf(table());
    expect(view.scenes.map((s) => s.id)).toEqual(['s1']);
    expect(view.scenes[0].notes?.map((n) => n.id)).toEqual(['n-pub']);
    expect(view.sceneFolders).toEqual([]);
  });

  it('fichas de NPC: só as que controla; de tokens, só o liberado', () => {
    const view = viewOf(table());
    expect(view.entries.find((e) => e.id === 'npc-orc')?.sheet).toBeUndefined();
    expect(view.entries.find((e) => e.id === 'npc-pet')?.sheet).toBeDefined();
    const tokens = view.scenes[0].tokens!;
    expect(tokens.find((t) => t.id === 't-orc')?.sheet).toBeUndefined();
    expect(tokens.find((t) => t.id === 't-orc2')?.sheet).toEqual({ inventory: [] });
  });

  it('ações: só as dele; anotações pessoais dos outros personagens somem', () => {
    const view = viewOf(table());
    expect(view.entries.filter((e) => e.kind === 'automation').map((e) => e.id)).toEqual(['act-ana']);
    expect(view.entries.find((e) => e.id === 'pc-bia')?.sheet?.notes).toEqual([]);
    expect(view.entries.find((e) => e.id === 'pc-ana')?.sheet?.notes).toHaveLength(1);
  });

  it('lore: só pastas reveladas; NPCs da mesa sem a ficha base', () => {
    const items = [
      { id: 'pasta-publica', type: 'folder', name: 'Pública', parentId: null, createdAt: 0, updatedAt: 0 },
      { id: 'doc-publico', type: 'document', name: 'Lenda', parentId: 'pasta-publica', createdAt: 0, updatedAt: 0 },
      { id: 'doc-secreto', type: 'document', name: 'Plano do vilão', parentId: null, createdAt: 0, updatedAt: 0 },
      { id: 'bestia', type: 'npc', name: 'Dragão', parentId: null, createdAt: 0, updatedAt: 0, sheet: { labels: ['fraqueza: gelo'] } },
    ] as never[];
    const ref = { id: 'ref', kind: 'npc', name: 'Dragão', createdAt: 0, worldNpcId: 'bestia' } as TableEntry;
    const hidden = { ...table(), entries: [...table().entries, ref] };
    // NPC do bestiário fora do mapa: o jogador nem sabe que ele está na mesa
    expect(projectLore(items, viewOf(hidden), ana).map((i) => i.id).sort()).toEqual(['doc-publico', 'pasta-publica']);

    const state = withScene(hidden, { tokens: [{ id: 't-dragao', entryId: 'ref', x: 10, y: 10 }] });
    const lore = projectLore(items, viewOf(state), ana);
    expect(lore.map((i) => i.id).sort()).toEqual(['bestia', 'doc-publico', 'pasta-publica']);
    expect(lore.find((i) => i.id === 'bestia')?.sheet).toBeUndefined();
    expect(projectLore(items, state, gm)).toHaveLength(4);
  });
});

describe('névoa: o jogador só recebe o que algum token enxerga', () => {
  /**
   * Ana (100, 100) enxerga 840 px; as paredes em x = 300 escondem o lado direito. Os NPCs ficam
   * sem visão (padrão): token com visão ligada revela o mapa ao grupo, como no front-end.
   */
  const blind = (e: TableEntry): TableEntry => (e.kind === 'npc' ? { ...e, token: { ...token(), vision: { enabled: false, range: 18 } } } : e);
  const fogged = () =>
    withScene(
      {
        ...table(),
        entries: [...table().entries.map(blind), { id: 'som', kind: 'sound', name: 'Tema do chefe', createdAt: 1 } as TableEntry],
      },
      {
        fog: { enabled: true },
        walls: [
          { id: 'w1', kind: 'line', points: [{ x: 300, y: -1000 }, { x: 300, y: 400 }] },
          { id: 'd1', kind: 'door', points: [{ x: 300, y: 400 }, { x: 300, y: 500 }], open: false },
          { id: 'w2', kind: 'line', points: [{ x: 300, y: 500 }, { x: 300, y: 2000 }] },
          { id: 'd-longe', kind: 'door', points: [{ x: 800, y: 100 }, { x: 800, y: 200 }], open: false },
        ],
        notes: [
          { id: 'n-perto', x: 150, y: 150, title: 'Placa', text: '', color: '#facc15', gmOnly: false },
          { id: 'n-longe', x: 600, y: 150, title: 'Mapa do tesouro', text: '', color: '#facc15', gmOnly: false },
        ],
        drops: [
          { id: 'drop-perto', x: 150, y: 150, item: { id: 'i1', itemId: 'x' } },
          { id: 'drop-longe', x: 600, y: 150, item: { id: 'i2', itemId: 'y' } },
        ],
        effects: [
          { id: 'fx-perto', kind: 'explosion', color: '#ef4444', from: { x: 150, y: 150 }, to: { x: 160, y: 160 }, seed: 1, scale: 1 },
          { id: 'fx-longe', kind: 'explosion', color: '#ef4444', from: { x: 600, y: 150 }, to: { x: 610, y: 160 }, seed: 1, scale: 1 },
        ],
      },
    );

  it('tokens, anotações, itens e efeitos sob a névoa não são enviados', () => {
    const view = viewOf(fogged());
    const [scene] = view.scenes;
    expect(scene.tokens?.map((t) => t.id)).toEqual(['t-ana']);
    expect(scene.notes?.map((n) => n.id)).toEqual(['n-perto']);
    expect(scene.drops?.map((d) => d.id)).toEqual(['drop-perto']);
    expect(scene.effects?.map((f) => f.id)).toEqual(['fx-perto']);
    expect(JSON.stringify(view)).not.toMatch(/Mapa do tesouro|drop-longe|t-orc/);
  });

  it('paredes não vão ao jogador (revelariam a planta): só as portas vistas, e os polígonos à parte', () => {
    const state = fogged();
    expect(viewOf(state).scenes[0].walls?.map((w) => w.id)).toEqual(['d1']);
    expect(playerVision(ana, sceneOf(state))).toHaveLength(1);
    expect(playerVision(gm, sceneOf(state))).toBeNull();
    // Sem névoa: as paredes da camada vão (o mapa todo está à vista), sem polígonos
    expect(viewOf(table()).scenes[0].walls).toHaveLength(2);
    expect(playerVision(ana, sceneOf(table()))).toBeNull();
  });

  it('NPC fora da vista e sons não são enviados; o NPC que controla, sim', () => {
    const ids = viewOf(fogged()).entries.map((e) => e.id);
    expect(ids).not.toContain('npc-orc');
    expect(ids).not.toContain('som');
    expect(ids).toContain('npc-pet');
    expect(viewOf(fogged(), gm).entries.map((e) => e.id)).toContain('som');
  });

  it('o token que entra na visão passa a ser enviado', () => {
    const state = fogged();
    const tokens = state.scenes[0].tokens?.map((t) => (t.id === 't-orc' ? { ...t, x: 200 } : t));
    const moved = withScene(state, { tokens });
    expect(viewOf(moved).scenes[0].tokens?.map((t) => t.id)).toEqual(['t-ana', 't-orc']);
    expect(viewOf(moved).entries.map((e) => e.id)).toContain('npc-orc');
  });

  it('eventos: só da cena aberta; efeitos só se visíveis; o mestre recebe todos', () => {
    const view = sceneOf(fogged());
    const fx = (x: number) => ({
      kind: 'fx' as const,
      sceneId: 's1',
      fx: { kind: 'bolt', color: '#fff', from: { x, y: 150 }, to: { x, y: 160 }, seed: 1, scale: 1 },
    });
    expect(eventVisibleTo({ kind: 'ping', sceneId: 's2', x: 0, y: 0 }, ana, view)).toBe(false);
    expect(eventVisibleTo({ kind: 'ping', sceneId: 's1', x: 600, y: 150 }, ana, view)).toBe(true);
    expect(eventVisibleTo(fx(150), ana, view)).toBe(true);
    expect(eventVisibleTo(fx(600), ana, view)).toBe(false);
    expect(eventVisibleTo(fx(600), gm, null)).toBe(true);
  });
});

// --- Rolagem no servidor -----------------------------------------------------------------

describe('rolagem no servidor', () => {
  const fixed = () => 0.5; // cada d12 = 7
  const roll = (attributes: string[] = [], extra = {}) => ({ dice: '2d12' as const, modifier: 1, attributes, ...extra });

  it('recalcula o modificador com os níveis atuais da ficha', () => {
    const result = performRoll(table(), { sheetId: 'pc-ana', roll: roll(['forca', 'medo']), label: 'Golpe', icon: 'swords' }, ana, 'Ana', 1, 'm', fixed);
    expect(result.ok && result.message.roll).toMatchObject({ rolls: [7, 7], modifier: 2, total: 16, outcome: 'partial' });
  });

  it('não rola por ficha de outra conta', () => {
    const result = performRoll(table(), { sheetId: 'pc-bia', roll: roll(), label: '', icon: '' }, ana, 'Ana', 1, 'm', fixed);
    expect(result.ok).toBe(false);
  });

  it('tag mágica gasta Espírito; sem Espírito suficiente, não rola', () => {
    const ok = performRoll(table(), { sheetId: 'pc-ana', roll: roll(['fogo'], { powers: { fogo: 3 } }), label: 'Bola de fogo', icon: '' }, ana, 'Ana', 1, 'm', fixed);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.message.roll?.mana).toBe(3);
      expect(ok.commands[0]).toMatchObject({ type: 'updateEntry', payload: { entryId: 'pc-ana' } });
    }
    const state = table();
    state.entries[0] = { ...state.entries[0], token: token(1) };
    const refused = performRoll(state, { sheetId: 'pc-ana', roll: roll(['fogo']), label: '', icon: '' }, ana, 'Ana', 1, 'm', fixed);
    expect(refused.ok).toBe(false);
  });

  it('o sorteio fica entre 1 e o número de faces', () => {
    for (const r of [0, 0.999999]) {
      const result = performRoll(table(), { roll: { dice: '3d6', modifier: 0 }, label: '', icon: '' }, gm, 'Mestre', 1, 'm', () => r);
      expect(result.ok && result.message.roll?.rolls.every((d) => d >= 1 && d <= 6)).toBe(true);
    }
  });
});
