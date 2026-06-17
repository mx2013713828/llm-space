export function shouldSubmitMessage(event, isComposing = false) {
  if (event?.key !== 'Enter') return false;
  if (event.shiftKey) return false;
  if (isComposing || event.isComposing || event.nativeEvent?.isComposing) return false;
  if (event.keyCode === 229 || event.nativeEvent?.keyCode === 229) return false;
  return true;
}
