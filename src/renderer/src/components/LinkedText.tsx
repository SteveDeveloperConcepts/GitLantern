import type { IssueLinkRule } from '../../../shared/types'
import { linkify } from '../issueLinks'

const api = window.api

/** Text with issue numbers turned into links, which open in the browser. */
export function LinkedText({ text, rules }: { text: string; rules: IssueLinkRule[] }) {
  return (
    <>
      {linkify(text, rules).map((part, index) =>
        part.url ? (
          <a
            key={index}
            href={part.url}
            title={part.url}
            onClick={(event) => {
              event.preventDefault()
              void api.tools.openUrl(part.url ?? '')
            }}
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  )
}
