import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'app-loading-spinner',
    changeDetection: ChangeDetectionStrategy.Eager,
    templateUrl: './loading-spinner.component.html',
    styleUrl: './loading-spinner.component.css',
})
export class LoadingSpinnerComponent {}
