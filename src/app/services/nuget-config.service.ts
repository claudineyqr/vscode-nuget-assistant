import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { NuGetConfigSnapshot, NuGetConfigSourceUpdate } from '../../shared/models/nuget-config';
import {
  LoadNuGetConfigMessage,
  SaveNuGetConfigMessage,
} from '../../shared/models/ui-message';
import { VscodeService } from './vscode.service';

@Injectable({
  providedIn: 'root',
})
export class NuGetConfigService {
  private readonly _config = new BehaviorSubject<NuGetConfigSnapshot | null>(null);
  public get config(): Observable<NuGetConfigSnapshot | null> {
    return this._config.asObservable();
  }

  private readonly _loading = new BehaviorSubject<boolean>(true);
  public get loading(): Observable<boolean> {
    return this._loading.asObservable();
  }

  private readonly _saving = new BehaviorSubject<boolean>(false);
  public get saving(): Observable<boolean> {
    return this._saving.asObservable();
  }

  private readonly _error = new BehaviorSubject<string | null>(null);
  public get error(): Observable<string | null> {
    return this._error.asObservable();
  }

  constructor(private readonly vscodeService: VscodeService) {
    this.load();
  }

  public load(filePath?: string): void {
    this._error.next(null);
    this._loading.next(true);
    const message: LoadNuGetConfigMessage = { command: 'load-nuget-config', filePath };
    this.vscodeService.postMessage(message);
  }

  public save(filePath: string, sources: NuGetConfigSourceUpdate[]): void {
    this._error.next(null);
    this._saving.next(true);
    const message: SaveNuGetConfigMessage = { command: 'save-nuget-config', filePath, sources };
    this.vscodeService.postMessage(message);
  }

  public changeConfig(snapshot: NuGetConfigSnapshot): void {
    this._config.next(snapshot);
    this._loading.next(false);
    this._saving.next(false);
    this._error.next(null);
  }

  public changeSaved(snapshot: NuGetConfigSnapshot): void {
    this.changeConfig(snapshot);
  }

  public changeError(error: string): void {
    this._loading.next(false);
    this._saving.next(false);
    this._error.next(error);
  }
}
