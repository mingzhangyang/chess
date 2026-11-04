import type { Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

export interface MobileQuickAction {
  key: string;
  icon: LucideIcon;
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}

interface MobileQuickActionBarProps {
  actions: readonly [MobileQuickAction, MobileQuickAction, MobileQuickAction];
}

/** The board already reserves 4.5rem plus the bottom safe area for this bar. */
export function MobileQuickActionBar({ actions }: MobileQuickActionBarProps) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('common.mobileActions')}
      className="surface-panel-strong fixed inset-x-0 bottom-0 z-20 border-t border-[var(--panel-border)] shadow-lg md:hidden"
    >
      <div className="mx-auto grid w-full max-w-lg grid-cols-3 gap-2 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {actions.map(({ key, icon: Icon, label, ariaLabel, onClick, disabled, buttonRef }) => (
          <button
            key={key}
            ref={buttonRef}
            type="button"
            onClick={onClick}
            aria-label={ariaLabel ?? label}
            title={ariaLabel ?? label}
            disabled={disabled}
            className="button-neutral flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="max-w-full truncate leading-4">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
