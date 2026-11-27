/**
 * "No-show not logged." notices that outlive the card that raised them. A card that unmounts inside the no-show hold
 * (the opened card closed, the list re-drawn without it) cancels the hold and writes NOTHING; this store keeps a notice
 * so the person sees it, rendered once by the dashboard layout (`NoShowNotices`). Pure apart from its own memory.
 */
export type NoShowNotice = { id: number; name: string };

export function createNoticeStore() {
  let notices: readonly NoShowNotice[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    push(name: string): NoShowNotice {
      const notice = { id: next++, name };
      notices = [...notices, notice].slice(-5);
      emit();
      return notice;
    },
    dismiss(id: number) {
      const kept = notices.filter((n) => n.id !== id);
      if (kept.length === notices.length) return;
      notices = kept;
      emit();
    },
    list: (): readonly NoShowNotice[] => notices,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const noShowNotices = createNoticeStore();
export const NO_NOTICES: readonly NoShowNotice[] = [];
