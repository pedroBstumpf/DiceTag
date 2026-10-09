import { Point } from '../../../core/models/geometry.model';
import { ExploredData } from '../../../core/models/table-session.model';

/**
 * Memória da névoa ("áreas exploradas") — funções puras, sem Angular.
 *
 * O mapa é dividido em células pequenas; cada célula vista por algum token
 * fica marcada. A máscara é um bitset (1 bit por célula) salvo em base64 na
 * cena: um mapa de 2100×1400 ocupa ~4 KB.
 */

/** Máscara em memória (bits descompactados para leitura/escrita rápidas). */
export interface ExploredMask {
  /** Lado da célula, em px do mapa. */
  cell: number;
  cols: number;
  rows: number;
  /** Bitset: célula (c, r) = bit c + r × cols. */
  bits: Uint8Array;
}

/** Até ~600 células no lado maior: precisão boa sem crescer demais em mapas grandes. */
const MAX_CELLS_PER_SIDE = 600;
const MIN_CELL = 10;

/** Cria uma máscara vazia para um mapa de w×h px. */
export function createMask(width: number, height: number): ExploredMask {
  const cell = Math.max(MIN_CELL, Math.ceil(Math.max(width, height) / MAX_CELLS_PER_SIDE));
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  return { cell, cols, rows, bits: new Uint8Array(Math.ceil((cols * rows) / 8)) };
}

/** A máscara serve para um mapa deste tamanho? (trocar o mapa recomeça a memória) */
export function maskFits(mask: ExploredMask, width: number, height: number): boolean {
  const fresh = createMask(width, height);
  return fresh.cell === mask.cell && fresh.cols === mask.cols && fresh.rows === mask.rows;
}

/** Célula (c, r) explorada? */
export function isCellExplored(mask: ExploredMask, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= mask.cols || r >= mask.rows) return false;
  const i = r * mask.cols + c;
  return (mask.bits[i >> 3] & (1 << (i & 7))) !== 0;
}

/** O ponto do mapa está numa área explorada? */
export function isExploredAt(mask: ExploredMask, p: Point): boolean {
  return isCellExplored(mask, Math.floor(p.x / mask.cell), Math.floor(p.y / mask.cell));
}

/**
 * Marca as células cujo centro está dentro de algum polígono (preenchimento por
 * linhas de varredura: barato mesmo com polígonos de muitos vértices).
 * Altera a máscara recebida e retorna true se alguma célula nova foi marcada.
 */
export function markPolygons(mask: ExploredMask, polygons: Point[][]): boolean {
  let changed = false;
  const { cell, cols, rows, bits } = mask;

  for (const poly of polygons) {
    if (poly.length < 3) continue;
    const ys = poly.map((p) => p.y);
    const r0 = Math.max(0, Math.floor(Math.min(...ys) / cell));
    const r1 = Math.min(rows - 1, Math.floor(Math.max(...ys) / cell));

    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * cell;
      // Cruzamentos das arestas com a linha horizontal no centro da fileira
      const xs: number[] = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((p, q) => p - q);

      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] / cell - 0.5));
        const c1 = Math.min(cols - 1, Math.floor(xs[k + 1] / cell - 0.5));
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          const bit = 1 << (i & 7);
          if (!(bits[i >> 3] & bit)) {
            bits[i >> 3] |= bit;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

// --- Serialização --------------------------------------------------------------

export function encodeMask(mask: ExploredMask): ExploredData {
  let binary = '';
  // Em blocos, para não estourar a pilha com mapas grandes
  for (let i = 0; i < mask.bits.length; i += 0x8000) {
    binary += String.fromCharCode(...mask.bits.subarray(i, i + 0x8000));
  }
  return { cell: mask.cell, cols: mask.cols, rows: mask.rows, data: btoa(binary) };
}

export function decodeMask(data: ExploredData): ExploredMask {
  const binary = atob(data.data);
  const bits = new Uint8Array(Math.ceil((data.cols * data.rows) / 8));
  for (let i = 0; i < Math.min(binary.length, bits.length); i++) bits[i] = binary.charCodeAt(i);
  return { cell: data.cell, cols: data.cols, rows: data.rows, bits };
}
