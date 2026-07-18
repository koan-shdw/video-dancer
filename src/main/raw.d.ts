// vite `?raw` imports (bundled text assets — the guide MDs) resolve to their file content
declare module '*.md?raw' {
  const text: string
  export default text
}
