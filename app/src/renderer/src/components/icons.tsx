/** 内联 SVG 图标（线性风格，随 currentColor） */

type P = { size?: number }

export const PlayIcon = ({ size = 14 }: P): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M4.5 2.8v10.4c0 .6.7 1 1.2.7l8.2-5.2c.5-.3.5-1 0-1.3L5.7 2.1c-.5-.3-1.2.1-1.2.7z" />
  </svg>
)

export const PauseIcon = ({ size = 14 }: P): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
    <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
  </svg>
)

export const StopSquareIcon = ({ size = 12 }: P): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="3" y="3" width="10" height="10" rx="2" />
  </svg>
)

export const DownloadIcon = ({ size = 13 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M8 2.5v8" />
    <path d="M4.5 7.5 8 11l3.5-3.5" />
    <path d="M2.5 13.5h11" />
  </svg>
)

export const WaveGlyph = ({ size = 15 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M2 6.5v3" />
    <path d="M5 4v8" />
    <path d="M8 2v12" />
    <path d="M11 5v6" />
    <path d="M14 7v2" />
  </svg>
)

export const PersonGlyph = ({ size = 15 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx="8" cy="5" r="2.6" />
    <path d="M2.8 13.5c.7-2.6 2.7-4 5.2-4s4.5 1.4 5.2 4" />
  </svg>
)

export const TunerGlyph = ({ size = 15 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M2 8h2.5l1.5-4 2.5 8 2-5.5 1 1.5H14" />
  </svg>
)

export const SparkIcon = ({ size = 15 }: P): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 1.5 9.3 6 14 7.5 9.3 9 8 13.5 6.7 9 2 7.5 6.7 6z" />
  </svg>
)

export const PencilIcon = ({ size = 12 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m11.3 2.6 2.1 2.1L5.6 12.5l-2.8.7.7-2.8z" />
    <path d="m9.9 4 2.1 2.1" />
  </svg>
)

export const TrashIcon = ({ size = 12 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M2.5 4h11" />
    <path d="M5.5 4V2.8c0-.4.3-.8.8-.8h3.4c.5 0 .8.4.8.8V4" />
    <path d="M4 4l.6 9c0 .5.4.9.9.9h5c.5 0 .9-.4.9-.9L12 4" />
    <path d="M6.5 7v4M9.5 7v4" />
  </svg>
)

export const GearIcon = ({ size = 15 }: P): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
  </svg>
)
