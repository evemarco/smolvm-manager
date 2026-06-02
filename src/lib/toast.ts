import { writable } from 'svelte/store';

export type ToastVariant = 'success' | 'error' | 'info';

export type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

let nextId = 0;

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  return {
    subscribe,
    push(message: string, variant: ToastVariant = 'info') {
      const id = nextId++;
      update((toasts) => [...toasts, { id, message, variant }]);
      setTimeout(() => {
        update((toasts) => toasts.filter((t) => t.id !== id));
      }, 4000);
    },
    dismiss(id: number) {
      update((toasts) => toasts.filter((t) => t.id !== id));
    }
  };
}

export const toasts = createToastStore();
