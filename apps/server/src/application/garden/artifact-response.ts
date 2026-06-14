import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import type { Context } from 'hono'

import type { AppEnv } from '../../app/types'
import { DomainErrorException } from '../../shared/errors'
import { GARDEN_PROTECTED_SEARCH_STATE_TOKEN } from './compiler/render-page'
import type { GardenSiteBuildResolution } from './garden-service'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const serializeJsonForHtml = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

export const normalizeGardenRequestPath = (value: string | undefined): string | null => {
  if (!value) {
    return '/'
  }

  const segments = value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }

  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

const toContentType = (artifactPath: string): string => {
  switch (extname(artifactPath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.gif':
      return 'image/gif'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.ico':
      return 'image/x-icon'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.webp':
      return 'image/webp'
    case '.wasm':
      return 'application/wasm'
    case '.xml':
      return 'application/xml; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

const normalizeMountBasePath = (value: string): string => {
  const trimmed = value.trim()

  if (!trimmed || trimmed === '/') {
    return '/'
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

const prefixMountedPath = (mountBasePath: string, routePath: string): string => {
  if (mountBasePath === '/' || mountBasePath === '') {
    return routePath
  }

  return routePath === '/' ? mountBasePath : `${mountBasePath}${routePath}`
}

const toCanonicalGardenRoutePath = (requestPath: string): string | null => {
  if (requestPath === '/index.html') {
    return '/'
  }

  if (requestPath.endsWith('/index.html')) {
    return requestPath.slice(0, -'/index.html'.length) || '/'
  }

  if (requestPath.endsWith('.html')) {
    return requestPath.slice(0, -'.html'.length) || '/'
  }

  return null
}

const rewriteServedGardenHtml = (input: {
  allowProtected: boolean
  html: string
  mountBasePath: string
}): string => {
  const normalizedMountBasePath = normalizeMountBasePath(input.mountBasePath)
  const protectedSearchState = input.allowProtected ? 'available' : 'locked'
  const withProtectedSearchState = input.html.replaceAll(
    GARDEN_PROTECTED_SEARCH_STATE_TOKEN,
    protectedSearchState,
  )

  if (normalizedMountBasePath === '/') {
    return withProtectedSearchState
  }

  return withProtectedSearchState.replace(
    /data-garden-link="internal"\s+(href|src)="(\/[^"]*)"/g,
    (_match, attribute: 'href' | 'src', routePath: string) =>
      `data-garden-link="internal" ${attribute}="${prefixMountedPath(normalizedMountBasePath, routePath)}"`,
  )
}

const renderProtectedUnlockPage = (input: {
  mountBasePath: string
  requestPath: string
  siteTitle: string
}): string => {
  const normalizedMountBasePath = normalizeMountBasePath(input.mountBasePath)
  const unlockPath = prefixMountedPath(normalizedMountBasePath, '/_auth/unlock')
  const homePath = prefixMountedPath(normalizedMountBasePath, '/')
  const currentPath = prefixMountedPath(normalizedMountBasePath, input.requestPath)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.siteTitle)} · Protected</title>
  <style>
    :root{color-scheme:dark;--bg:#131316;--surface-0:#19191e;--surface-1:#212127;--text:#d4d4d8;--muted:#9494a0;--tertiary:#5e5e6e;--border:rgba(255,255,255,0.08);--border-strong:rgba(255,255,255,0.13);--danger:#f88}
    *{box-sizing:border-box}
    body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;font-family:"Lexend Deca",ui-sans-serif,system-ui,-apple-system,sans-serif;background:radial-gradient(circle,rgba(255,255,255,0.024) 1px,transparent 1px) 0 0/24px 24px,var(--bg);color:var(--text);font-size:.9375rem;line-height:1.7;-webkit-font-smoothing:antialiased}
    .card{width:min(100%,420px);padding:32px;border:1px solid var(--border);border-radius:12px;background:var(--surface-0);box-shadow:0 1px 3px rgba(0,0,0,0.2)}
    .eyebrow{margin:0 0 8px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--tertiary)}
    h1{margin:0 0 8px;font-size:1.5rem;line-height:1.2;font-family:"Lexend","Lexend Deca",ui-sans-serif,system-ui,sans-serif}
    p{margin:0;color:var(--muted);line-height:1.55;font-size:.875rem}
    code{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8125rem}
    form{margin-top:20px}
    label{display:block;margin-bottom:8px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--tertiary)}
    input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);color:var(--text);font:inherit;font-size:14px;transition:border-color .15s}
    input::placeholder{color:var(--tertiary)}
    input:focus{outline:none;border-color:var(--border-strong)}
    button{width:100%;height:36px;margin-top:12px;border:0;border-radius:6px;background:var(--text);color:var(--bg);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
    button:hover{opacity:.9}
    button:active{transform:scale(.96)}
    button[disabled]{opacity:.25;cursor:wait}
    .message{min-height:20px;margin-top:12px;font-size:13px;color:var(--danger)}
    .hint{margin-top:16px;font-size:12px;color:var(--tertiary)}
    .back{display:inline-flex;margin-top:18px;font-size:13px;color:var(--muted);text-decoration:none;transition:color .15s}
    .back:hover{color:var(--text)}
  </style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">Protected Page</p>
    <h1>Password required</h1>
    <p>This page is published as protected. Enter the shared site password to continue to <code>${escapeHtml(currentPath)}</code>.</p>
    <form id="unlock-form">
      <label for="garden-password">Password</label>
      <input id="garden-password" name="password" type="password" placeholder="Enter password" autocomplete="current-password" required>
      <button type="submit">Unlock page</button>
      <p class="message" id="unlock-message" hidden></p>
    </form>
    <p class="hint">Protected pages are not shown in the public menu. Visit a direct link to a protected route to unlock it.</p>
    <a class="back" href="${escapeHtml(homePath)}">Back to home</a>
  </main>
  <script>
    (() => {
      const form = document.getElementById('unlock-form');
      const input = document.getElementById('garden-password');
      const message = document.getElementById('unlock-message');
      const unlockPath = ${serializeJsonForHtml(unlockPath)};
      const redirectPath = ${serializeJsonForHtml(currentPath)};

      if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) || !(message instanceof HTMLElement)) {
        return;
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        message.hidden = true;
        const button = form.querySelector('button[type="submit"]');
        if (button instanceof HTMLButtonElement) {
          button.disabled = true;
        }

        try {
          const response = await fetch(unlockPath, {
            body: JSON.stringify({ password: input.value }),
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/json',
            },
            method: 'POST',
          });

          if (!response.ok) {
            let errorMessage = 'Could not unlock this page.';
            try {
              const payload = await response.json();
              if (payload && typeof payload === 'object' && payload.ok === false && payload.error && typeof payload.error.message === 'string') {
                errorMessage = payload.error.message;
              }
            } catch {}
            message.textContent = errorMessage;
            message.hidden = false;
            return;
          }

          window.location.href = redirectPath;
        } catch {
          message.textContent = 'Network error while unlocking this page.';
          message.hidden = false;
        } finally {
          if (button instanceof HTMLButtonElement) {
            button.disabled = false;
          }
        }
      });

      input.focus();
    })();
  </script>
