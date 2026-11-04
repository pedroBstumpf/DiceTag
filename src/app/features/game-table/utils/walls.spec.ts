import { Wall } from '../../../core/models/table-session.model';
import { wallsToSegments } from './visibility';
import { distanceToWall, handleAt, movePathBlocked, moveWallHandle, translateWall, wallHandles } from './walls';

const line: Wall = { id: 'l', kind: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
const circle: Wall = { id: 'c', kind: 'circle', cx: 50, cy: 50, r: 10 };

describe('walls', () => {
  it('translateWall move todos os pontos ou o centro', () => {
    expect(translateWall(line, 10, 5)).toEqual({ ...line, points: [{ x: 10, y: 5 }, { x: 110, y: 5 }] });
    expect(translateWall(circle, -5, 5)).toEqual({ ...circle, cx: 45, cy: 55 });
  });

  it('wallHandles: pontos da linha e alça de raio do círculo', () => {
    expect(wallHandles(line)).toHaveLength(2);
    expect(wallHandles(circle)).toEqual([{ x: 60, y: 50 }]);
  });

  it('moveWallHandle altera só o ponto escolhido', () => {
    const moved = moveWallHandle(line, 1, { x: 100, y: 40 });
    expect(moved.kind === 'line' && moved.points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 40 }]);
  });

  it('moveWallHandle no círculo define o raio', () => {
    const moved = moveWallHandle(circle, 0, { x: 50, y: 80 });
    expect(moved.kind === 'circle' && moved.r).toBe(30);
  });

  it('distanceToWall mede até a linha ou a borda do círculo', () => {
    expect(distanceToWall(line, { x: 50, y: 4 })).toBe(4);
    expect(distanceToWall(circle, { x: 50, y: 50 })).toBe(10);
  });

  it('movePathBlocked: atravessar parede ou porta fechada bloqueia; porta aberta e caminho livre não', () => {
    const door = (open: boolean): Wall => ({ id: 'p', kind: 'door', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], open });
    const segs = wallsToSegments([line]);
    expect(movePathBlocked({ x: 50, y: -20 }, { x: 50, y: 20 }, segs)).toBe(true);
    expect(movePathBlocked({ x: 50, y: 10 }, { x: 60, y: 30 }, segs)).toBe(false);
    // Passa ao lado da ponta da parede
    expect(movePathBlocked({ x: 150, y: -20 }, { x: 150, y: 20 }, segs)).toBe(false);
    expect(movePathBlocked({ x: 50, y: 20 }, { x: 50, y: 80 }, wallsToSegments([door(false)]))).toBe(true);
    expect(movePathBlocked({ x: 50, y: 20 }, { x: 50, y: 80 }, wallsToSegments([door(true)]))).toBe(false);
    // Parede circular (pilar)
    expect(movePathBlocked({ x: 20, y: 50 }, { x: 50, y: 50 }, wallsToSegments([circle]))).toBe(true);
  });

  it('movePathBlocked: quem está sobre a parede pode sair dela', () => {
    expect(movePathBlocked({ x: 50, y: 0 }, { x: 50, y: 30 }, wallsToSegments([line]))).toBe(false);
  });

  it('handleAt encontra a alça dentro da tolerância', () => {
    expect(handleAt(line, { x: 98, y: 2 }, 5)).toBe(1);
    expect(handleAt(line, { x: 50, y: 0 }, 5)).toBe(-1);
  });
});
