// Vite `?raw` imports (text bundled into the build), e.g. the fictional SAP sample extract.
declare module '*?raw' {
  const text: string
  export default text
}
