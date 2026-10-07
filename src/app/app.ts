import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Componente raiz: apenas hospeda o roteador. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
