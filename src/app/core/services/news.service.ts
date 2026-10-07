import { Injectable, signal } from '@angular/core';
import { NewsPost } from '../models/news.model';

/**
 * Notícias e anúncios da página inicial.
 * Começa vazio; quando houver backend/CMS, basta preencher `posts`
 * a partir da API — a página inicial já sabe exibir a lista.
 */
@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly _posts = signal<NewsPost[]>([]);
  readonly posts = this._posts.asReadonly();
}
