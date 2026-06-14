import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'

import type { AppEnv } from '../../../app/types'
import { serveGardenArtifact } from '../../../application/garden/artifact-response'
import type { GardenSiteBuildResolution } from '../../../application/garden/garden-service'
import {
  createGardenUnlockCookieValue,
  verifyGardenProtectedPassword,
  verifyGardenUnlockCookieValue,
} from '../../../application/garden/protected-access'
import { DomainErrorException } from '../../../shared/errors'
import { isReservedPublicPath } from '../../../shared/http-routing'
import { successEnvelope } from '../api-envelope'
import type { parseJsonBody } from '../parse-json-body'
import { parseJsonBodyAs } from '../route-support'
import {
  resolvePublicGardenRequestPath,
  resolvePublishedSiteBySlugOrDefault,
  toGardenService,
} from './garden-route-support'

const gardenUnlockCookieName = '05_04_garden_unlock'

const unlockInputSchema = z.object({
  password: z.string().min(1).max(200),
})

const toPublicBasePath = (resolution: GardenSiteBuildResolution): string =>
  resolution.site.isDefault ? '/' : `/${resolution.site.slug}`

const LANDING_LOGO_PATHS = [
  'M12.697 22V16.882H6.417a5.15 5.15 0 0 1-5.151-5.15V10.502c0-2.671 1.777-4.936 4.21-5.674L3.862.932 6.113 0l2.904 7.01H6.416a2.715 2.715 0 0 0-2.715 2.715v2.005a2.715 2.715 0 0 0 2.715 2.715h8.717v2.743c1.767-1.297 4.174-3.063 4.655-3.417a3.94 3.94 0 0 0 1.43-2.818V9.724a2.715 2.715 0 0 0-2.715-2.714h-7.769L9.666 4.573h8.836a5.15 5.15 0 0 1 5.151 5.151v1.228a5.24 5.24 0 0 1-2.425 4.783s-6.593 4.839-6.593 4.839L12.697 22Z',
  'M18.927.0004 16.461 5.953l2.251.933 2.466-5.953L18.927.0004Z',
  'M2.934 9.42H0v2.707h2.934V9.42Z',
  'M25.028 9.42h-2.934v2.707h2.934V9.42Z',
]

