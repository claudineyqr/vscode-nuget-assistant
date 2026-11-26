import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';

@Component({
  selector: 'app-nuget-config-source-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './nuget-config-source-dialog.component.html',
  styleUrl: './nuget-config-source-dialog.component.css',
  imports: [ReactiveFormsModule, FaIconComponent],
})
export class NuGetConfigSourceDialogComponent {
  @Input({ required: true }) public form!: UntypedFormGroup;
  @Input() public isAdd = false;
  @Input() public hasPassword = false;

  @Output() public readonly saveSource = new EventEmitter<void>();
  @Output() public readonly cancelRequest = new EventEmitter<void>();

  public readonly passwordKeepPlaceholder = $localize`:@@nugetConfig.form.passwordKeepPlaceholder:Leave blank to keep the current password`;
  public readonly passwordNewPlaceholder = $localize`:@@nugetConfig.form.passwordNewPlaceholder:Password or environment variable`;
}
