import { Component } from '@angular/core';

import { FloatingDirective } from '@zip-fa/ng-floating-ui';
import { TestComponent } from './test.component';

@Component({
  standalone: true,
  imports: [FloatingDirective],
  selector: 'ng-floating-ui-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public readonly component = TestComponent;
}
