import { InjectionToken } from '@angular/core';

/**
 * Onde os dados do app vivem:
 * - `offline`: só neste navegador (IndexedDB), como sempre foi — sem servidor, com o visitante;
 * - `online`: no servidor (`server/`), com contas reais, convites e (a partir da sala em tempo
 *   real) jogo com outras pessoas.
 *
 * A pessoa escolhe na entrada (`ModeDialog`) e pode trocar pelo menu da conta. A escolha fica
 * salva neste navegador; trocar recarrega o app, porque os repositórios de dados (`core/data`)
 * são escolhidos uma vez, ao iniciar.
 */
export type AppMode = 'offline' | 'online';

/** Chave da escolha no localStorage (prefixo `dicetag`, como as demais chaves do app). */
const MODE_KEY = 'dicetag.mode';

/** Modo escolhido neste navegador (null = ainda não escolheu: a entrada pergunta). */
export function readAppMode(): AppMode | null {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'online' || value === 'offline' ? value : null;
  } catch {
    // Navegador sem localStorage (aba privada restrita): segue offline
    return null;
  }
}

/** Grava a escolha (quem chama recarrega o app se o modo mudou). */
export function saveAppMode(mode: AppMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Sem localStorage, a escolha vale só até recarregar
  }
}

/** Modo em uso nesta execução do app (sem escolha salva, offline). */
export const APP_MODE = new InjectionToken<AppMode>('APP_MODE', {
  providedIn: 'root',
  factory: () => readAppMode() ?? 'offline',
});
