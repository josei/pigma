import { useEditor } from '../store/editorStore';

export function Toasts() {
  const toasts = useEditor((state) => state.toasts);
  const dismiss = useEditor((state) => state.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, display: 'grid', gap: 8, zIndex: 60 }}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          <span>{toast.message}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
