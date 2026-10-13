// Stand-in for next/navigation. The static page has one route, so the
// router reloads the page or changes location.
export function useRouter() {
  return {
    push: (url: string) => window.location.assign(url),
    replace: (url: string) => window.location.replace(url),
    refresh: () => window.location.reload(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    prefetch: () => {},
  }
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

export function usePathname(): string {
  return '/'
}

export function useParams(): Record<string, string> {
  return {}
}

export function notFound(): never {
  throw new Error('not found')
}

export function redirect(url: string): never {
  window.location.assign(url)
  throw new Error('redirect')
}
