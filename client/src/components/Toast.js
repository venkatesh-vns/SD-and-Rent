import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Success message that floats in the top-right corner and closes itself
 * after `duration` ms (default 4 s). Hovering pauses the timer; the × button
 * closes it at once. Render it with the current message; `onClose` must
 * clear that message. Errors are not shown this way - they stay on the page
 * until corrected.
 */
export default function Toast({ message, onClose, duration = 4000, children }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = () => {
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      closeRef.current();
    }, 180);
  };

  // New message: full time again
  useEffect(() => {
    remaining.current = duration;
    setLeaving(false);
    setPaused(false);
  }, [message, duration]);

  // Count down while visible and not hovered
  useEffect(() => {
    if (!message || paused) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(remaining.current - (Date.now() - startedAt.current), 0);
    };
  }, [message, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!message) return null;

  return createPortal(
    <div className="toast-region" aria-live="polite">
      <div
        className={`toast ${leaving ? 'leaving' : ''}`}
        role="status"
        style={{ '--toast-ms': `${duration}ms` }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <span className="toast-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5 9-10" />
          </svg>
        </span>
        <div className="toast-body">
          {message}
          {children && <div className="toast-extra">{children}</div>}
        </div>
        <button type="button" className="toast-close" aria-label="Close message" title="Close" onClick={close}>×</button>
        <span key={message} className="toast-progress" style={{ animationPlayState: paused ? 'paused' : 'running' }} />
      </div>
    </div>,
    document.body
  );
}
