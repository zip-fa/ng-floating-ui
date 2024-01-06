export type GlobalOptions = {
  arrowHeight: number;
  arrowPadding: number;
  /**
   * Time between the user putting the pointer on a tooltip
   * trigger and the long press event being fired.
   */
  longPressDelay: number;
};

export type TooltipTrigger = 'click' | 'hover';