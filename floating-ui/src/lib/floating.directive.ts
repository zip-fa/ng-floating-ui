import {
  AfterViewInit,
  ComponentRef,
  computed,
  Directive,
  ElementRef,
  EmbeddedViewRef,
  inject,
  Input,
  NgZone, OnChanges,
  OnDestroy, PLATFORM_ID,
  Renderer2,
  signal, SimpleChanges,
  TemplateRef,
  ViewContainerRef
} from '@angular/core';
import { DOCUMENT, isPlatformServer } from '@angular/common';
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
import { TooltipTrigger } from './types';

type TooltipContent = TemplateRef<any> | string | number;

@Directive({
  selector: '[floating]',
  exportAs: 'floating',
  standalone: true
})
export class FloatingDirective implements AfterViewInit, OnDestroy, OnChanges {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly renderer = inject(Renderer2);
  private readonly ngZone = inject(NgZone);
  private readonly document = inject(DOCUMENT);
  private readonly options = inject(FLOATING_UI_OPTIONS);
  private readonly isServer = isPlatformServer(inject(PLATFORM_ID));

  @Input({ alias: 'floating', required: true })
  public content!: TooltipContent;

  @Input()
  public trigger: TooltipTrigger = 'hover';

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
  public manual = false;

  public readonly isVisible = computed(() => this._isVisible());
  private readonly _isVisible = signal<boolean>(false);

  private tooltipElRef?: HTMLElement;
  private embdedViewRef?: EmbeddedViewRef<any>;
  private componentRef?: ComponentRef<any>;
  private cleanupFn?: () => void;
  private eventListeners: Parameters<typeof HTMLElement.prototype['addEventListener']>[] = [];
  private touchstartTimeout?: number;

  ngAfterViewInit(): void {
    if (this.manual || this.isServer || this.disabled) {
      return;
    }

    this.setupListeners();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['disabled'] && !changes['disabled'].firstChange) {
      if (this.manual || this.isServer) {
        return;
      }

      if (this.disabled) {
        if (this._isVisible()) {
          this.destroy();
        }

        this.removeListeners();
      } else {
        this.setupListeners();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy();
    this.removeListeners();
  }

  toggle(): void {
    if (this._isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (this._isVisible()) {
      return;
    }

    this._isVisible.set(true);
    this.destroy();
    this.render();
  }

  hide(): void {
    if (!this._isVisible()) {
      return;
    }

    this._isVisible.set(false);
    this.destroy();
  }

  private setupListeners(): void {
    this.ngZone.runOutsideAngular(() => {
      if (this.trigger === 'click') {
        this.setupClickEvents();
      } else {
        this.setupFocusAndBlurEvents();

        if (supportsMouseEvents()) {
          this.setupMouseEvents();
        } else {
          this.setupTouchEvents();
        }
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

  private setupClickEvents(): void {
    this.addListener(
      'click',
      () => this.toggle()
    );
  }

  private setupMouseEvents(): void {
    this.addListener(
      'mouseenter',
      () => this.show()
    );

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

  private setupTouchEvents(): void {
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

    Object.assign(arrowEl.style, {
      left: arrowX != null ? `${ arrowX }px` : '',
      top: arrowY != null ? `${ arrowY }px` : '',
      right: '',
      bottom: '',
      [arrowSide!]: `-${ this.options.arrowHeight }px`
    });
  }

  private createElement(createArrow: boolean): [HTMLElement, HTMLElement | undefined] {
    const tooltipClassNames = ['floating-tooltip'];

    if (this.cssModifier) {
      tooltipClassNames.push(`floating-tooltip_${ this.cssModifier }`);
    }

    const tooltipEl = this.createEl(tooltipClassNames);
    const tooltipContent = this.createEl('floating-tooltip__content');

    this.renderer.setAttribute(tooltipEl, 'tabindex', '-1');

    if (this.content instanceof TemplateRef) {
      this.embdedViewRef = this.vcr.createEmbeddedView(this.content, {
        $implicit: () => this.hide()
      });

      this.embdedViewRef.rootNodes.forEach((node) => {
        this.renderer.appendChild(tooltipContent, node);
      });
    } else {
      tooltipContent.textContent = String(this.content);
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

  private createEl(className: string | string[]): HTMLElement {
    const el = this.renderer.createElement('div');

    if(typeof className === 'string') {
      this.renderer.addClass(el, className);
    } else {
      className.forEach((name) => this.renderer.addClass(el, name));
    }

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

  private removeListeners(): void {
    this.eventListeners.forEach((listener) => {
      this.elementRef.nativeElement
        .removeEventListener(
          listener[0],
          listener[1],
          listener[2]
        );
    });
  }
}
