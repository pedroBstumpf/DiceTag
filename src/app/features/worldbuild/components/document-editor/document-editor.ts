import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Editor } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { WorldbuildService } from '../../services/worldbuild.service';

/** Botão da barra de formatação. */
interface ToolbarButton {
  icon: string;
  label: string;
  run: (e: Editor) => void;
  isActive?: (e: Editor) => boolean;
}

/**
 * Editor de documentos longos (rich text) baseado no Tiptap.
 * Salva automaticamente a cada alteração (o serviço agrupa as gravações).
 */
@Component({
  selector: 'app-document-editor',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './document-editor.html',
  host: { class: 'flex h-full flex-col' },
})
export class DocumentEditor {
  private readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  readonly item = computed(() => this.service.byId().get(this.itemId()));

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

  rename(value: string): void {
    this.service.rename(this.itemId(), value);
  }

  // --- Internos ------------------------------------------------------------

  private initEditor(): void {
    this.editor = new Editor({
      element: this.host().nativeElement,
      content: this.item()?.content ?? '',
      extensions: [
        StarterKit,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Placeholder.configure({ placeholder: 'Comece a escrever a história do seu mundo…' }),
        CharacterCount,
      ],
      editorProps: { attributes: { class: 'prose-editor' } },
      onTransaction: () => this.tick.update((n) => n + 1),
      onUpdate: ({ editor }) => {
        this.service.update(this.itemId(), { content: editor.getHTML() });
        this.updateWordCount();
      },
    });
    this.updateWordCount();
  }

  private updateWordCount(): void {
    this.words.set(this.editor?.storage.characterCount.words() ?? 0);
  }
}
