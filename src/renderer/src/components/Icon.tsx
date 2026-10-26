const PATHS = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  branch: 'M6 7v10M18 9c0 4-6 4-11 9M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0M8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  chevron: 'M6 9l6 6 6-6',
  fetch: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  pull: 'M12 4v14M6 12l6 6 6-6',
  push: 'M12 20V6M6 12l6-6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M5 12l5 5L20 7',
  clone: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  key: 'M10.8 12.2L20 3M16 7l3 3M14 9l2 2M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  warning: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  stash: 'M4 7h16M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 3h6M12 11v6M9 14l3 3 3-3',
  pop: 'M4 7h16M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 3h6M12 17v-6M9 14l3-3 3 3',
  discard: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM21 21l-5-5',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pullRequest: 'M6 8v13M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 16V9a3 3 0 0 0-3-3h-4M13 3l-2 3 2 3M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'
} as const

export type IconName = keyof typeof PATHS

/** Stroke icons drawn inline so they follow the text color. */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
