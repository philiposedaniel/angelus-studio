'use client'

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="w-fit rounded-full border border-ivory/30 px-5 py-2 text-sm text-ivory transition-colors hover:border-gold hover:text-gold print:hidden"
    >
      {label}
    </button>
  )
}
