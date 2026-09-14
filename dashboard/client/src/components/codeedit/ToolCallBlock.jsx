import { useState } from 'react'

// A collapsible "Nexus is editing <file>..." block, styled after Claude Code's tool-call blocks.
export function ToolCallBlock({ filePath, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-[#1a1d27] border border-[#1e2130] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[#20232f] transition-colors"
      >
        <span className={'text-gray-500 text-xs transition-transform ' + (open ? 'rotate-90' : '')}>▶</span>
        <span className="text-brand-400">📝</span>
        <span className="text-gray-200 text-sm font-medium">
          Nexus modifie <code className="text-brand-300 font-mono">{filePath}</code>
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}
