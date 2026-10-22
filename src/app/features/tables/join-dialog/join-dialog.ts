import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GameTable } from '../../../core/models/game-table.model';
import { GameTablesService } from '../../../core/services/game-tables.service';
import { TableMembersService } from '../../../core/services/table-members.service';

/**
 * "Entrar com convite" (modo online): a pessoa cola o código que recebeu do mestre e passa a
 * participar da mesa como jogadora. Fecha devolvendo a mesa em que entrou.
 */
@Component({
  selector: 'app-join-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './join-dialog.html',
})
export class JoinDialog {
  private readonly members = inject(TableMembersService);
  private readonly tables = inject(GameTablesService);
  private readonly dialogRef = inject(MatDialogRef<JoinDialog, GameTable>);

  /** Código como o servidor gera: letras, números, "-" e "_". */
  readonly code = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\s*[A-Za-z0-9_-]{10,100}\s*$/)],
  });
  readonly busy = signal(false);
  readonly error = signal('');

  static open(dialog: MatDialog) {
    return dialog.open<JoinDialog, void, GameTable>(JoinDialog, { width: '440px', maxWidth: '94vw', autoFocus: 'first-tabbable' });
  }

  async submit(event?: Event): Promise<void> {
    // Formulário sem FormGroup: o envio padrão recarregaria a página
    event?.preventDefault();
    if (this.code.invalid) {
      this.code.markAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const table = await this.members.acceptInvite(this.code.value);
      await this.tables.reload();
      this.dialogRef.close(table);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.');
    } finally {
      this.busy.set(false);
    }
  }
}
