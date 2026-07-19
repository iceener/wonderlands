const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const renderOauthCompletionPage = (input: {
  message: string
  responseOrigin: string | null
  serverId: string | null
  status: 'authorized' | 'error'
}) => {
  const payload = JSON.stringify({
    message: input.message,
    serverId: input.serverId,
    status: input.status,
    type: '05_04_api.mcp_oauth',
  }).replace(/</g, '\\u003c')
  const targetOrigin = JSON.stringify(input.responseOrigin ?? '*')

  const isSuccess = input.status === 'authorized'
  const statusLabel = isSuccess ? 'Authorization complete' : 'Authorization failed'
  const statusColor = isSuccess ? '#4ade80' : '#f87171'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${statusLabel}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      html{background:#09090b;color:#ececef;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
      body{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
      .logo{width:80px;height:72px;margin-bottom:2rem;opacity:0.18}
      .status{font-size:15px;font-weight:600;color:${statusColor};margin-bottom:0.5rem}
      .message{font-size:13px;color:#a0a0ab;line-height:1.6;text-align:center;max-width:28rem}
      .hint{margin-top:1.5rem;font-size:11px;color:#63636e}
    </style>
  </head>
  <body>
    <svg class="logo" viewBox="0 0 25.03 22" fill="currentColor" aria-hidden="true">
      <path d="M12.697 22V16.882H6.417a5.15 5.15 0 0 1-5.151-5.15V10.502c0-2.671 1.777-4.936 4.21-5.674L3.862.932 6.113 0l2.904 7.01H6.416a2.715 2.715 0 0 0-2.715 2.715v2.005a2.715 2.715 0 0 0 2.715 2.715h8.717v2.743c1.767-1.297 4.174-3.063 4.655-3.417a3.94 3.94 0 0 0 1.43-2.818V9.724a2.715 2.715 0 0 0-2.715-2.714h-7.769L9.666 4.573h8.836a5.15 5.15 0 0 1 5.151 5.151v1.228a5.24 5.24 0 0 1-2.425 4.783s-6.593 4.839-6.593 4.839L12.697 22Z"/>
      <path d="M18.927.0004 16.461 5.953l2.251.933 2.466-5.953L18.927.0004Z"/>
      <path d="M2.934 9.42H0v2.707h2.934V9.42Z"/>
      <path d="M25.028 9.42h-2.934v2.707h2.934V9.42Z"/>
    </svg>
    <div class="status">${escapeHtml(statusLabel)}</div>
    <p class="message">${escapeHtml(input.message)}</p>
    <p class="hint">This window will close automatically.</p>
    <script>
      const payload = ${payload};
      const targetOrigin = ${targetOrigin};
      const notifyOpener = function() {
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(payload, targetOrigin);
            return true;
          } catch {}
        }

        return false;
      };

      if (notifyOpener()) {
        setTimeout(notifyOpener, 250);
        setTimeout(notifyOpener, 700);
        setTimeout(function() { window.close(); }, 1200);
      }
    </script>
  </body>
</html>`
}
