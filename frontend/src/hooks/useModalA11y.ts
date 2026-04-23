import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

/**
 * Standard focusable-element selector. Matches visible, non-disabled
 * interactive elements plus anything with an explicit non-negative tabindex.
 * Excludes `tabindex="-1"` so programmatically-focusable-only nodes don't
 * participate in the Tab cycle.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

export interface UseModalA11yOptions {
  open: boolean;
  onClose: () => void;
  /**
   * Element to focus when the modal opens. Defaults to the first focusable
   * descendant. Pass an explicit ref when the "logical" primary input is
   * e.g. a textarea deep inside a tabbed layout. Typed permissively so both
   * React 18's non-nullable and React 19's nullable RefObject shapes are
   * accepted.
   */
  initialFocusRef?: RefObject<HTMLElement> | MutableRefObject<HTMLElement | null>;
  /**
   * Gate for Escape/backdrop-driven close. Defaults to always-allowed.
   * The common case is `() => !busy` so an in-flight submit can't be
   * stranded by a stray keystroke.
   */
  canClose?: () => boolean;
}

export interface UseModalA11yReturn {
  modalRef: RefObject<HTMLDivElement>;
  ariaProps: { role: 'dialog'; 'aria-modal': 'true' };
}

/**
 * Shared modal accessibility primitive:
 *   - captures the previously-focused element on open and restores it on close
 *   - focuses an initial element inside the modal on open
 *   - traps Tab/Shift+Tab within the modal boundary
 *   - closes on Escape (gated by canClose)
 *
 * Intentionally does NOT handle the backdrop click — that lives in the modal's
 * own JSX so existing click-outside behavior stays owned by each modal. Also
 * does NOT render any DOM; the caller applies `modalRef` + `ariaProps` to
 * their existing modal root so styling stays untouched.
 */
export function useModalA11y(opts: UseModalA11yOptions): UseModalA11yReturn {
  const { open, onClose, initialFocusRef, canClose } = opts;
  const modalRef = useRef<HTMLDivElement>(null);
  // Wrap the two callbacks in refs so the keydown effect doesn't re-subscribe
  // each render. React event listeners ought to be stable, but callers commonly
  // pass inline `() => setState(false)`, which would churn the listener.
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { canCloseRef.current = canClose; }, [canClose]);

  const getFocusable = useCallback((): HTMLElement[] => {
    const root = modalRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      // Skip elements hidden via display:none / visibility:hidden; offsetParent
      // is null in both cases (except for fixed-position elements inside a
      // display:none ancestor, which is a rare enough edge we don't bother).
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, []);

  // Focus management: capture + restore. Fires only on open transitions.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Defer the initial-focus call so the modal's content has a chance to
    // mount — autoFocus or effect-driven refs inside the modal set their
    // first focus target before this hook's layout phase. rAF is enough.
    const raf = requestAnimationFrame(() => {
      const explicit = initialFocusRef?.current;
      if (explicit) {
        explicit.focus();
        return;
      }
      const focusables = getFocusable();
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        // Fall back to focusing the modal root itself so Escape still works.
        modalRef.current?.focus();
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      // Only restore if the focus is currently inside our modal. If the user
      // clicked somewhere else before close, respect that.
      const root = modalRef.current;
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === 'function' &&
        (!root || root.contains(document.activeElement))
      ) {
        previouslyFocused.focus();
      }
    };
    // Intentionally `[open]` only. `initialFocusRef` is a ref object and
    // `getFocusable` is a `useCallback([])` — both are stable. The effect
    // should fire on open/close transitions, not on caller-identity churn
    // if someone ever passes a non-stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard handling: Escape + focus trap.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const allowed = canCloseRef.current ? canCloseRef.current() : true;
        if (!allowed) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = getFocusable();
      if (focusables.length === 0) {
        // Nothing to cycle through; keep focus on the modal root.
        e.preventDefault();
        modalRef.current?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // If focus somehow escaped the modal, yank it back.
      if (!active || !modalRef.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // Same reasoning as above — `getFocusable` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return {
    modalRef,
    ariaProps: { role: 'dialog', 'aria-modal': 'true' },
  };
}
