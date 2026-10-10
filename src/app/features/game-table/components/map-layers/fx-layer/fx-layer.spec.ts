import { TestBed } from '@angular/core/testing';
import { buildFx, seededRandom } from '../../../utils/effects';
import { FxLayer } from './fx-layer';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('FxLayer', () => {
  it('desenha as partes do efeito como SVG, com atributos, gradientes e animação', async () => {
    const drawing = buildFx('explosion', '#ff7a1a', { x: 100, y: 100 }, { x: 200, y: 100 }, { uid: 'fx-a', scale: 1, grid: 70, random: seededRandom(1) });
    const fixture = TestBed.createComponent(FxLayer);
    fixture.componentRef.setInput('effects', [{ id: 'a', drawing }]);
    fixture.componentRef.setInput('current', { kind: 'explosion', color: '#ff7a1a' });
    fixture.componentRef.setInput('scale', 1);
    fixture.componentRef.setInput('width', 1000);
    fixture.componentRef.setInput('height', 800);
    fixture.detectChanges();
    await fixture.whenStable();

    const root: HTMLElement = fixture.nativeElement;
    const circles = Array.from(root.querySelectorAll('circle'));
    expect(circles.length).toBeGreaterThan(10);
    // Elementos criados pelo template recursivo continuam no namespace SVG
    for (const c of circles) expect(c.namespaceURI).toBe(SVG_NS);
    expect(circles.some((c) => c.getAttribute('style')?.includes('fx-blast'))).toBe(true);
    expect(circles.every((c) => c.hasAttribute('r'))).toBe(true);

    // Todo gradiente do desenho existe no <defs>
    for (const g of drawing.gradients) expect(root.querySelector(`#${g.id}`)).not.toBeNull();
    expect(root.querySelector('g')?.getAttribute('transform')).toBe(drawing.transform);
  });

  it('efeito fixo se repete: ao fim de cada ciclo o desenho é recriado e continua na tela', async () => {
    vi.useFakeTimers();
    try {
      const drawing = buildFx('vortex', '#000000', { x: 100, y: 100 }, { x: 200, y: 100 }, { uid: 'fx-f', scale: 1, grid: 70, random: seededRandom(1) });
      const fixture = TestBed.createComponent(FxLayer);
      fixture.componentRef.setInput('effects', []);
      fixture.componentRef.setInput('fixed', [{ id: 'f', drawing }]);
      fixture.componentRef.setInput('current', { kind: 'vortex', color: '#000000' });
      fixture.componentRef.setInput('scale', 1);
      fixture.componentRef.setInput('width', 1000);
      fixture.componentRef.setInput('height', 800);
      fixture.detectChanges();

      const root: HTMLElement = fixture.nativeElement;
      const first = root.querySelector('svg > g');
      expect(first).not.toBeNull();

      // Ainda no primeiro ciclo: o mesmo desenho
      vi.advanceTimersByTime(drawing.duration / 2);
      fixture.detectChanges();
      expect(root.querySelector('svg > g')).toBe(first);

      // Depois da animação + pausa: desenho novo (animações reiniciadas), ainda no mapa
      vi.advanceTimersByTime(drawing.duration);
      fixture.detectChanges();
      const second = root.querySelector('svg > g');
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
      expect(second?.getAttribute('transform')).toBe(drawing.transform);
    } finally {
      vi.useRealTimers();
    }
  });
});
