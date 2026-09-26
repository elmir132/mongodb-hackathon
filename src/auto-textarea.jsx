import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

// Grow and shrink with text (and wrapping), then scroll at the CSS height limit.
const AutoTextarea = forwardRef(function AutoTextarea({ value, ...props }, forwardedRef) {
  const elementRef = useRef(null);
  useImperativeHandle(forwardedRef, () => elementRef.current);
  function resize() {
    const element = elementRef.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight + borders}px`;
    element.style.overflowY = element.scrollHeight > element.clientHeight + 1 ? 'auto' : 'hidden';
  }
  useLayoutEffect(resize, [value]);
  useLayoutEffect(() => {
    let width = 0;
    const observer = new ResizeObserver(entries => {
      const next = entries[0].contentRect.width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={elementRef} value={value}/>;
});
export default AutoTextarea;
