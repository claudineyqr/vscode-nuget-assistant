import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'severity', })
export class SeverityPipe implements PipeTransform {
  transform(value: string): unknown {
    let description = '';
    switch (value) {
      case '0':
        description = $localize`:@@severity.low:low`;
        break;
      case '1':
        description = $localize`:@@severity.moderate:moderate`;
        break;
      case '2':
        description = $localize`:@@severity.high:high`;
        break;
      case '3':
        description = $localize`:@@severity.critical:critical`;
        break;
    }

    return $localize`:@@severity.label:${description} severity`;
  }
}
