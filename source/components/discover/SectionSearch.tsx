import { Search } from '@/components/listen/icons/Icons';
import { cn } from '@/lib/utils';

interface Props {
  placeholder?: string;
  /** Column mode: fill the remaining header width instead of a fixed 280px. */
  fluid?: boolean;
  /** Controlled query — one string per section, owned by DiscoverPage. */
  value: string;
  onChange: (value: string) => void;
}

export function SectionSearch({
  placeholder = 'Search tokens, tickers, contracts',
  fluid = false,
  value,
  onChange,
}: Props) {
  return (
    <div
      className={cn(
        'section-search flex items-center gap-2 rounded-[8px] transition-colors',
        fluid
          ? 'h-[26px] w-[var(--col-search-w)] min-w-0 max-w-full px-2'
          : 'h-[30px] w-[280px] max-w-[40%] px-2.5',
      )}
      style={{
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
      }}
    >
      <Search
        style={{ width: 14, height: 14, color: 'var(--ink-3)', flexShrink: 0 }}
      />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[11px] leading-none outline-none placeholder:text-[var(--ink-3)] focus:outline-none"
        style={{ color: 'var(--ink-1)' }}
      />
    </div>
  );
}
