import { LOCALE_ID, enableProdMode, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { LocationStrategy, registerLocaleData } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { provideHttpClient } from '@angular/common/http';
import { loadTranslations } from '@angular/localize';
import localePt from '@angular/common/locales/pt';
import localeZh from '@angular/common/locales/zh';
import portugueseTranslations from './app/i18n/messages.pt-BR.json';
import chineseTranslations from './app/i18n/messages.zh-CN.json';
import { AppComponent } from './app/app.component';
import { appRoutes } from './app/app.routes';
import { WEBVIEW_INITIAL_ROUTE, WebviewLocationStrategy } from './app/webview-location.strategy';
import { environment } from './environments/environment';

registerLocaleData(localePt, 'pt-BR');
registerLocaleData(localeZh, 'zh-CN');

const requestedLocale = document.querySelector<HTMLMetaElement>('meta[name="nuget-assistant-locale"]')?.content;
const activeLocale = requestedLocale === 'pt-BR' || requestedLocale === 'zh-CN' ? requestedLocale : 'en-US';
if (activeLocale === 'pt-BR') {
  loadTranslations(portugueseTranslations);
} else if (activeLocale === 'zh-CN') {
  loadTranslations(chineseTranslations);
}

if (environment.production) {
  enableProdMode();
}

const requestedRoute = document.querySelector<HTMLMetaElement>('meta[name="nuget-assistant-route"]')?.content;
const initialRoute = requestedRoute === 'configurations' ? '/configurations' : '/packages';

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    provideHttpClient(),
    provideRouter(appRoutes),
    { provide: LocationStrategy, useClass: WebviewLocationStrategy },
    { provide: WEBVIEW_INITIAL_ROUTE, useValue: initialRoute },
    { provide: LOCALE_ID, useValue: activeLocale },
    provideAppInitializer(() => inject(FaIconLibrary).addIconPacks(fas)),
  ],
})
  .catch((err) => console.error(err));
