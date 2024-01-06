export function supportsMouseEvents(): boolean {
  return !isIOS() && !isAndroid();
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent) && !/(msie|trident)/i.test(navigator.userAgent);
}
