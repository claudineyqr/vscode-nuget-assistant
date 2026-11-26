import { ChangeDetectionStrategy, Component, HostListener, OnInit } from '@angular/core';
import {
  AbstractControl,
  ReactiveFormsModule,
  UntypedFormBuilder,
  UntypedFormControl,
  UntypedFormGroup,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { ExtensionMessage } from '../../../shared/models/extension-message';
import {
  NuGetConfigCredentialAction,
  NuGetConfigFileInfo,
  NuGetConfigSnapshot,
  NuGetConfigSource,
  NuGetConfigSourceUpdate,
} from '../../../shared/models/nuget-config';
import {
  isValidNuGetConfigSourceName,
  isValidNuGetConfigSourceUrl,
} from '../../../shared/utils/nuget-config-validation';
import { NuGetConfigService } from '../../services/nuget-config.service';
import { BaseComponent } from '../base-component';
import { NuGetConfigSourceDialogComponent } from '../nuget-config-source-dialog/nuget-config-source-dialog.component';

interface SourceDraft {
  name: string;
  url: string;
  enabled: boolean;
  username: string;
  hasPassword: boolean;
  credentialAction: NuGetConfigCredentialAction;
  password?: string;
  originalName?: string;
}

interface EditingState {
  index: number | null;
}

@Component({
  selector: 'app-nuget-config-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './nuget-config-page.component.html',
  styleUrl: './nuget-config-page.component.css',
  imports: [ReactiveFormsModule, FaIconComponent, NuGetConfigSourceDialogComponent],
})
export class NuGetConfigPageComponent extends BaseComponent implements OnInit {
  public readonly fileControl = new UntypedFormControl('');
  public readonly sourceForm: UntypedFormGroup;

  public isLoading = true;
  public isSaving = false;
  public files: NuGetConfigFileInfo[] = [];
  public selectedFilePath = '';
  public fileExists = true;
  public sources: SourceDraft[] = [];
  public errorMessage: string | null = null;
  public pendingFilePath: string | null = null;
  public editing: EditingState | null = null;
  public editingHasPassword = false;

  private baselineSignature = '';
  private readonly fileLabels: Record<NuGetConfigFileInfo['kind'], string> = {
    user: $localize`:@@nugetConfig.file.user:User configuration`,
    additional: $localize`:@@nugetConfig.file.additional:Additional configuration`,
    project: $localize`:@@nugetConfig.file.project:Project configuration`,
  };

  public get isDirty(): boolean {
    return this.getSignature() !== this.baselineSignature;
  }

  constructor(
    private readonly configService: NuGetConfigService,
    private readonly fb: UntypedFormBuilder
  ) {
    super();
    this.sourceForm = this.fb.group({
      name: ['', [
        Validators.required,
        Validators.maxLength(200),
        NuGetConfigPageComponent.sourceNameValidator,
      ]],
      url: ['', [
        Validators.required,
        Validators.maxLength(4096),
        NuGetConfigPageComponent.sourceUrlValidator,
      ]],
      enabled: [true],
      username: ['', [Validators.maxLength(4096)]],
      password: ['', [Validators.maxLength(4096)]],
      removeCredentials: [false],
    });
  }

  ngOnInit(): void {
    this.listenForConfigState();
    this.listenForFileSelection();
  }

  public getFileLabel(file: NuGetConfigFileInfo): string {
    return `${this.fileLabels[file.kind]} — ${file.path}`;
  }

  public requestFileChange(filePath: string): void {
    if (!filePath || filePath === this.selectedFilePath) {
      return;
    }
    if (this.isDirty) {
      this.pendingFilePath = filePath;
      this.fileControl.setValue(this.selectedFilePath, { emitEvent: false });
      return;
    }
    this.loadFile(filePath);
  }

  public startAdd(): void {
    this.editing = { index: null };
    this.editingHasPassword = false;
    this.errorMessage = null;
    this.sourceForm.reset({
      name: '',
      url: '',
      enabled: true,
      username: '',
      password: '',
      removeCredentials: false,
    });
  }

  public startEdit(source: SourceDraft, index: number): void {
    this.editing = { index };
    this.editingHasPassword = source.hasPassword;
    this.errorMessage = null;
    this.sourceForm.reset({
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      username: source.username,
      password: '',
      removeCredentials: false,
    });
  }

  public cancelEdit(): void {
    this.editing = null;
    this.editingHasPassword = false;
    this.sourceForm.reset({
      name: '',
      url: '',
      enabled: true,
      username: '',
      password: '',
      removeCredentials: false,
    });
  }

  public applySource(): void {
    if (!this.editing) {
      return;
    }
    this.sourceForm.markAllAsTouched();
    if (this.sourceForm.invalid) {
      return;
    }

    const value = this.sourceForm.getRawValue() as {
      name: string;
      url: string;
      enabled: boolean;
      username: string;
      password: string;
      removeCredentials: boolean;
    };
    const name = value.name.trim();
    const url = value.url.trim();
    const username = value.username.trim();
    const password = value.password;
    const index = this.editing.index;
    const existing = index === null ? undefined : this.sources[index];

    const duplicate = this.sources.some((source, sourceIndex) =>
      sourceIndex !== index && source.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      this.sourceForm.get('name')?.setErrors({ duplicate: true });
      return;
    }

    const existingHasCredentials = Boolean(existing?.username) || (existing?.hasPassword ?? false);
    const existingHasPassword = existing?.hasPassword ?? false;
    let credentialAction: NuGetConfigCredentialAction;
    let finalUsername: string;
    let finalPassword: string | undefined;
    let hasPassword: boolean;

    if (value.removeCredentials) {
      credentialAction = 'remove';
      finalUsername = '';
      finalPassword = undefined;
      hasPassword = false;
    } else if (existingHasCredentials && username === existing?.username && password.length === 0) {
      credentialAction = existing?.credentialAction ?? 'keep';
      finalUsername = existing?.username ?? '';
      finalPassword = existing?.password;
      hasPassword = existingHasPassword;
    } else if (username.length > 0 || password.length > 0) {
      if (username.length === 0) {
        this.sourceForm.get('username')?.setErrors({ credentialsIncomplete: true });
        return;
      }
      if (!existingHasPassword && password.length === 0) {
        this.sourceForm.get('password')?.setErrors({ passwordRequired: true });
        return;
      }
      credentialAction = 'replace';
      finalUsername = username;
      finalPassword = password.length > 0 ? password : existing?.password;
      hasPassword = existingHasPassword || password.length > 0;
    } else if (existingHasCredentials) {
      this.sourceForm.get('username')?.setErrors({ credentialsIncomplete: true });
      return;
    } else {
      credentialAction = 'keep';
      finalUsername = '';
      finalPassword = undefined;
      hasPassword = false;
    }

    const draft: SourceDraft = {
      name,
      url,
      enabled: value.enabled,
      username: finalUsername,
      hasPassword,
      credentialAction,
      password: credentialAction === 'replace' ? finalPassword : undefined,
      originalName: existing?.originalName ?? (index === null ? undefined : existing?.name),
    };
    if (index === null) {
      this.sources.push(draft);
    } else {
      this.sources[index] = draft;
    }
    this.errorMessage = null;
    this.cancelEdit();
  }

  public moveSource(index: number, offset: -1 | 1): void {
    const target = index + offset;
    if (index < 0 || target < 0 || target >= this.sources.length) {
      return;
    }
    [this.sources[index], this.sources[target]] = [this.sources[target], this.sources[index]];
    if (this.editing?.index === index) {
      this.editing = { index: target };
    } else if (this.editing?.index === target) {
      this.editing = { index };
    }
    this.errorMessage = null;
  }

  public removeSource(source: SourceDraft): void {
    const index = this.sources.indexOf(source);
    if (index === -1) {
      return;
    }
    this.sources.splice(index, 1);
    if (this.editing) {
      if (this.editing.index === index) {
        this.cancelEdit();
      } else if (this.editing.index !== null && this.editing.index > index) {
        this.editing = { index: this.editing.index - 1 };
      }
    }
    this.errorMessage = null;
  }

  public toggleEnabled(source: SourceDraft, event: Event): void {
    source.enabled = (event.target as HTMLInputElement).checked;
    this.errorMessage = null;
  }

  public save(): void {
    if (!this.isDirty || this.isSaving || this.isLoading || this.editing) {
      return;
    }
    const updates: NuGetConfigSourceUpdate[] = this.sources.map((source) => ({
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      originalName: source.originalName,
      credentials: source.credentialAction === 'keep' && !source.username && !source.hasPassword
        ? undefined
        : {
            action: source.credentialAction,
            username: source.credentialAction === 'replace' ? source.username : undefined,
            password: source.credentialAction === 'replace' ? source.password : undefined,
          },
    }));
    this.errorMessage = null;
    this.configService.save(this.selectedFilePath, updates);
  }

  public cancel(): void {
    this.editing = null;
    this.editingHasPassword = false;
    this.errorMessage = null;
    this.pendingFilePath = null;
    this.configService.load(this.selectedFilePath || undefined);
  }

  public confirmDiscard(): void {
    if (!this.pendingFilePath) {
      return;
    }
    const filePath = this.pendingFilePath;
    this.pendingFilePath = null;
    this.loadFile(filePath);
  }

  public cancelDiscard(): void {
    this.pendingFilePath = null;
    this.fileControl.setValue(this.selectedFilePath, { emitEvent: false });
  }

  @HostListener('window:message', ['$event'])
  public messageFromExtension(event: MessageEvent<ExtensionMessage>): void {
    const message = event.data;
    if (message.type === 'nuget-config') {
      this.configService.changeConfig(message.data as NuGetConfigSnapshot);
    } else if (message.type === 'nuget-config-saved') {
      this.configService.changeSaved(message.data as NuGetConfigSnapshot);
    } else if (message.type === 'nuget-config-error') {
      this.configService.changeError(message.error ?? '');
    }
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    // The source dialog is closed only by its buttons.
    if (this.editing) {
      return;
    }
    this.cancel();
  }

  private listenForConfigState(): void {
    this.subscriptions.add(
      this.configService.config.subscribe((snapshot) => {
        if (snapshot) {
          this.applySnapshot(snapshot);
        }
      })
    );
    this.subscriptions.add(
      this.configService.loading.subscribe((isLoading) => {
        this.isLoading = isLoading;
      })
    );
    this.subscriptions.add(
      this.configService.saving.subscribe((isSaving) => {
        this.isSaving = isSaving;
      })
    );
    this.subscriptions.add(
      this.configService.error.subscribe((error) => {
        if (error !== null) {
          this.errorMessage = error;
          this.fileControl.setValue(this.selectedFilePath, { emitEvent: false });
        }
      })
    );
  }

  private listenForFileSelection(): void {
    this.subscriptions.add(
      this.fileControl.valueChanges.subscribe((filePath) => {
        if (typeof filePath === 'string') {
          this.requestFileChange(filePath);
        }
      })
    );
  }

  private applySnapshot(snapshot: NuGetConfigSnapshot): void {
    this.files = snapshot.files;
    this.selectedFilePath = snapshot.selectedFilePath;
    this.fileExists = snapshot.fileExists;
    this.sources = snapshot.sources.map((source) => this.toDraft(source));
    this.baselineSignature = this.getSignature();
    this.fileControl.setValue(snapshot.selectedFilePath, { emitEvent: false });
    this.pendingFilePath = null;
    this.editing = null;
    this.editingHasPassword = false;
    this.errorMessage = null;
  }

  private toDraft(source: NuGetConfigSource): SourceDraft {
    return {
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      username: source.username ?? '',
      hasPassword: source.hasPassword,
      credentialAction: 'keep',
      originalName: source.name,
    };
  }

  private loadFile(filePath: string): void {
    this.editing = null;
    this.editingHasPassword = false;
    this.errorMessage = null;
    this.configService.load(filePath);
  }

  private getSignature(): string {
    return JSON.stringify(this.sources.map((source) => [
      source.name,
      source.url,
      source.enabled,
      source.username,
      source.hasPassword,
      source.credentialAction,
      source.password ?? '',
      source.originalName ?? '',
    ]));
  }

  private static sourceNameValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    return isValidNuGetConfigSourceName(value) ? null : { invalidSourceName: true };
  }

  private static sourceUrlValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    return isValidNuGetConfigSourceUrl(value.trim()) ? null : { invalidSourceUrl: true };
  }
}
