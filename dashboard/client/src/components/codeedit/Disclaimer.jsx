export function Disclaimer() {
  return (
    <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 text-amber-200 text-sm leading-relaxed">
      <p className="font-semibold text-amber-300 mb-1">⚠️ Before you approve</p>
      <p>
        Nexus swears and can be crude in general — that's intentional, not a bug, and it can bleed
        into generated code comments or commit messages here. This is a small, local AI model — it
        <strong> will</strong> make mistakes, especially with code. You're responsible for reviewing
        every line of this diff before approving. Patrick and Nexus are not responsible for anything
        that goes wrong with your repo as a result of this feature.
      </p>
    </div>
  )
}
