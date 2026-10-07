import { TIMELINE_CARD, cardAt, cardsBounds, columnLayout, linkPath, placeConnected, treeLayout } from './timeline-layout';

describe('timeline-layout', () => {
  describe('columnLayout', () => {
    it('empilha os eventos em coluna, sem sobreposição', () => {
      const pos = columnLayout(3);
      expect(pos.map((p) => p.x)).toEqual([0, 0, 0]);
      expect(pos[1].y - pos[0].y).toBeGreaterThanOrEqual(TIMELINE_CARD.height);
      expect(pos[2].y - pos[1].y).toBeGreaterThanOrEqual(TIMELINE_CARD.height);
    });
  });

  describe('treeLayout', () => {
    // raiz → a, b, c; a e b → fim
    const ids = ['raiz', 'a', 'b', 'c', 'fim'];
    const links = [
      { from: 'raiz', to: 'a' },
      { from: 'raiz', to: 'b' },
      { from: 'raiz', to: 'c' },
      { from: 'a', to: 'fim' },
      { from: 'b', to: 'fim' },
    ];

    it('coloca cada evento numa coluna depois do antecessor', () => {
      const pos = treeLayout(ids, links);
      expect(pos.get('raiz')!.x).toBe(0);
      expect(pos.get('a')!.x).toBeGreaterThan(pos.get('raiz')!.x);
      expect(pos.get('fim')!.x).toBeGreaterThan(pos.get('a')!.x);
    });

    it('eventos paralelos ficam na mesma coluna, em linhas diferentes', () => {
      const pos = treeLayout(ids, links);
      const col = ['a', 'b', 'c'].map((id) => pos.get(id)!);
      expect(new Set(col.map((p) => p.x)).size).toBe(1);
      expect(new Set(col.map((p) => p.y)).size).toBe(3);
    });

    it('posiciona todos os eventos, inclusive soltos e em ciclo', () => {
      const pos = treeLayout(['x', 'y', 'solto'], [
        { from: 'x', to: 'y' },
        { from: 'y', to: 'x' },
      ]);
      expect(pos.size).toBe(3);
    });

    it('ignora links para eventos inexistentes', () => {
      const pos = treeLayout(['a'], [{ from: 'a', to: 'fantasma' }]);
      expect(pos.get('a')).toEqual({ x: 0, y: 0 });
    });
  });

  describe('placeConnected', () => {
    it('cria à direita do evento de origem', () => {
      const spot = placeConnected({ x: 0, y: 0 }, 'right', []);
      expect(spot.x).toBeGreaterThanOrEqual(TIMELINE_CARD.width);
      expect(spot.y).toBe(0);
    });

    it('procura espaço livre quando o lugar está ocupado', () => {
      const first = placeConnected({ x: 0, y: 0 }, 'right', []);
      const second = placeConnected({ x: 0, y: 0 }, 'right', [{ x: 0, y: 0 }, first]);
      expect(second.x).toBe(first.x);
      expect(second.y).toBeGreaterThanOrEqual(first.y + TIMELINE_CARD.height);
    });
  });

  describe('linkPath', () => {
    it('sai pela lateral direita quando o destino está à direita', () => {
      const { d, mid } = linkPath({ x: 0, y: 0 }, { x: 400, y: 0 });
      expect(d.startsWith(`M${TIMELINE_CARD.width},${TIMELINE_CARD.height / 2}`)).toBe(true);
      expect(mid.y).toBeCloseTo(TIMELINE_CARD.height / 2);
    });

    it('sai pela base quando o destino está abaixo', () => {
      const { d } = linkPath({ x: 0, y: 0 }, { x: 0, y: 400 });
      expect(d.startsWith(`M${TIMELINE_CARD.width / 2},${TIMELINE_CARD.height}`)).toBe(true);
    });
  });

  it('cardAt encontra o cartão sob o ponto', () => {
    const cards = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }];
    expect(cardAt(cards, { x: 310, y: 10 })?.id).toBe('b');
    expect(cardAt(cards, { x: 250, y: 10 })).toBeUndefined();
  });

  it('cardsBounds envolve todos os cartões', () => {
    expect(cardsBounds([])).toBeNull();
    expect(cardsBounds([{ x: 0, y: 0 }, { x: 100, y: 50 }])).toEqual({
      x: 0,
      y: 0,
      width: 100 + TIMELINE_CARD.width,
      height: 50 + TIMELINE_CARD.height,
    });
  });
});
