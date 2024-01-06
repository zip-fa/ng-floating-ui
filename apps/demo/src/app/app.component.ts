import { Component } from '@angular/core';

import { FloatingDirective } from '@zip-fa/ng-floating-ui';
import { TestComponent } from './test.component';
import { Placement } from '@floating-ui/dom';

@Component({
  standalone: true,
  imports: [FloatingDirective],
  selector: 'ng-floating-ui-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public readonly component = TestComponent;

  public readonly placements: Placement[] = [
    'top',
    'right',
    'bottom',
    'left',
    'top-end',
    'top-start',
    'right-end',
    'right-start',
    'bottom-end',
    'bottom-start',
    'left-end',
    'left-start'
  ];
}
