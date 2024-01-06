import {
  afterNextRender,
  AfterRenderPhase,
  ApplicationRef,
  ComponentRef,
  computed,
  createComponent,
  Directive,
  ElementRef,
  EmbeddedViewRef,
  EnvironmentInjector,
  inject,
  Input,
  NgZone,
  OnDestroy,
  Renderer2,
  signal,
  TemplateRef,
  Type,
  ViewContainerRef
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  arrow,
  autoUpdate,
  computePosition,
  ComputePositionConfig,
  flip,
  offset,
  OffsetOptions,
  shift
} from '@floating-ui/dom';
import { Placement } from '@floating-ui/utils';
import { MiddlewareData } from '@floating-ui/core';

import { supportsMouseEvents } from './helpers';
import { FLOATING_UI_OPTIONS } from './tokens';

type TooltipContent = Type<any> | TemplateRef<any> | string | number;

@Directive({
  selector: '[floating]',
  exportAs: 'floating',
  standalone: true
})
export class FloatingDirective implements OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly renderer = inject(Renderer2);
  private readonly ngZone = inject(NgZone);
  private readonly document = inject(DOCUMENT);
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly options = inject(FLOATING_UI_OPTIONS);

  @Input({ alias: 'floating', required: true })
  public content!: TooltipContent;

  @Input()
  public showDelay?: number;

  @Input()
  public hideDelay?: number;

  @Input()
  public interactive?: number;

  @Input()
  public placement?: Placement;

  @Input()
  public showArrow = true;

  @Input()
  public offset: OffsetOptions | undefined = 6;

  @Input()
  public cssModifier?: string;

  @Input()
  public disabled = false;

  @Input()
  public isManual = false;

  public readonly isVisible = computed(() => this._isVisible());
  private readonly _isVisible = signal<boolean>(false);

  private tooltipElRef?: HTMLElement;
  private embdedViewRef?: EmbeddedViewRef<any>;
  private componentRef?: ComponentRef<any>;
  private cleanupFn?: () => void;
  private eventListeners: Parameters<typeof HTMLElement.prototype['addEventListener']>[] = [];
  private touchstartTimeout?: number;

  constructor() {
    if (this.isManual) {
      return;
    }

    afterNextRender(
      () => this.setupListeners(),
      { phase: AfterRenderPhase.Write }
    );
  }

  ngOnDestroy(): void {
    this.destroy();

    this.eventListeners.forEach((listener) => {
      this.elementRef.nativeElement
        .removeEventListener(
          listener[0],
          listener[1],
          listener[2]
        );
    });
  }

  show(): void {
    this._isVisible.set(true);
    this.render();
  }

  hide(): void {
    this._isVisible.set(false);
    this.destroy();
  }

  private setupListeners(): void {
    this.ngZone.runOutsideAngular(() => {
      this.setupFocusAndBlurEvents();

      if (supportsMouseEvents()) {
        this.setupMouseEnterEvents();
        this.setupMouseExitEvents();
      } else {
        this.setupTouchEnterEvents();
        this.setupTouchExitEvents();
      }

      this.eventListeners.forEach((listener) => {
        this.elementRef.nativeElement
          .addEventListener(listener[0], listener[1], listener[2]);
      });
    });
  }

  private setupFocusAndBlurEvents(): void {
    this.addListener('focus', () => this.show());
    this.addListener('blur', () => this.hide());
  }

  private setupMouseEnterEvents(): void {
    this.addListener(
      'mouseenter',
      () => this.show()
    );
  }

  private setupTouchEnterEvents(): void {
    this.disableNativeGestures();
    this.addListener(
      'touchstart',
      () => {
        clearTimeout(this.touchstartTimeout);

        this.touchstartTimeout = setTimeout(
          () => this.show(),
          this.options.longPressDelay
        );
      },
    );
  }

  private setupMouseExitEvents(): void {
    this.addListener(
      'mouseleave',
      () => this.hide()
    );

    this.addListener(
      'wheel',
      (event) => {
        if (this._isVisible()) {
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
  }

  private setupTouchExitEvents(): void {
    const touchendListener = () => {
      clearTimeout(this.touchstartTimeout);
      this.hide();
    };

    this.addListener('touchend', touchendListener);
    this.addListener('touchcancel', touchendListener);
  }

  private addListener(event: string, callback: (event: Event) => void): void {
    this.eventListeners.push([event, callback, { passive: true }]);
  }

  private render(): void {
    const { nativeElement } = this.elementRef;

    const [tooltipEl, arrowEl] = this.createElement(this.showArrow);
    const middleware: ComputePositionConfig['middleware'] = [
      flip(),
      shift()
    ];

    if (this.offset) {
      middleware.unshift(offset(this.offset));
    }

    if (this.showArrow) {
      middleware.push(
        arrow({ element: arrowEl!, padding: this.options.arrowPadding })
      );
    }

    const options: ComputePositionConfig = {
      placement: this.placement,
      middleware
    };

    this.cleanupFn = autoUpdate(
      nativeElement,
      tooltipEl,
      () => this.setTooltipPosition(
        nativeElement,
        tooltipEl,
        arrowEl,
        options
      ),
      { animationFrame: true }
    );

    this.tooltipElRef = tooltipEl;
  }

  private async setTooltipPosition(
    parentEl: HTMLElement,
    tooltipEl: HTMLElement,
    arrowEl: HTMLElement | undefined,
    options: ComputePositionConfig
  ): Promise<void> {
    const { x, y, placement, middlewareData } = await computePosition(parentEl, tooltipEl, options);

    tooltipEl.style.left = `${ x }px`;
    tooltipEl.style.top = `${ y }px`;

    if (arrowEl) {
      const tooltipSide = placement.split('-')[0];

      this.setArrowPosition(arrowEl, tooltipSide, middlewareData.arrow!);
    }
  }

  private setArrowPosition(
    arrowEl: HTMLElement,
    tooltipSide: string,
    arrowMiddleware: NonNullable<MiddlewareData['arrow']>
  ): void {
    const { x: arrowX, y: arrowY } = arrowMiddleware;

    const arrowSide = {
      top: 'bottom',
      right: 'left',
      bottom: 'top',
      left: 'right',
    }[tooltipSide];

    console.log(tooltipSide);

    Object.assign(arrowEl.style, {
      left: arrowX != null ? `${ arrowX }px` : '',
      top: arrowY != null ? `${ arrowY }px` : '',
      right: '',
      bottom: '',
      [arrowSide!]: `-${ this.options.arrowHeight }px`
    });
  }

  private createElement(createArrow: boolean): [HTMLElement, HTMLElement | undefined] {
    const tooltipEl = this.createEl('floating-tooltip');
    const tooltipContent = this.createEl('floating-tooltip__content');

    this.renderer.setAttribute(tooltipEl, 'tabindex', '-1');

    if (this.content instanceof TemplateRef) {
      this.embdedViewRef = this.vcr.createEmbeddedView(this.content, { $implicit: 123 });

      this.embdedViewRef.rootNodes.forEach((node) => {
        this.renderer.appendChild(tooltipContent, node);
      });
    } else if(typeof this.content === 'string' || typeof this.content === 'number') {
      tooltipContent.textContent = String(this.content);
    } else {
      this.componentRef = createComponent(this.content, {
        environmentInjector: this.envInjector
      });

      this.appRef.attachView(this.componentRef.hostView);
      this.renderer.appendChild(tooltipContent, this.componentRef.location.nativeElement);
    }

    let arrowEl: HTMLElement | undefined;

    if (createArrow) {
      arrowEl = this.createEl('floating-tooltip__arrow');

      this.renderer.appendChild(tooltipEl, arrowEl);
    }

    this.renderer.appendChild(tooltipEl, tooltipContent);
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