</body>
</html>`
}

const serveSearchArtifact = async (
  c: Context<AppEnv>,
  input: {
    allowProtected: boolean
    requestPath: string
    resolution: GardenSiteBuildResolution
  },
): Promise<Response | null> => {
  const manifest = input.resolution.build.manifestJson?.search

  if (!manifest?.enabled) {
    return null
  }

  const candidates = [
    {
      allow: true,
      bundle: manifest.publicBundle,
      rootRef: input.resolution.build.publicArtifactRoot,
    },
    ...(manifest.protectedBundle
      ? [
          {
            allow: input.allowProtected,
            bundle: manifest.protectedBundle,
            rootRef: input.resolution.build.protectedArtifactRoot,
          },
        ]
      : []),
  ]

  for (const candidate of candidates) {
    const bundlePrefix = candidate.bundle.artifactPrefix.replace(/\/+$/, '')

    if (input.requestPath !== bundlePrefix && !input.requestPath.startsWith(`${bundlePrefix}/`)) {
      continue
    }

    if (!candidate.allow) {
      return c.text('Protected', 401)
    }

    if (!candidate.rootRef) {
      throw new DomainErrorException({
        message: `garden build ${input.resolution.build.id} is missing search artifacts for ${bundlePrefix}`,
        type: 'conflict',
      })
    }

    const artifactPath = input.requestPath.replace(/^\/+/, '')

    try {
      const body = await readFile(resolve(candidate.rootRef, artifactPath))

      return new Response(body, {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': toContentType(artifactPath),
        },
        status: 200,
      })
    } catch {
      return c.text('Not found', 404)
    }
  }

  return null
}

export const serveGardenArtifact = async (
  c: Context<AppEnv>,
  input: {
    allowProtected: boolean
    mountBasePath: string
    requestPath: string
    resolution: GardenSiteBuildResolution
  },
): Promise<Response> => {
  const manifest = input.resolution.build.manifestJson

  if (!manifest) {
    throw new DomainErrorException({
      message: `garden build ${input.resolution.build.id} is missing a manifest`,
      type: 'conflict',
    })
  }

  const page = manifest.pages.find((candidate) => candidate.routePath === input.requestPath)

  if (page) {
    if (page.visibility === 'protected' && !input.allowProtected) {
      return c.html(
        renderProtectedUnlockPage({
          mountBasePath: input.mountBasePath,
          requestPath: input.requestPath,
          siteTitle: input.resolution.site.name,
        }),
        401,
      )
    }

    const artifactRootRef =
      page.visibility === 'protected'
        ? input.resolution.build.protectedArtifactRoot
        : input.resolution.build.publicArtifactRoot

    if (!artifactRootRef) {
      throw new DomainErrorException({
        message: `garden build ${input.resolution.build.id} is missing artifacts for ${page.routePath}`,
        type: 'conflict',
      })
    }

    const body = await readFile(resolve(artifactRootRef, page.artifactPath), 'utf8')
    const etag = `"${input.resolution.build.id}:${page.artifactPath}"`

    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304 })
    }

    return new Response(
      rewriteServedGardenHtml({
        allowProtected: input.allowProtected,
        html: body,
        mountBasePath: input.mountBasePath,
      }),
      {
        headers: {
          'cache-control': 'public, max-age=0, must-revalidate',
          'content-type': 'text/html; charset=utf-8',
          etag: etag,
        },
        status: 200,
      },
    )
  }

  const searchArtifact = await serveSearchArtifact(c, input)

  if (searchArtifact) {
    return searchArtifact
  }

  if (input.requestPath !== '/') {
    const artifactPath = input.requestPath.slice(1)
    const asset = manifest.assets.find((candidate) => candidate.artifactPath === artifactPath)

    if (asset) {
      if (!input.resolution.build.publicArtifactRoot) {
        throw new DomainErrorException({
          message: `garden build ${input.resolution.build.id} is missing public assets`,
          type: 'conflict',
        })
      }

      const body = await readFile(
        resolve(input.resolution.build.publicArtifactRoot, asset.artifactPath),
      )

      return new Response(body, {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': toContentType(asset.artifactPath),
        },
        status: 200,
      })
    }
  }

  const canonicalRoutePath = toCanonicalGardenRoutePath(input.requestPath)

  if (canonicalRoutePath) {
    const canonicalPage = manifest.pages.find(
      (candidate) => candidate.routePath === canonicalRoutePath,
    )

    if (canonicalPage) {
      const requestUrl = new URL(c.req.url)
      const location = `${prefixMountedPath(input.mountBasePath, canonicalRoutePath)}${requestUrl.search}`

      return c.redirect(location, 308)
    }
  }

  return c.text('Not found', 404)
}
