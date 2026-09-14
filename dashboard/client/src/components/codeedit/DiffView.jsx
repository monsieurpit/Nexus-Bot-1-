// Renders a `diff` library `lineDiff` (array of { added?, removed?, value }) as a monospace
// red/green line-by-line diff, à la GitHub / Claude Code.
export function DiffView({ lineDiff }) {
  if (!Array.isArray(lineDiff) || lineDiff.length === 0) {
    return <p className="text-gray-500 text-sm italic">No diff to show.</p>
  }

  const rows = []
  for (const part of lineDiff) {
    const lines = part.value.split('\n')
    // split('\n') on a trailing-newline string produces a trailing empty entry — drop it so we
    // don't render a phantom blank row at the end of every added/removed/context block.
    if (lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      rows.push({ type: part.added ? 'add' : part.removed ? 'del' : 'ctx', text: line })
    }
  }

  return (
    <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg overflow-x-auto font-mono text-xs">
      {rows.map((row, i) => (
        <div
          key={i}
          className={
            'px-3 py-0.5 whitespace-pre ' +
            (row.type === 'add'
              ? 'bg-green-900/25 text-green-300'
              : row.type === 'del'
              ? 'bg-red-900/25 text-red-300'
              : 'text-gray-400')
          }
        >
          <span className="select-none opacity-60 mr-2">
            {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
          </span>
          {row.text || ' '}
        </div>
      ))}
    </div>
  )
}
