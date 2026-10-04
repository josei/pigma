import { Icon, type IconName } from './icons';

interface ToolButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function ToolButton({ icon, label, shortcut, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar__button${active ? ' toolbar__button--active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={shortcut ? `${label}  ${shortcut}` : label}
    >
      <Icon name={icon} />
    </button>
  );
}
