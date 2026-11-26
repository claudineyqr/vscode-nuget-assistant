import { LocationStrategy } from '@angular/common';
import { Inject, Injectable, InjectionToken } from '@angular/core';

export const WEBVIEW_INITIAL_ROUTE = new InjectionToken<string>('WEBVIEW_INITIAL_ROUTE');

/**
 * Keeps routing entirely in memory. VS Code webviews serve a fixed document
 * (`index.html`); any attempt by Angular to rewrite window.location navigates
 * away from it and leaves a blank page.
 */
@Injectable()
export class WebviewLocationStrategy extends LocationStrategy {
  private currentPath: string;

  constructor(@Inject(WEBVIEW_INITIAL_ROUTE) initialRoute: string) {
    super();
    this.currentPath = initialRoute.startsWith('/') ? initialRoute : `/${initialRoute}`;
  }

  public override path(): string {
    return this.currentPath;
  }

  public override prepareExternalUrl(internal: string): string {
    return internal;
  }

  public override getState(): unknown {
    return null;
  }

  public override pushState(_state: unknown, _title: string, url: string): void {
    this.currentPath = url || '/';
  }

  public override replaceState(_state: unknown, _title: string, url: string): void {
    this.currentPath = url || '/';
  }

  public override forward(): void {
    // Intentionally not wired to browser history in a webview.
  }

  public override back(): void {
    // Intentionally not wired to browser history in a webview.
  }

  public override onPopState(): void {
    // Intentionally not wired to browser history in a webview.
  }

  public override getBaseHref(): string {
    return '';
  }
}
