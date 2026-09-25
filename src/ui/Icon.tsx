const PATHS = {
  new: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6',
  example: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3z',
  upload: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 16V4M7 9l5-5 5 5',
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
  info: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  // Two overlapping chain links, a common "copy link" glyph.
  link: 'M9 15l6-6M8 7l1-1a4 4 0 0 1 6 6l-1 1M16 17l-1 1a4 4 0 0 1-6-6l1-1',
} as const

// GitHub's mark (Octicon `mark-github`): a filled shape on a 16-unit grid, unlike the stroked line icons above.
const GITHUB_MARK =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'

export type IconName = keyof typeof PATHS | 'github'

export function Icon({ name }: { name: IconName }) {
  if (name === 'github') {
    return (
      <svg className="icon icon-solid" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
        <path d={GITHUB_MARK} />
      </svg>
    )
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
