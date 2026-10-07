/** Notícia ou anúncio exibido na página inicial. */
export interface NewsPost {
  id: string;
  title: string;
  summary: string;
  /** Categoria exibida como etiqueta (ex.: "Atualização", "Evento"). */
  tag: string;
  publishedAt: number;
  imageUrl?: string;
}
