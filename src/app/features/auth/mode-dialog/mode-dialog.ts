import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiClient } from '../../../core/api/api-client';
import { APP_MODE, AppMode, readAppMode, saveAppMode } from '../../../core/config/app-mode';

/** Abertura do diálogo: na primeira vez é obrigatório escolher (sem fechar). */
export interface ModeDialogData {
  firstTime: boolean;
}

/** Opção exibida no diálogo. */
interface ModeOption {
  mode: AppMode;
  icon: string;
  title: string;
  description: string;
}

/**
 * Escolha de onde o app guarda os dados: online (servidor, contas reais, jogo com outras
 * pessoas) ou offline (só neste navegador, como sempre foi). Aparece na primeira vez e pelo menu
 * da conta. Trocar de modo recarrega o app (os repositórios são escolhidos ao iniciar).
 */
@Component({
  selector: 'app-mode-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './mode-dialog.html',
})
export class ModeDialog {
  private readonly api = inject(ApiClient);
  private readonly dialogRef = inject(MatDialogRef<ModeDialog>);
  readonly data = inject<ModeDialogData>(MAT_DIALOG_DATA);
  /** Modo com que o app foi iniciado (sem escolha salva, offline). */
  private readonly running = inject(APP_MODE);
  /** Modo escolhido antes (destacado no diálogo); null na primeira vez. */
  readonly current = readAppMode() ? this.running : null;

  readonly checking = signal(false);
  readonly error = signal('');

  readonly options: ModeOption[] = [
    {
      mode: 'online',
      icon: 'cloud',
      title: 'Online',
      description: 'Conta no servidor: convide amigos e jogue junto, de qualquer computador. Precisa do servidor ligado.',
    },
    {
      mode: 'offline',
      icon: 'computer',
      title: 'Offline',
      description: 'Tudo fica só neste navegador, como até agora. Sem contas reais e sem jogo com outras pessoas.',
    },
  ];

  /** Abre o diálogo (na primeira vez, sem como fechar até escolher). */
  static open(dialog: MatDialog, data: ModeDialogData) {
    return dialog.open<ModeDialog, ModeDialogData>(ModeDialog, {
      data,
      width: '520px',
      maxWidth: '94vw',
      disableClose: data.firstTime,
      autoFocus: 'first-tabbable',
    });
  }

  async choose(mode: AppMode): Promise<void> {
    this.error.set('');
    if (mode === 'online') {
      // Só troca se o servidor responder: senão a pessoa ficaria num app sem dados
      this.checking.set(true);
      const up = await this.api.health();
      this.checking.set(false);
      if (!up) {
        this.error.set('O servidor não respondeu. Ligue-o (pasta server: npm run dev) e tente de novo, ou jogue offline.');
        return;
      }
    }
    saveAppMode(mode);
    // Repositórios e sessão são do modo em uso: outro modo pede um recomeço do app
    if (mode !== this.running) location.reload();
    else this.dialogRef.close(mode);
  }
}
