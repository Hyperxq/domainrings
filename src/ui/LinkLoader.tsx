import { useState, type CSSProperties } from 'react'

// Core first: the order is the growth sequence, and each layer wears the ring colour it has on the map.
const LAYERS = [
  { ring: 'domain', radius: 4 },
  { ring: 'domainServices', radius: 10 },
  { ring: 'application', radius: 16 },
  { ring: 'adapters', radius: 22 },
]

const hexagon = (radius: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const angle = (k * Math.PI) / 3
    return `${(24 + radius * Math.cos(angle)).toFixed(2)},${(24 + radius * Math.sin(angle)).toFixed(2)}`
  }).join(' ')

/** Covers the canvas while a linked map is being fetched or decoded, so the map it replaces never reads as the answer. */
export function LinkLoader() {
  // The linked map's architecture is unknown until it loads, so the shape is a coin flip, drawn once per mount.
  const [round] = useState(() => Math.random() >= 0.5)
  return (
    <div className="link-loader">
      <div className="island link-loader-card" role="status" aria-live="polite">
        <svg className="link-loader-drawing" viewBox="0 0 48 48" aria-hidden="true">
          {LAYERS.map(({ ring, radius }, i) => {
            const props = { className: `link-loader-layer ring-${ring}`, style: { '--i': i } as CSSProperties }
            // Outermost first so the inner layers paint over it.
            return round ? <circle key={ring} {...props} cx={24} cy={24} r={radius} /> : <polygon key={ring} {...props} points={hexagon(radius)} />
          }).reverse()}
        </svg>
        <p>Opening the linked map…</p>
      </div>
    </div>
  )
}