const renderPublicLanding = (_apiBasePath: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wonderlands</title>
  <style>
    :root{color-scheme:dark;--bg:#131316;--text:#d4d4d8;--text-secondary:#9494a0;--text-tertiary:#85859a;--accent:#5b9cf6;--border:rgba(255,255,255,0.08)}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100dvh;font-family:"Lexend Deca",system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2rem;padding:2rem}
    .logo{width:80px;height:70px;opacity:0.4}
    .logo path{fill:var(--text)}
    .links{display:flex;gap:0.75rem}
    a{display:inline-flex;align-items:center;height:2.25rem;padding:0 0.85rem;border:1px solid var(--border);border-radius:6px;font-size:0.8125rem;font-weight:500;color:var(--text-secondary);text-decoration:none;transition:border-color 150ms,color 150ms,background-color 150ms}
    a:hover{border-color:var(--accent);color:var(--text);background:rgba(91,156,246,0.06)}
    .hint{font-size:0.6875rem;color:var(--text-tertiary);letter-spacing:0.02em}
  </style>
</head>
<body>
  <svg class="logo" viewBox="0 0 25.03 22" aria-label="Wonderlands">${LANDING_LOGO_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>
  <div class="links">
    <a href="/ai/">Open Chat</a>
    <a href="/status">Status</a>
  </div>
  <p class="hint">Publish a default garden to replace this page.</p>
</body>
</html>`

const toCookieOptions = (
  c: Parameters<typeof parseJsonBody>[0],
  input: {
    maxAge: number
    publicBasePath: string
  },
) => ({
  httpOnly: true,
  maxAge: input.maxAge,
  path: input.publicBasePath,
  sameSite: c.get('config').auth.session.sameSite,
  secure: c.get('config').auth.session.secure,
})

const canAccessProtectedPages = (
  c: Parameters<typeof parseJsonBody>[0],
  resolution: GardenSiteBuildResolution,
): boolean => {
  if (
    resolution.site.protectedAccessMode !== 'site_password' ||
    !resolution.site.protectedSecretRef
  ) {
    return false
  }

  const cookieValue = getCookie(c, gardenUnlockCookieName)

  if (!cookieValue) {
    return false
  }

  return verifyGardenUnlockCookieValue({
    buildId: resolution.build.id,
    cookieValue,
    nowMs: Date.parse(c.get('services').clock.nowIso()),
    secretMaterial: resolution.site.protectedSecretRef,
    siteId: resolution.site.id,
  })
}

const unlockSite = async (
  c: Parameters<typeof parseJsonBody>[0],
  resolution: GardenSiteBuildResolution,
) => {
  const parsedInput = await parseJsonBodyAs(c, unlockInputSchema)

  if (
    resolution.site.protectedAccessMode !== 'site_password' ||
    !resolution.site.protectedSecretRef
  ) {
    throw new DomainErrorException({
      message: `garden site ${resolution.site.slug} does not support password unlock`,
      type: 'conflict',
    })
  }

  if (!verifyGardenProtectedPassword(parsedInput.password, resolution.site.protectedSecretRef)) {
    throw new DomainErrorException({
      message: 'Invalid garden password',
      type: 'auth',
    })
  }

  const nowMs = Date.parse(c.get('services').clock.nowIso())
  const expiresAt = nowMs + resolution.site.protectedSessionTtlSeconds * 1000
  const cookieValue = createGardenUnlockCookieValue({
    buildId: resolution.build.id,
    expiresAt,
    secretMaterial: resolution.site.protectedSecretRef,
    siteId: resolution.site.id,
  })

  setCookie(
    c,
    gardenUnlockCookieName,
    cookieValue,
    toCookieOptions(c, {
      maxAge: resolution.site.protectedSessionTtlSeconds,
      publicBasePath: toPublicBasePath(resolution),
    }),
  )

  return c.json(
    successEnvelope(c, {
      expiresAt: new Date(expiresAt).toISOString(),
      unlocked: true,
    }),
    200,
  )
}

const lockSite = (c: Parameters<typeof parseJsonBody>[0], publicBasePath: string) => {
  deleteCookie(
    c,
    gardenUnlockCookieName,
    toCookieOptions(c, {
      maxAge: 0,
      publicBasePath,
    }),
  )

  return c.json(
    successEnvelope(c, {
      locked: true,
    }),
    200,
  )
}

const serveResolvedSite = (
  c: Parameters<typeof parseJsonBody>[0],
  resolution: GardenSiteBuildResolution,
  requestPath: string,
) =>
  serveGardenArtifact(c, {
    allowProtected: canAccessProtectedPages(c, resolution),
    mountBasePath: toPublicBasePath(resolution),
    requestPath,
    resolution,
  })

export const createGardenPublicRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.post('/_auth/unlock', async (c) => {
    const resolution = toGardenService(c).resolvePublishedDefaultSite()

    if (!resolution.ok) {
      throw new DomainErrorException(resolution.error)
    }

    return unlockSite(c, resolution.value)
  })

  routes.post('/_auth/lock', (c) => lockSite(c, '/'))

  routes.post('/:siteSlug/_auth/unlock', async (c) => {
    const resolution = toGardenService(c).resolvePublishedSiteBySlug(c.req.param('siteSlug'))

    if (!resolution.ok) {
      throw new DomainErrorException(resolution.error)
    }

    return unlockSite(c, resolution.value)
  })

  routes.post('/:siteSlug/_auth/lock', (c) => lockSite(c, `/${c.req.param('siteSlug')}`))

  routes.get('/:siteSlug', async (c) => {
    const resolved = resolvePublishedSiteBySlugOrDefault(c, c.req.param('siteSlug'))

    if (!resolved) {
      return c.text('Not found', 404)
    }

    return serveResolvedSite(
      c,
      resolved.resolution,
      resolved.fallbackToDefault ? (resolvePublicGardenRequestPath(c.req.path) ?? '/') : '/',
    )
  })

  routes.get('/:siteSlug/*', async (c) => {
    const resolved = resolvePublishedSiteBySlugOrDefault(c, c.req.param('siteSlug'))

    if (!resolved) {
      return c.text('Not found', 404)
    }

    const requestPath = resolved.fallbackToDefault
      ? resolvePublicGardenRequestPath(c.req.path)
      : resolvePublicGardenRequestPath(c.req.path, {
          mountBasePath: `/${c.req.param('siteSlug')}`,
        })

    if (!requestPath) {
      return c.text('Not found', 404)
    }

    return serveResolvedSite(c, resolved.resolution, requestPath)
  })

  routes.get('/', async (c) => {
    const resolution = toGardenService(c).resolvePublishedDefaultSite()

    if (!resolution.ok) {
      return c.html(renderPublicLanding(c.get('config').api.basePath), 200)
    }

    return serveResolvedSite(c, resolution.value, '/')
  })

  routes.get('/*', async (c) => {
    const apiBasePath = c.get('config').api.basePath
    const resolution = toGardenService(c).resolvePublishedDefaultSite()

    if (!resolution.ok) {
      return c.text('Not found', 404)
    }

    const requestPath = resolvePublicGardenRequestPath(c.req.path)

    if (!requestPath) {
      return c.text('Not found', 404)
    }

    if (isReservedPublicPath(apiBasePath, requestPath)) {
      return c.text('Not found', 404)
    }

    return serveResolvedSite(c, resolution.value, requestPath)
  })

  return routes
}
