import { useEffect, useMemo, useRef, useState } from 'react'
import type { PhotoRecord } from '../../domain/types'
import { Badge } from '../../ui'
import { COPY } from './copy'
import { describePhoto } from './helpers'

/**
 * Object URLs for the stored Blobs. They are created after mount and revoked on unmount, and they are only rebuilt when
 * the set of photos changes (a live-query refresh hands back equal photos in new objects; rebuilding would flash them).
 */
function usePhotoUrls(photos: readonly PhotoRecord[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const latest = useRef(photos)
  latest.current = photos
  const key = photos.map((p) => p.id).join('|')

  useEffect(() => {
    const made: Record<string, string> = {}
    for (const photo of latest.current) made[photo.id] = URL.createObjectURL(photo.blob)
    setUrls(made)
    return () => {
      for (const url of Object.values(made)) URL.revokeObjectURL(url)
    }
  }, [key])

  return urls
}

const VERDICT_TONE = { pass: 'green', issues: 'amber', fail: 'red' } as const
const VERDICT_WORD = { pass: 'QC passed', issues: 'QC problems', fail: 'QC failed' } as const

export function PhotoSection({ photos }: { photos: readonly PhotoRecord[] }) {
  const urls = usePhotoUrls(photos)
  const views = useMemo(() => photos.map(describePhoto), [photos])

  return (
    <section className="rp-section" aria-labelledby="rp-photos-h">
      <h2 className="rp-h2" id="rp-photos-h">
        {COPY.photosTitle}
      </h2>
      {views.length === 0 ? (
        <p className="u-dim">{COPY.photosNone}</p>
      ) : (
        <>
          <p className="u-dim u-small">{COPY.photosNote}</p>
          <ul className="rp-photos">
            {views.map((view) => (
              <li key={view.id} className="rp-photo">
                <figure className="rp-photo__fig">
                  {urls[view.id] ? <img className="rp-photo__img" src={urls[view.id]} alt={view.alt} /> : <div className="rp-photo__img rp-photo__img--wait" aria-hidden="true" />}
                  <figcaption className="rp-photo__cap">
                    <span className="rp-photo__name">{view.shotLabel}</span>
                    <span className="u-dim u-small u-num"> · {view.sizeText}</span>
                  </figcaption>
                </figure>
                <div className="rp-photo__qc">
                  <Badge tone={VERDICT_TONE[view.verdict]}>{VERDICT_WORD[view.verdict]}</Badge>
                  <p className="rp-photo__verdict">{view.verdictText}</p>
                  {view.issues.length > 0 ? (
                    <ul className="rp-photo__issues">
                      {view.issues.map((issue) => (
                        <li key={issue.id}>
                          <strong>{issue.label}</strong> (limit {issue.limit}). {issue.hint}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ul className="rp-photo__facts u-dim u-small">
                    {view.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                  {view.checks.length > 0 ? (
                    <details className="rp-stored">
                      <summary>All {view.checks.length} checks</summary>
                      <ul className="rp-photo__checks">
                        {view.checks.map((check) => (
                          <li key={check.id}>
                            <span className="rp-photo__check-state">{check.ok ? 'OK' : 'Failed'}</span> {check.label}, limit {check.limit}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
