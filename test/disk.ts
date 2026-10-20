import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every file under a folder, path and bytes, as one string: what a test
 * compares to say "nothing was written". The store is a folder since layout 2
 * (`list/book.ts`), so "the file did not change" is "no file in it did".
 */
export function fingerprint(dir: string): string {
  if (!existsSync(dir)) return ''
  const out: string[] = []
  const walk = (at: string, rel: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path, `${rel}${name}/`)
      else out.push(`${rel}${name}\n${readFileSync(path, 'utf8')}`)
    }
  }
  walk(dir, '')
  return out.join('\n---\n')
}
