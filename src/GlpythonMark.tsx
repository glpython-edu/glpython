// glpython's mark (the logo without its square): a balance bike that is also
// an expression tree - the saddle a node, the two lines to the wheels edges
// to two leaves. In currentColor, for the top bar's ink square; the same
// drawing as public/favicon.svg.
export function GlpythonMark({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="7.25" y="7.5" width="8.5" height="3.8" rx="1.6" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.5 10.8 L8.5 21.5 M11.5 10.8 L23.5 21.5" />
        <circle cx="8.5" cy="21.5" r="5" />
        <circle cx="23.5" cy="21.5" r="5" />
      </g>
    </svg>
  )
}
