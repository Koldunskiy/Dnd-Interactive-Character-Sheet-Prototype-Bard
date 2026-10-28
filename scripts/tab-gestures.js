export function decideSwipe({ dx, dy, duration, startX, viewportWidth, count, activeIndex }) {
  if (startX < 24 || startX > viewportWidth - 24) return null;
  if (duration < 80 || duration > 700) return null;
  if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.7) return null;
  const targetIndex = activeIndex + (dx < 0 ? 1 : -1);
  return targetIndex < 0 || targetIndex >= count ? null : targetIndex;
}

export function isClearlyVertical(dx, dy) {
  return Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx);
}

export function isSwipeContextValid({
  contactCount,
  startTab,
  activeTab,
  compact,
  visible,
  cancelled = false,
}) {
  return contactCount === 1 && startTab === activeTab && compact && visible && !cancelled;
}

export function isCurrentScrollRestore({
  requestedGeneration,
  currentGeneration,
  requestedTab,
  activeTab,
}) {
  return requestedGeneration === currentGeneration && requestedTab === activeTab;
}
