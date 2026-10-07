import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Foca (e seleciona o texto de) um campo assim que ele aparece na tela.
 * Útil para campos criados dinamicamente, onde o atributo `autofocus` não funciona.
 */
@Directive({ selector: '[appAutoFocus]' })
export class AutoFocus {
  constructor() {
    const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      el.focus();
      el.select?.();
    });
  }
}
