// The write log (08-27 brief, item 9): under a Co-Director reply, the tools it ran in that reply,
// one line each, as the app recorded them. The referee for "did you change that?": what is listed
// here ran; what is not listed did not. Shared by the panel and the Director's Room.
export function RanTools({ tools, size }: { tools?: string[]; size: number }): React.JSX.Element | null {
  if (!tools?.length) return null
  return (
    <div
      title="what it ran in this reply, as the app recorded it"
      style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: size, lineHeight: 1.45, color: 'var(--dim)', whiteSpace: 'pre-wrap' }}
    >
      {tools.map((t) => `ran ${t}`).join('\n')}
    </div>
  )
}
