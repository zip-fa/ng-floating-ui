import { InjectionToken, Provider } from '@angular/core';
import { GlobalOptions } from './types';

const DEFAULT_OPTIONS: GlobalOptions = {
  arrowHeight: 4,
  arrowPadding: 5,
  longPressDelay: 500
};

export const FLOATING_UI_OPTIONS = new InjectionToken<GlobalOptions>('FLOATING_UI_OPTIONS', {
  factory: () => DEFAULT_OPTIONS
});

export function provideFloatingUiOptions(options: GlobalOptions): Provider[]
{
  return [
    {
      provide: FLOATING_UI_OPTIONS,
      useValue: {
        ...DEFAULT_OPTIONS,
        ...options
      }
    }
  ];
}
