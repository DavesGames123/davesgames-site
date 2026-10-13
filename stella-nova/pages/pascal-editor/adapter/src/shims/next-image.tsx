// Stand-in for next/image. The editor packages import next/image for icons
// and thumbnails. No Next.js server runs here, so this renders a plain <img>.
// A root path ("/icons/x.webp") becomes "./icons/x.webp", so it loads from
// the build folder and not from the site root.
import { type CSSProperties, forwardRef, type ImgHTMLAttributes } from 'react'

type StaticImport = { src: string; width?: number; height?: number }

export type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | StaticImport
  fill?: boolean
  priority?: boolean
  unoptimized?: boolean
  quality?: number | string
  placeholder?: string
  blurDataURL?: string
  loader?: unknown
  overrideSrc?: string
}

export function localSrc(src: string): string {
  return src.startsWith('/') && !src.startsWith('//') ? `.${src}` : src
}

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    fill,
    priority,
    unoptimized: _unoptimized,
    quality: _quality,
    placeholder: _placeholder,
    blurDataURL: _blur,
    loader: _loader,
    overrideSrc: _override,
    style,
    loading,
    ...rest
  },
  ref,
) {
  const raw = typeof src === 'string' ? src : src.src
  const fillStyle: CSSProperties | undefined = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
    : undefined
  return (
    <img
      {...rest}
      decoding="async"
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      ref={ref}
      src={localSrc(raw)}
      style={fillStyle ? { ...fillStyle, ...style } : style}
    />
  )
})

export default Image
