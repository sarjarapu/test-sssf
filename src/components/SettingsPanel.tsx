import { useEffect, useRef } from 'react';
import type { SettingsField, SettingsValues } from '../types/game';

interface SettingsPanelProps {
  fields: SettingsField[];
  values: SettingsValues;
  setValue: (key: string, value: boolean | string) => void;
  reset: () => void;
  onClose: () => void;
}

export default function SettingsPanel({
  fields,
  values,
  setValue,
  reset,
  onClose,
}: SettingsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-panel__backdrop" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Game settings"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>
        <form>
          {fields.map((field) => (
            <p key={field.key} className="settings-panel__field">
              {field.type === 'boolean' ? (
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.key])}
                    onChange={(e) => setValue(field.key, e.target.checked)}
                  />{' '}
                  {field.label}
                </label>
              ) : (
                <label>
                  {field.label}{' '}
                  <select
                    value={String(values[field.key])}
                    onChange={(e) => setValue(field.key, e.target.value)}
                  >
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </p>
          ))}
        </form>
        <div className="settings-panel__actions">
          <button type="button" onClick={reset}>
            Reset to defaults
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
