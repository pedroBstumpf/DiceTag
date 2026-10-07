import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { GAME_SYSTEMS, GameTable, TABLE_ACCENTS } from '../../../core/models/game-table.model';
import { GameTablesService } from '../../../core/services/game-tables.service';

/**
 * Diálogo de criação de mesa.
 * Fecha retornando a mesa criada (ou undefined se cancelado).
 */
@Component({
  selector: 'app-create-table-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './create-table-dialog.html',
})
export class CreateTableDialog {
  private readonly tables = inject(GameTablesService);
  private readonly dialogRef = inject(MatDialogRef<CreateTableDialog, GameTable>);

  readonly systems = GAME_SYSTEMS;
  readonly accents = TABLE_ACCENTS;
  readonly saving = signal(false);

  // --- Formulário ----------------------------------------------------------
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    system: ['D&D 5e', Validators.required],
    description: ['', Validators.maxLength(400)],
    maxPlayers: [5, [Validators.required, Validators.min(1), Validators.max(20)]],
    accent: [TABLE_ACCENTS[0] as string],
  });

  /** Abre o diálogo de criação. */
  static open(dialog: MatDialog) {
    return dialog.open<CreateTableDialog, void, GameTable>(CreateTableDialog, {
      width: '520px',
      maxWidth: '94vw',
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const table = await this.tables.create(this.form.getRawValue());
    this.dialogRef.close(table);
  }
}
