import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function CollapsibleFormSection({
  caption,
  defaultOpen = true,
  isFirst,
  children,
}: {
  caption: string | null;
  defaultOpen?: boolean;
  isFirst?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!caption) {
    return (
      <div className={isFirst ? '' : 'pt-4 border-t border-gray-100'}>
        {children}
      </div>
    );
  }

  return (
    <div className={isFirst ? '' : 'pt-4 border-t border-gray-100'}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 mb-3 py-1 hover:bg-gray-50 rounded transition-colors"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
          <span className="w-1 h-4 bg-blue-600 rounded-full shrink-0" />
          {caption}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && children}
    </div>
  );
}
