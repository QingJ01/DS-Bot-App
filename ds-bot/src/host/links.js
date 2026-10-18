// File links in a Bot's text, read as DSH's chat reads them: a Markdown link (or image) to
// a path, with an optional #L12 or #L12-L20. A relative path names a file in the folder of
// the Session that wrote it, and DSH opens it from the folder of the Session that shows it.
// Text that goes on to another Session (a group, another Bot) may land in another folder,
// so its relative file links are made absolute first.
import { resolve } from 'node:path'

// Code is left as written: a link there is an example, not a link.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g
const LINK = /(!?\[[^\]\n]*\]\()(<[^<>\n]*>|[^\s()<>]+)((?:\s+"[^"\n]*")?\))/g
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/
const SCHEME = /^[a-z][a-z\d+.-]*:/i

function relativeFile(destination) {
  const hash = destination.indexOf('#')
  const target = hash < 0 ? destination : destination.slice(0, hash)
  const fragment = hash < 0 ? '' : destination.slice(hash)
  if (target === '' || target.includes('?') || (fragment !== '' && !/^#L[1-9]\d*(?:-L[1-9]\d*)?$/.test(fragment))) return undefined
  let path
  try {
    path = decodeURIComponent(target)
  } catch {
    return undefined
  }
  const control = [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  if (control || /^[\\/]{2}/.test(path) || ABSOLUTE.test(path) || SCHEME.test(path) || path.startsWith('~')) return undefined
  return { path, fragment }
}

// DSH decodes the link back to the path, so `%` and what would end the link are escaped.
const href = path => path.replace(/\\/g, '/').replace(/[%\s()<>]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)

export function absoluteLinks(text, folder) {
  if (typeof text !== 'string' || !folder || !text.includes('](')) return text
  return text.split(CODE).map((part, index) => (index % 2 === 1 ? part : part.replace(LINK, (whole, open, destination, close) => {
    const file = relativeFile(destination.startsWith('<') ? destination.slice(1, -1) : destination)
    return file === undefined ? whole : `${open}${href(resolve(folder, file.path))}${file.fragment}${close}`
  }))).join('')
}
