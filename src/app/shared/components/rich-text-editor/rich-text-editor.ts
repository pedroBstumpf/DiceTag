import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Editor } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';

/** Botão da barra de formatação. */
interface ToolbarButton {
  icon: string;
  label: string;
  run: (e: Editor) => void;
  isActive?: (e: Editor) => boolean;
}

/**
 * Editor de texto rico (Tiptap) com barra de formatação: títulos, negrito,
 * listas, citação, alinhamento…
 *
 * Usado pelos documentos do worldbuild e pelas anotações da ficha de personagem.
 * `content` é lido só ao criar o editor; para trocar de documento, recrie o
 * componente (ex.: `@for` com `track` pelo id). Cada edição emite `contentChange`
 * com o HTML. O conteúdo projetado (ex.: campo de título) fica acima do texto.
 */
@Component({
  selector: 'app-rich-text-editor',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './rich-text-editor.html',
  host: { class: 'flex min-h-0 flex-col' },
})
export class RichTextEditor {
  /** HTML inicial. */
  readonly content = input('');
  readonly placeholder = input('Comece a escrever…');
  /** HTML a cada alteração. */
  readonly contentChange = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private editor?: Editor;

  /** Incrementado a cada transação para atualizar o estado dos botões. */
  readonly tick = signal(0);
  readonly words = signal(0);

  // --- Barra de formatação (grupos separados por divisória) -----------------
  readonly toolbar: ToolbarButton[][] = [
    [
      { icon: 'undo', label: 'Desfazer (Ctrl+Z)', run: (e) => e.chain().focus().undo().run() },
      { icon: 'redo', label: 'Refazer (Ctrl+Y)', run: (e) => e.chain().focus().redo().run() },
    ],
    [1, 2, 3].map((level) => ({
      icon: `format_h${level}`,
      label: `Título ${level}`,
      run: (e: Editor) => e.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run(),
      isActive: (e: Editor) => e.isActive('heading', { level }),
    })),
    [
      { icon: 'format_bold', label: 'Negrito (Ctrl+B)', run: (e) => e.chain().focus().toggleBold().run(), isActive: (e) => e.isActive('bold') },
      { icon: 'format_italic', label: 'Itálico (Ctrl+I)', run: (e) => e.chain().focus().toggleItalic().run(), isActive: (e) => e.isActive('italic') },
      { icon: 'format_underlined', label: 'Sublinhado (Ctrl+U)', run: (e) => e.chain().focus().toggleUnderline().run(), isActive: (e) => e.isActive('underline') },
      { icon: 'strikethrough_s', label: 'Tachado', run: (e) => e.chain().focus().toggleStrike().run(), isActive: (e) => e.isActive('strike') },
    ],
    [
      { icon: 'format_list_bulleted', label: 'Lista', run: (e) => e.chain().focus().toggleBulletList().run(), isActive: (e) => e.isActive('bulletList') },
      { icon: 'format_list_numbered', label: 'Lista numerada', run: (e) => e.chain().focus().toggleOrderedList().run(), isActive: (e) => e.isActive('orderedList') },
      { icon: 'format_quote', label: 'Citação', run: (e) => e.chain().focus().toggleBlockquote().run(), isActive: (e) => e.isActive('blockquote') },
      { icon: 'horizontal_rule', label: 'Divisória', run: (e) => e.chain().focus().setHorizontalRule().run() },
    ],
    (['left', 'center', 'right', 'justify'] as const).map((align) => ({
      icon: `format_align_${align}`,
      label: { left: 'Alinhar à esquerda', center: 'Centralizar', right: 'Alinhar à direita', justify: 'Justificar' }[align],
      run: (e: Editor) => e.chain().focus().setTextAlign(align).run(),
      isActive: (e: Editor) => e.isActive({ textAlign: align }),
    })),
  ];

  constructor() {
    // O editor precisa do elemento já renderizado no DOM
    afterNextRender(() => this.initEditor());
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
  }

  /** Executa um botão da barra. */
  exec(button: ToolbarButton): void {
    if (this.editor) button.run(this.editor);
  }

  /** Estado "ativo" do botão (depende de tick para reavaliar). */
  isActive(button: ToolbarButton): boolean {
    this.tick();
    return !!(this.editor && button.isActive?.(this.editor));
  }

  // --- Internos ------------------------------------------------------------

  private initEditor(): void {
    this.editor = new Editor({
      element: this.host().nativeElement,
      content: untracked(this.content),
      extensions: [
        StarterKit,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Placeholder.configure({ placeholder: untracked(this.placeholder) }),
        CharacterCount,
      ],
      editorProps: { attributes: { class: 'prose-editor' } },
      onTransaction: () => this.tick.update((n) => n + 1),
      onUpdate: ({ editor }) => {
        this.contentChange.emit(editor.getHTML());
        this.updateWordCount();
      },
    });
    this.updateWordCount();
  }

  private updateWordCount(): void {
    this.words.set(this.editor?.storage.characterCount.words() ?? 0);
  }
}
