import {
  afterNextRender,
  AfterRenderPhase,
  ApplicationRef,
  ComponentRef,
  createComponent,
  Directive, effect,
  ElementRef,
  EmbeddedViewRef,
  EnvironmentInjector,
  inject,
  Input,
  NgZone,
  OnDestroy,
  Renderer2, signal,
  TemplateRef,
  Type,
  ViewContainerRef
} from '@angular/core';
import { arrow, autoUpdate, computePosition, flip } from '@floating-ui/dom';
import { DOCUMENT } from '@angular/common';
import { supportsMouseEvents, supportsPassiveListeners } from './helpers';

type TooltipContent = Type<any> | TemplateRef<any> | string | number;

/**
 * Time between the user putting the pointer on a tooltip
 * trigger and the long press event being fired.
 */
const LONGPRESS_DELAY = 500;

@Directive({
  selector: '[floating]',
  exportAs: 'floating',
  standalone: true
})
export class FloatingDirective implements OnDestroy {
  private readonly elementRef = inject(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly renderer = inject(Renderer2);
  private readonly ngZone = inject(NgZone);
  private readonly document = inject(DOCUMENT);
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);

  @Input({ required: true })
  public floating!: TooltipContent;

  public readonly isVisible = signal<boolean>(false);

  private tooltipElRef?: HTMLElement;
  private embdedViewRef?: EmbeddedViewRef<any>;
  private componentRef?: ComponentRef<any>;
  private cleanupFn?: () => void;
  private boundListeners: string[] = [];
  private touchstartTimeout?: number;

  constructor() {
    afterNextRender(
      () => this.init(),
      { phase: AfterRenderPhase.Write }
    );
  }

  ngOnDestroy(): void {
    this.destroy();

    this.boundListeners.forEach((event) => {
      this.elementRef.nativeElement.removeEventListener(event);
    });
  }

  show(): void {
    this.isVisible.set(true);
    this.render();
  }

  hide(): void {
    this.isVisible.set(false);
    this.destroy();
  }

  private init(): void {
    this.ngZone.runOutsideAngular(() => {
      this.setupFocusAndBlurEvents();
      this.setupEnterEvents();
    });
  }

  private setupFocusAndBlurEvents(): void {
    this.addListener('focus', () => this.show());
    this.addListener('blur', () => this.hide());
  }

  private setupEnterEvents(): void {
    if (supportsMouseEvents()) {
      this.addListener(
        'mouseenter',
        () => {
          this.setupExitEvents();
          this.show();
        }
      );
    } else {
      this.disableNativeGestures();
      this.addListener(
        'touchstart',
        () => {
          // Note that it's important that we don't `preventDefault` here,
          // because it can prevent click events from firing on the element.
          this.setupExitEvents();

          clearTimeout(this.touchstartTimeout);
          this.touchstartTimeout = setTimeout(() => this.show(), LONGPRESS_DELAY);
        },
      );
    }
  }

  private setupExitEvents(): void {
    if (supportsMouseEvents()) {
      this.addListener(
        'mouseleave',
        () => {
          console.log('mouseleave');
          this.hide();
        }
      );

      this.addListener(
        'wheel',
        (event) => {
          console.log('wheel');

          if (this.isVisible()) {
            const elementUnderPointer = this.document.elementFromPoint(
              (event as WheelEvent).clientX,
              (event as WheelEvent).clientY
            );

            const { nativeElement } = this.elementRef;

            // On non-touch devices we depend on the `mouseleave` event to close the tooltip, but it
            // won't fire if the user scrolls away using the wheel without moving their cursor. We
            // work around it by finding the element under the user's cursor and closing the tooltip
            // if it's not the trigger.
            if (elementUnderPointer !== nativeElement && !nativeElement.contains(elementUnderPointer)) {
              this.hide();
            }
          }
        }
      );
    } else {
      const touchendListener = () => {
        clearTimeout(this.touchstartTimeout);
        this.hide();
      };

      this.addListener('touchend', touchendListener);
      this.addListener('touchcancel', touchendListener);
    }
  }

  private addListener(event: string, listener: (event: Event) => void, isPassive = true): void {
    let passiveListenerOptions: any = {};

    if (isPassive && supportsPassiveListeners()) {
      passiveListenerOptions = { passive: true };
    }

    this.boundListeners.push(event);
    this.elementRef.nativeElement
      .addEventListener(event, listener, passiveListenerOptions);
  }

  private render(): void {
    const { nativeElement } = this.elementRef;
    const [tooltipEl, arrowEl] = this.createElement();
    const options = {
      middleware: [
        flip(),
        arrow({ element: arrowEl })
      ],
    };

    this.cleanupFn = autoUpdate(
      nativeElement,
      tooltipEl,
      () => {
        console.log('autoupdate called');

        computePosition(nativeElement, tooltipEl, options)
          .then((data) => {
            console.log(data);
          });
      },
      { animationFrame: true }
    );

    this.tooltipElRef = tooltipEl;
  }

  private createElement(): [HTMLElement, HTMLElement] {
    const tooltipEl = this.createEl('floating-tooltip');
    const tooltipContent = this.createEl('floating-tooltip__content');

    this.renderer.setAttribute(tooltipEl, 'tabindex', '-1');

    if (this.floating instanceof TemplateRef) {
      this.embdedViewRef = this.vcr.createEmbeddedView(this.floating, { $implicit: 123 });

      this.embdedViewRef.rootNodes.forEach((node) => {
        this.renderer.appendChild(tooltipContent, node);
      });
    } else if(typeof this.floating === 'string' || typeof this.floating === 'number') {
      tooltipContent.textContent = String(this.floating);
    } else {
      this.componentRef = createComponent(this.floating, {
        environmentInjector: this.envInjector
      });

      this.appRef.attachView(this.componentRef.hostView);
      this.renderer.appendChild(tooltipContent, this.componentRef.location.nativeElement);
    }

    const arrowEl = this.createEl('floating-tooltip__arrow');

    this.renderer.appendChild(tooltipEl, tooltipContent);
    this.renderer.appendChild(tooltipEl, arrowEl);
    this.renderer.appendChild(this.document.body, tooltipEl);

    return [tooltipEl, arrowEl];
  }

  private createEl(className: string): HTMLElement {
    const el = this.renderer.createElement('div');
    this.renderer.addClass(el, className);

    return el;
  }

  /** Disables the native browser gestures, based on how the tooltip has been configured. */
  private disableNativeGestures(): void {
    const { nativeElement } = this.elementRef;
    const { style } = nativeElement;

    // If gestures are set to `auto`, we don't disable text selection on inputs and
    // textareas, because it prevents the user from typing into them on iOS Safari.
    if (nativeElement.nodeName !== 'INPUT' && nativeElement.nodeName !== 'TEXTAREA') {
      style.userSelect =
        (style as any).msUserSelect =
          style.webkitUserSelect =
            (style as any).MozUserSelect =
              'none';
    }

    // If we have `auto` gestures and the element uses native HTML dragging,
    // we don't set `-webkit-user-drag` because it prevents the native behavior.
    if (!nativeElement.draggable) {
      (style as any).webkitUserDrag = 'none';
    }

    style.touchAction = 'none';
    (style as any).webkitTapHighlightColor = 'transparent';
  }

  private destroy(): void {
    this.embdedViewRef && this.embdedViewRef.destroy();
    this.componentRef && this.componentRef.destroy();
    this.tooltipElRef && this.tooltipElRef.remove();
    this.cleanupFn && this.cleanupFn();
    clearTimeout(this.touchstartTimeout);
  }
}
