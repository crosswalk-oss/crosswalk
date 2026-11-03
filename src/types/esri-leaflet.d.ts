declare module 'esri-leaflet' {
  export function featureLayer(opts: Record<string, unknown>): any
  export function dynamicMapLayer(opts: Record<string, unknown>): any
  export function tiledMapLayer(opts: Record<string, unknown>): any
  export function query(opts: Record<string, unknown>): any
}
