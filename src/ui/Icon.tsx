const PATHS = {
  new: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6',
  example: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3z',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  // Fit: arrows from the corners inward to a small centred frame.
  fit: 'M9.5 9.5h5v5h-5zM3 3l4.5 4.5M7.5 4.5v3h-3M21 3l-4.5 4.5M16.5 4.5v3h3M3 21l4.5-4.5M7.5 19.5v-3h-3M21 21l-4.5-4.5M16.5 19.5v-3h3',
  // Fullscreen: arrows from the centre outward to the corners.
  expand: 'M14 10l6-6M15 4h5v5M10 10L4 4M4 9V4h5M10 14l-6 6M4 15v5h5M14 14l6 6M20 15v5h-5',
  // Exit fullscreen: arrows from the corners back to the centre, no frame.
  shrink: 'M4 4l6 6M10 5v5H5M20 4l-6 6M14 5v5h5M4 20l6-6M5 14h5v5M20 20l-6-6M14 19v-5h5',
  panel: 'M4 4h16v16H4zM10 4v16',
  close: 'M18 6 6 18M6 6l12 12',
  chevron: 'M9 6l6 6-6 6',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
