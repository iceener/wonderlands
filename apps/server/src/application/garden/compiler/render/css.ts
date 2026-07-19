// Garden page CSS payload.
// Kept verbatim to preserve exact emitted bytes for renderGardenPage().

export const GARDEN_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}

:root{
color-scheme:light;
--bg:#fff;
--surface-0:#fcfcfc;
--surface-1:#f4f4f5;
--surface-2:#e4e4e7;
--border:#e4e4e7;
--border-strong:#d4d4d8;
--text:#09090b;
--text-secondary:#52525b;
--text-tertiary:#a1a1aa;
--accent:#2563eb;
--accent-soft:#eff6ff;
--accent-text:#1d4ed8;
--font-sans:"Lexend Deca",system-ui,-apple-system,sans-serif;
--font-heading:"Lexend","Lexend Deca",system-ui,sans-serif;
--font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}

@media(prefers-color-scheme:dark){
:root{
color-scheme:dark;
--bg:#131316;
--surface-0:#19191e;
--surface-1:#212127;
--surface-2:#2b2b33;
--border:#ffffff14;
--border-strong:#ffffff22;
--text:#d4d4d8;
--text-secondary:#9494a0;
--text-tertiary:#85859a;
--accent:#5b9cf6;
--accent-soft:#5b9cf612;
--accent-text:#7bb4fc;
}
body{border-top-color:color-mix(in srgb,var(--accent) 40%,transparent)}
}

html{
background:var(--bg);
color:var(--text);
-webkit-font-smoothing:antialiased;
-moz-osx-font-smoothing:grayscale;
text-rendering:optimizeSpeed;
}

body{
margin:0;
min-height:100dvh;
border-top:3px solid var(--accent);
font-family:var(--font-sans);
font-size:clamp(0.9375rem,0.88rem + 0.25vw,1.0625rem);
line-height:1.7;
letter-spacing:0.005em;
font-optical-sizing:auto;
}

.garden-shell{
display:block;
min-height:100dvh;
}

.skip-link{
position:absolute;
left:-9999px;
top:auto;
width:1px;
height:1px;
overflow:hidden;
font-size:0.8125rem;
background:var(--bg);
color:var(--accent-text);
padding:0.5rem 1rem;
border:1px solid var(--border);
border-radius:4px;
z-index:100;
text-decoration:none;
}
.skip-link:focus{
position:fixed;
left:1rem;
top:1rem;
width:auto;
height:auto;
overflow:visible;
}

.garden-search{
display:flex;
flex-direction:column;
gap:0.35rem;
}

.garden-search-field{
position:relative;
display:flex;
align-items:center;
}

.garden-search-input{
width:100%;
height:2.25rem;
padding:0 2.2rem 0 0.6rem;
border:1px solid var(--border);
border-radius:6px;
background:var(--surface-1);
color:var(--text);
font:inherit;
font-size:0.8125rem;
line-height:1.4;
-webkit-appearance:none;
appearance:none;
}

.garden-search-input::-webkit-search-cancel-button,
.garden-search-input::-webkit-search-decoration{
-webkit-appearance:none;
appearance:none;
display:none;
}

.garden-search-input::placeholder{
color:var(--text-tertiary);
font-size:0.8125rem;
}

.garden-search-input:focus-visible{
outline:none;
border-color:var(--border-strong);
background:var(--bg);
}

.garden-search-kbd{
position:absolute;
right:0.45rem;
display:flex;
align-items:center;
justify-content:center;
min-width:1.25rem;
height:1.25rem;
padding:0 0.3rem;
border:1px solid var(--border);
border-radius:4px;
background:var(--surface-0);
font-family:var(--font-sans);
font-size:0.625rem;
font-weight:500;
line-height:1;
color:var(--text-tertiary);
pointer-events:none;
}

.garden-search-input:focus ~ .garden-search-kbd{
display:none;
}

.garden-search-filters{
display:flex;
flex-wrap:wrap;
gap:0.3rem;
}

.garden-search-filters[hidden]{
display:none !important;
}

.garden-search-filter{
display:inline-flex;
align-items:center;
gap:0.35rem;
height:1.5rem;
padding:0 0.5rem;
border:1px solid var(--border);
border-radius:9999px;
background:transparent;
font-family:var(--font-sans);
font-size:0.6875rem;
font-weight:500;
line-height:1;
color:var(--text-secondary);
cursor:pointer;
transition:background-color 150ms ease,border-color 150ms ease,color 150ms ease;
}

.garden-search-filter:hover{
background:var(--surface-1);
color:var(--text);
}

.garden-search-filter.is-active{
background:var(--accent-soft);
border-color:color-mix(in srgb,var(--accent) 30%,transparent);
color:var(--text);
}

.garden-search-filter-count{
display:inline-flex;
align-items:center;
justify-content:center;
min-width:1rem;
padding:0 0.28rem;
border-radius:9999px;
background:var(--surface-1);
font-size:0.625rem;
font-weight:600;
line-height:1.1;
color:var(--text-tertiary);
}

.garden-search-filter.is-active .garden-search-filter-count{
background:color-mix(in srgb,var(--accent) 16%,var(--surface-0));
color:var(--text-secondary);
}

.garden-search-status{
font-size:0.6875rem;
font-weight:500;
letter-spacing:0.04em;
text-transform:uppercase;
line-height:1.5;
color:var(--text-tertiary);
}

.garden-search-results{
display:flex;
flex-direction:column;
}

.garden-search-results[hidden],
.garden-search-status[hidden]{
display:none !important;
}

.garden-search-empty{
padding:0.4rem 0.6rem;
font-size:0.8125rem;
line-height:1.5;
color:var(--text-tertiary);
}

.garden-search-error{
padding:0.4rem 0.6rem;
font-size:0.8125rem;
line-height:1.5;
color:var(--text-tertiary);
}

.garden-search-result{
display:block;
padding:0.45rem 0.6rem;
border-radius:6px;
text-decoration:none;
transition:background-color 150ms ease;
}

.garden-search-result:hover,
.garden-search-result.is-active{
background:var(--surface-1);
text-decoration:none;
}

.garden-search-result.is-active{
outline:none;
}

.garden-search-result-title{
display:block;
font-family:var(--font-heading);
font-size:0.8125rem;
font-weight:600;
line-height:1.35;
color:var(--text);
}

.garden-search-result-excerpt{
display:block;
margin-top:0.15rem;
font-size:0.75rem;
line-height:1.5;
color:var(--text-secondary);
}

.garden-search-result mark,
.garden-search-subresult mark{
padding:0.05em 0.15em;
border-radius:0.2em;
background:color-mix(in srgb,var(--accent) 18%,transparent);
color:var(--accent-text);
}

.garden-search-subresults{
margin-top:0.25rem;
display:flex;
flex-direction:column;
}

.garden-search-subresult{
display:block;
padding:0.2rem 0 0.2rem 0.7rem;
border-left:1px solid var(--border);
margin-left:0.35rem;
text-decoration:none;
transition:border-color 150ms ease;
}

.garden-search-subresult:hover{
text-decoration:none;
border-left-color:var(--accent);
}

.garden-search-subresult .garden-search-result-title{
font-size:0.75rem;
font-weight:500;
color:var(--text-secondary);
}

.garden-search-subresult:hover .garden-search-result-title{
color:var(--text);
}

.garden-search-subresult .garden-search-result-excerpt{
font-size:0.6875rem;
color:var(--text-tertiary);
}

.garden-content{
min-width:0;
view-transition-name:content;
}

main{
max-width:760px;
width:100%;
margin:0;
padding:2.5rem clamp(1.25rem,2vw,2rem) 4rem;
}

main>article{
line-height:1.8;
letter-spacing:0.008em;
word-break:break-word;
}

main>article>:first-child{margin-top:0}
main>article>:last-child{margin-bottom:0}

.page-title{
font-family:var(--font-heading);
font-size:1.75rem;
font-weight:700;
letter-spacing:-0.03em;
line-height:1.2;
color:var(--text);
margin:0 0 0.5rem;
}

.page-description{
margin:0 0 0.9rem;
font-size:0.98rem;
line-height:1.7;
color:var(--text-secondary);
text-wrap:pretty;
}

.page-tags{
display:flex;
flex-wrap:wrap;
align-items:center;
gap:0.35rem;
list-style:none;
padding:0;
margin:0 0 1.35rem;
}

.page-tag{
display:inline-block;
padding:0.2rem 0.45rem;
border:1px solid var(--border);
border-radius:4px;
font-size:0.6875rem;
font-weight:500;
line-height:1;
letter-spacing:0.03em;
text-transform:uppercase;
color:var(--text-tertiary);
}

.page-cover{
margin:0 0 1rem;
position:relative;
overflow:hidden;
border-radius:8px 8px 0 0;
}

.page-cover::after{
content:'';
position:absolute;
inset:0;
background:linear-gradient(to top,var(--bg) 0%,transparent 45%);
pointer-events:none;
}

.page-cover img{
display:block;
width:100%;
max-height:28rem;
object-fit:cover;
}

.growth{
margin-bottom:1.5rem;
font-size:0.75rem;
color:var(--text-tertiary);
letter-spacing:0.01em;
font-variant-numeric:tabular-nums;
}

.toc{
margin-bottom:2rem;
padding:1rem 1.25rem;
border:1px solid var(--border);
border-radius:4px;
background:var(--surface-0);
}

.toc ol{list-style:none;padding:0;margin:0}
.toc li{margin:0;line-height:1.5}
// .toc li+li{margin-top:0.25em}
.toc a{
font-size:0.8125rem;
color:var(--text-secondary);
text-decoration:none;
transition:color 150ms ease;
}
.toc a:hover{color:var(--accent-text)}
.toc .toc-3{padding-left:1em}
.toc .toc-4{padding-left:2em}

h1,h2,h3,h4{
font-family:var(--font-heading);
font-weight:600;
color:var(--text);
line-height:1.25;
margin:1.5em 0 0.4em;
scroll-margin-top:1.5rem;
}

h1{font-size:1.5em;letter-spacing:-0.025em;font-weight:700}
h2{font-size:1.25em;letter-spacing:-0.02em}
h3{font-size:1.0625em;letter-spacing:-0.015em}
h4{font-size:0.8125em;letter-spacing:0.06em;text-transform:uppercase;font-weight:500;color:var(--text-secondary)}

main>article>p:first-child{font-size:1.0625em;color:var(--text-secondary)}

p{margin:1em 0;text-wrap:pretty;hanging-punctuation:first last}

ul{list-style-type:disc}
ol{list-style-type:decimal}
ul,ol{padding-left:1.5em;margin:0.5em 0}
li{display:list-item;color:var(--text);text-wrap:pretty}
// li+li{margin-top:0.45em}
li::marker{color:var(--text-tertiary)}

a{
color:var(--accent-text);
text-decoration:underline;
text-decoration-color:var(--border-strong);
text-decoration-thickness:1px;
text-underline-offset:2px;
transition:color 150ms ease,text-decoration-color 200ms ease;
}
a:hover{text-decoration-color:var(--accent-text)}

main>article a[href^="http"]::after,
main>article a[href^="//"]::after{
content:'\\2197';
display:inline-block;
font-size:0.7em;
margin-left:0.15em;
color:var(--text-tertiary);
text-decoration:none;
}

strong{font-weight:600;color:var(--text)}
em{font-style:normal;color:var(--text-secondary);border-bottom:1px solid var(--border-strong)}

blockquote{
margin:1em 0;
padding:0.5em 1em;
border-left:2px solid var(--accent);
background:var(--accent-soft);
border-radius:0 4px 4px 0;
color:var(--text-secondary);
}
blockquote p{margin:0;color:inherit}

hr{border:none;text-align:center;margin:2em 0;overflow:visible}
hr::after{content:'\u00b7  \u00b7  \u00b7';color:var(--text-tertiary);letter-spacing:0.3em}

:not(pre)>code{
padding:0.18em 0.44em;
border-radius:4px;
background:var(--surface-2);
font-size:0.84em;
font-family:var(--font-mono);
color:var(--text);
font-variant-ligatures:none;
}

.code-block{
margin:1em 0;
overflow:hidden;
border-radius:4px;
border:1px solid var(--border);
background:var(--surface-0);
box-shadow:inset 0 1px 0 #ffffff05;
transition:border-color 150ms ease;
}
.code-block:hover{border-color:var(--border-strong)}

.code-header{
display:flex;
align-items:center;
gap:12px;
min-height:40px;
padding:0 14px;
background:var(--surface-1);
border-bottom:1px solid var(--border);
}

.code-lang{
font-family:var(--font-mono);
font-size:0.6875rem;
font-weight:600;
letter-spacing:0.05em;
text-transform:uppercase;
color:var(--text-tertiary);
transition:color 150ms ease;
}
.code-block:hover .code-lang{color:var(--text-secondary)}

.code-file{
font-family:var(--font-mono);
font-size:0.6875rem;
color:var(--text-secondary);
letter-spacing:0.01em;
margin-left:auto;
}

.code-block pre{margin:0;overflow-x:auto;padding:14px 16px}

.code-block code{
font-family:var(--font-mono);
font-size:0.8125rem;
line-height:1.65;
color:var(--text);
font-variant-ligatures:none;
}

img{display:block;max-width:100%;height:auto;border-radius:4px;margin:1em 0}

.table-wrap{
margin:1em 0;
overflow-x:auto;
border:1px solid var(--border);
border-radius:4px;
background:var(--surface-0);
}

table{
width:100%;
border-collapse:collapse;
margin:0;
}

th,td{
padding:10px 14px;
border-bottom:1px solid var(--border);
text-align:left;
font-size:0.8125em;
font-variant-numeric:tabular-nums;
letter-spacing:0.01em;
}

th{
font-family:var(--font-heading);
color:var(--text-secondary);
font-weight:500;
border-bottom-color:var(--border-strong);
}

td{color:var(--text)}

tr:nth-child(even) td{background:var(--surface-1)}

.listing{margin-top:2rem}

.listing-item{
padding:0.75rem 0;
border-bottom:1px solid var(--border);
}
.listing-item:first-child{border-top:1px solid var(--border)}

.listing-item a{
font-family:var(--font-heading);
font-weight:600;
font-size:1em;
color:var(--text);
text-decoration:none;
transition:color 150ms ease;
}
.listing-item a:hover{color:var(--accent-text)}

.listing-desc{
margin:0.25em 0 0;
font-size:0.875em;
color:var(--text-secondary);
line-height:1.5;
}

.listing-item time{
display:block;
margin-top:0.25em;
font-size:0.75rem;
color:var(--text-tertiary);
font-variant-numeric:tabular-nums;
letter-spacing:0.01em;
}

.listing-nav{
display:flex;
align-items:center;
justify-content:center;
gap:1rem;
margin-top:1.5rem;
font-size:0.8125rem;
color:var(--text-tertiary);
}
.listing-nav a{
color:var(--accent-text);
text-decoration:none;
}
.listing-nav a:hover{text-decoration:underline}

footer{
max-width:760px;
width:100%;
margin:0;
padding:0 clamp(1.25rem,2vw,2rem) 2rem;
font-size:0.6875rem;
color:var(--text-tertiary);
letter-spacing:0.015em;
}

is-land{
display:block;
contain:content;
font:inherit;
color:inherit;
letter-spacing:inherit;
}
is-land:not(:defined){opacity:0}
is-land:defined{animation:island-enter 150ms ease}
is-land[aria-busy="true"]{opacity:0.5;pointer-events:none}

@keyframes island-enter{
from{clip-path:inset(4%);opacity:0}
to{clip-path:inset(0);opacity:1}
}

::selection{background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent-text)}
pre ::selection{background:var(--surface-2)}

*{scrollbar-width:thin;scrollbar-color:var(--border-strong) var(--surface-2)}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:var(--surface-2);border-radius:999px}
::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:999px}
::-webkit-scrollbar-thumb:hover{background:var(--text-tertiary)}

a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}

@media print{
body{border-top:none}
.garden-topnav,.garden-sitemap,.skip-link,.toc,footer{display:none}
main{max-width:100%;padding:0}
main>article a[href^="http"]::after{content:" (" attr(href) ")";font-size:0.8em;color:#666}
.code-block,blockquote{break-inside:avoid}
h1,h2,h3,h4{break-after:avoid}
*{color:#000 !important;background:transparent !important;border-color:#ccc !important}
}

@media(max-width:900px){
main{
max-width:none;
padding:1.5rem 1rem 3rem;
}

footer{
max-width:none;
padding:0 1rem 1.5rem;
}
}

@media(prefers-reduced-motion:reduce){
*,*::before,*::after{transition-duration:0s !important;animation-duration:0s !important}
}

@media(prefers-reduced-motion:no-preference){
html{scroll-behavior:smooth}
}

@view-transition{navigation:auto}
`

export const GARDEN_LAYOUT_CSS = `
@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:180ms;animation-timing-function:cubic-bezier(.4,0,.2,1)}

:root{
--content-width:38rem;
--bg:#fafaf7;
--surface:#ffffff;
--surface-0:#ffffff;
--surface-1:#f4f3ee;
--surface-2:#ecebe5;
--border:rgba(15,15,15,.08);
--border-strong:rgba(15,15,15,.16);
--fg:#3f3f46;
--fg-strong:#09090b;
--fg-muted:#52525b;
--fg-faint:#a1a1aa;
--text:var(--fg-strong);
--text-secondary:var(--fg-muted);
--text-tertiary:var(--fg-faint);
--accent:#9333ea;
--accent-hover:#7e22ce;
--accent-soft:#d8b4fe;
--accent-text:var(--accent);
--link:var(--accent);
--link-hover:var(--accent-hover);
--link-underline:color-mix(in srgb,var(--accent) 45%,transparent);
--selection-bg:#e9d5ff;
--selection-fg:#3b0764;
--font-sans:"Lexend",-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;
--font-heading:var(--font-sans);
--font-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
}

@media(prefers-color-scheme:dark){
:root{
--bg:#0b0b0d;
--surface:#131316;
--surface-0:#131316;
--surface-1:#18181b;
--surface-2:#222228;
--border:rgba(255,255,255,.07);
--border-strong:rgba(255,255,255,.14);
--fg:#a1a1aa;
--fg-strong:#fafafa;
--fg-muted:#71717a;
--fg-faint:#52525b;
--text:var(--fg-strong);
--text-secondary:var(--fg-muted);
--text-tertiary:var(--fg-faint);
--accent:#c084fc;
--accent-hover:#d8b4fe;
--accent-soft:#a855f7;
--accent-text:var(--accent);
--link:var(--accent);
--link-hover:var(--accent-hover);
--link-underline:color-mix(in srgb,var(--accent) 60%,transparent);
--selection-bg:rgba(192,132,252,.35);
--selection-fg:#faf5ff;
}
html{color-scheme:dark}
}

*{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
::selection{background:var(--selection-bg);color:var(--selection-fg)}
html{background:var(--bg);scroll-behavior:smooth;scrollbar-gutter:stable;overflow-y:scroll}
body{border-top:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans);font-weight:350;font-size:16px;line-height:1.7;letter-spacing:0;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
body.no-scroll{overflow:hidden}
.skip-link{background:var(--surface);color:var(--accent);border-color:var(--border)}

.garden-topnav{max-width:var(--content-width);margin:0 auto;padding:2.25rem 1.5rem 1.25rem;display:flex;flex-wrap:wrap;align-items:baseline;gap:1rem 1.5rem;border-bottom:1px solid var(--border);position:relative;z-index:20}
.site-title{font-family:var(--font-sans);font-weight:600;font-size:.95rem;letter-spacing:-.02em;color:var(--fg-strong);text-decoration:none;white-space:nowrap;margin-right:auto}
.site-title:hover{color:var(--fg-strong);text-decoration:none}
.nav-links{display:flex;flex-wrap:wrap;gap:1.35rem;align-items:center}
.nav-links a{position:relative;font-size:.85rem;font-weight:400;letter-spacing:-.005em;color:var(--fg-muted);text-decoration:none;padding-bottom:.15rem;white-space:nowrap}
.nav-links a:hover,.nav-links a.active{color:var(--fg-strong);text-decoration:none}
.nav-links a.active::after{content:"";position:absolute;left:0;right:0;bottom:-.4rem;height:1.5px;background:var(--fg-strong)}

.garden-search{flex:1 1 22rem;min-width:min(18rem,100%);display:flex;flex-direction:column;gap:.35rem;position:relative;margin-left:auto}
.garden-search-field{position:relative;display:flex;align-items:center;width:100%}
.garden-search-popover{position:absolute;top:calc(100% + .5rem);left:0;right:0;z-index:60;display:flex;flex-direction:column;gap:.55rem;padding:.7rem;border:1px solid var(--border);border-radius:12px;background:color-mix(in srgb,var(--surface) 97%,transparent);box-shadow:0 24px 64px rgba(0,0,0,.28);backdrop-filter:blur(16px)}
.garden-search-popover:not(:has(> :not([hidden]))){display:none}
.garden-search-input{width:100%;height:2.25rem;padding:0 2.2rem 0 .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);color:var(--fg-strong);font:inherit;font-size:.8125rem;line-height:1.4;appearance:none}
.garden-search-input::placeholder{color:var(--fg-faint)}
.garden-search-input:focus-visible{outline:none;border-color:var(--border-strong);background:var(--surface)}
.garden-search-kbd{position:absolute;right:.45rem;display:flex;align-items:center;justify-content:center;min-width:1.25rem;height:1.25rem;padding:0 .3rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-family:var(--font-mono);font-size:.625rem;line-height:1;color:var(--fg-faint);pointer-events:none}
.garden-search-input:focus~.garden-search-kbd{display:none}
.garden-search-filters{display:flex;flex-wrap:wrap;gap:.3rem;margin:0;padding-bottom:.55rem;border-bottom:1px solid var(--border)}
.garden-search-filter{display:inline-flex;align-items:center;gap:.35rem;height:1.5rem;padding:0 .5rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:.6875rem;color:var(--fg-muted);cursor:pointer}
.garden-search-filter:hover,.garden-search-filter.is-active{border-color:color-mix(in srgb,var(--accent) 32%,var(--border));color:var(--fg-strong);background:color-mix(in srgb,var(--accent) 8%,transparent)}
.garden-search-filter-count{font-size:.625rem;color:var(--fg-faint)}
.garden-search-status{margin:0;font-size:.6875rem;color:var(--fg-faint);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.04em}
.garden-search-results{display:flex;flex-direction:column;gap:.1rem;max-height:min(60vh,28rem);overflow:auto;margin:0;padding:0;border:0;background:none;box-shadow:none}
.garden-search-results[hidden],.garden-search-status[hidden],.garden-search-filters[hidden]{display:none!important}
.garden-search-empty,.garden-search-error{margin:0;padding:.85rem .75rem;text-align:center;font-size:.8125rem;line-height:1.5;color:var(--fg-muted)}
.garden-search-result{display:block;padding:.55rem .65rem;border-radius:7px;text-decoration:none;color:inherit}
.garden-search-result:hover,.garden-search-result.is-active{background:var(--surface-1);text-decoration:none}
.garden-search-result-title{display:block;font-size:.85rem;font-weight:500;line-height:1.35;color:var(--fg-strong)}
.garden-search-result-excerpt{display:block;margin-top:.16rem;font-size:.76rem;line-height:1.45;color:var(--fg-muted)}
.garden-search-result mark,.garden-search-subresult mark{padding:.05em .15em;border-radius:.2em;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.garden-search-subresults{margin-top:.25rem;display:flex;flex-direction:column}
.garden-search-subresult{display:block;margin-left:.35rem;padding:.2rem 0 .2rem .7rem;border-left:1px solid var(--border);text-decoration:none}
.garden-search-subresult:hover{border-left-color:var(--accent);text-decoration:none}

.garden-content{min-width:0;view-transition-name:content}
main{max-width:var(--content-width);width:100%;margin:0 auto;padding:3.25rem 1.5rem 6rem}
main>section,main>article,.page-searchable{line-height:1.7;letter-spacing:0;word-break:break-word}
.page-title{font-family:var(--font-sans);font-size:clamp(1.85rem,1.5rem + 1.4vw,2.35rem);font-weight:600;line-height:1.12;letter-spacing:-.035em;color:var(--fg-strong);margin:0 0 2.5rem;text-wrap:balance}
.page-updated{margin:-1.95rem 0 1.7rem;font-family:var(--font-mono);font-size:.72rem;color:var(--fg-faint);letter-spacing:.04em;text-transform:uppercase}
.page-updated time{color:var(--fg-muted)}
.page-updated+.page-description,.page-updated+.page-tags,.page-updated+.growth{margin-top:0}
.page-description{margin:-1.5rem 0 1.8rem;font-size:1rem;line-height:1.65;color:var(--fg-muted);text-wrap:pretty}
.growth{margin:-1rem 0 1.6rem;font-family:var(--font-mono);font-size:.72rem;color:var(--fg-faint);letter-spacing:.03em;text-transform:uppercase}
.page-tags{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;padding:0;margin:-.75rem 0 1.65rem}
.page-tag{display:inline-flex;align-items:center;padding:.12rem .5rem;border:1px solid var(--border);border-radius:999px;background:color-mix(in srgb,var(--surface-1) 70%,transparent);font-family:var(--font-mono);font-size:.65rem;letter-spacing:.05em;text-transform:uppercase;color:var(--fg-muted)}

h1,h2,h3,h4,h5,h6{font-family:var(--font-sans);color:var(--fg-strong);font-weight:600;text-wrap:balance}
h1{font-size:1.5rem}h2{font-size:1.3rem;line-height:1.3;letter-spacing:-.02em;margin-top:2.5rem;margin-bottom:1.1rem}h3{font-size:1.075rem;font-weight:500;line-height:1.35;letter-spacing:-.015em;margin-top:1.85rem;margin-bottom:.6rem}h4{font-size:.95rem;font-weight:600;letter-spacing:-.01em;margin-top:1.5rem;margin-bottom:.4rem;text-transform:none;color:var(--fg-strong)}
main>section>article>:first-child{margin-top:0}
p{color:var(--fg);text-wrap:pretty;margin:0 0 1.4rem}
strong{font-weight:600;color:var(--fg-strong)}
em{font-style:italic;color:var(--fg);border-bottom:0}
a{color:var(--link);text-decoration:underline;text-decoration-color:var(--link-underline);text-decoration-thickness:1.5px;text-decoration-skip-ink:auto;text-underline-offset:3px;transition:color .15s ease,text-decoration-color .15s ease}
a:hover{color:var(--link-hover);text-decoration-color:var(--link-hover)}
ul,ol{margin-bottom:1.4rem;padding-left:1.4rem;color:var(--fg)}
li{margin-bottom:.55rem;padding-left:.25rem;color:var(--fg)}li::marker{color:var(--fg-faint)}li>ul,li>ol{margin-top:.4rem;margin-bottom:0}
:not(pre)>code{font-family:var(--font-mono);font-size:.825em;font-weight:400;background:var(--surface-1);border:1px solid var(--border);padding:.12em .42em;border-radius:4px;color:var(--fg-strong)}
.code-block{margin:.5rem 0 1.5rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);overflow:hidden}.code-header{background:var(--surface-1);border-bottom:1px solid var(--border)}.code-block pre{margin:0;padding:1.1rem 1.35rem;overflow-x:auto}.code-block code{font-family:var(--font-mono);font-size:.8125rem;line-height:1.65;color:var(--fg-strong)}
blockquote{margin:1.6rem 0 2rem;padding:.4rem 0 .4rem 1.5rem;border-left:2px solid var(--border-strong);background:transparent;border-radius:0;color:var(--fg-muted)}blockquote p{font-size:1.05rem;font-style:italic;color:inherit}blockquote p:last-child{margin-bottom:0}
hr{border:0;height:1px;background:var(--border);margin:3rem auto;max-width:4rem}hr::after{content:""}
img{display:block;max-width:100%;height:auto;border-radius:6px;margin:1rem 0 1.75rem;border:1px solid var(--border)}p:has(>img:only-child){margin:0}img[style*="max-width: 100px"],img[style*="max-width:100px"]{border:0;border-radius:0}
.table-wrap,table{width:100%}.table-wrap{margin:.5rem 0 2rem;overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface)}table{border-collapse:collapse;margin:0}th,td{padding:.7rem .95rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--border);font-size:.9rem}th{background:var(--surface);font-weight:500;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--fg-strong)}td{color:var(--fg)}
.page-cover{margin:0 0 1.6rem;border-radius:8px;overflow:hidden}.page-cover::after{display:none}.page-cover img{width:100%;max-height:28rem;object-fit:cover;margin:0;border:1px solid var(--border)}
.toc{display:none}

.listing{margin-top:1.5rem;border-top:1px solid var(--border)}.listing-item{position:relative;display:flex;align-items:center;gap:1rem;padding:1.15rem 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;transition:padding .18s ease}.listing-item:hover .listing-title,.listing-item:focus-visible .listing-title{color:var(--fg-strong)}.listing-body{display:flex;flex-direction:column;gap:.3rem;min-width:0;flex:1}.listing-title{font-size:1.05rem;font-weight:500;letter-spacing:-.015em;color:var(--fg-strong);line-height:1.3}.listing-desc{font-size:.9rem;line-height:1.5;color:var(--fg-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.listing-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .85rem;margin-top:.15rem;font-family:var(--font-mono);font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;color:var(--fg-faint)}.listing-tags{display:inline-flex;flex-wrap:wrap;gap:.4rem}.listing-tag{display:inline-flex;align-items:center;padding:.05rem .5rem;border-radius:999px;border:1px solid var(--border);background:color-mix(in srgb,var(--surface-1) 60%,transparent);color:var(--fg-muted);font-size:.65rem}.listing-arrow{flex-shrink:0;font-family:var(--font-mono);font-size:.9rem;color:var(--fg-faint);opacity:.5;transform:translateX(-.25rem);transition:opacity .18s ease,transform .22s ease,color .18s ease}.listing-item:hover .listing-arrow{opacity:1;transform:translateX(0);color:var(--fg-strong)}.pagination{display:flex;align-items:center;justify-content:space-between;margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:.78rem}.pagination-prev,.pagination-next{color:var(--fg-muted);text-decoration:none}.pagination-prev:hover,.pagination-next:hover{color:var(--fg-strong)}.pagination-info{color:var(--fg-faint);letter-spacing:.05em;text-transform:uppercase;font-size:.7rem}.pagination-placeholder{min-width:5rem}

.newsletter-form{max-width:30rem;margin:1.85rem 0}.newsletter-form__form{display:grid;gap:.55rem}.newsletter-form__row{display:flex;gap:.55rem;align-items:center}.newsletter-form__input{flex:1;min-width:0;height:2.45rem;border-radius:.35rem;padding:0 .75rem;border:1px solid var(--border-strong);background:transparent;color:var(--fg-strong);font:inherit;font-size:.9rem;outline:none}.newsletter-form__input::placeholder{color:var(--fg-muted)}.newsletter-form__input:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent)}.newsletter-form__input.is-invalid{border-color:var(--accent)}.newsletter-form__button{height:2.45rem;border:1px solid var(--accent);border-radius:.35rem;padding:0 .85rem;background:transparent;color:var(--accent);font:inherit;font-size:.88rem;font-weight:500;white-space:nowrap;cursor:pointer}.newsletter-form__button:hover:not(:disabled){border-color:var(--accent-hover);background:color-mix(in srgb,var(--accent) 8%,transparent);color:var(--accent-hover)}.newsletter-form__button:disabled{opacity:.55;cursor:not-allowed}.newsletter-form__hint,.newsletter-form__notice{margin:0;font-size:.82rem;line-height:1.45}.newsletter-form__hint--error{color:var(--accent)}.newsletter-form__notice{border-left:2px solid color-mix(in srgb,var(--accent) 55%,transparent);padding:.15rem 0 .15rem .65rem;color:var(--fg-muted)}.newsletter-form [hidden]{display:none!important}

.lightbox{position:fixed;inset:0;background:color-mix(in srgb,var(--bg) 92%,#000);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:opacity .18s ease,visibility .18s ease;padding:4vh 4vw;cursor:zoom-out}.lightbox.open{opacity:1;visibility:visible}.lightbox-close{position:absolute;top:1rem;right:1rem;width:2.25rem;height:2.25rem;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;color:var(--fg);background:var(--surface);border:1px solid var(--border);border-radius:999px;cursor:pointer}.lightbox-figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:.85rem;max-width:100%;max-height:100%;cursor:default}.lightbox-image{max-width:min(92vw,1400px);max-height:88vh;width:auto;height:auto;object-fit:contain;border-radius:6px;border:1px solid var(--border);background:var(--surface);margin:0}.lightbox-caption{font-family:var(--font-mono);font-size:.75rem;color:var(--fg-muted);text-align:center;max-width:80ch}
.col-handle{position:fixed;top:0;height:100vh;width:24px;margin-left:-12px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;padding:0;cursor:ew-resize;z-index:50;touch-action:none}.col-handle-grip{display:block;width:4px;height:4rem;border-radius:999px;background:var(--accent);opacity:0;transition:opacity .18s ease,width .18s ease,height .2s ease,box-shadow .18s ease}.col-handle:hover .col-handle-grip,.col-handle:focus-visible .col-handle-grip,body.col-resizing .col-handle-grip{opacity:1;width:5px;height:5rem;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 14%,transparent)}body.col-resizing,body.col-resizing *{cursor:ew-resize!important;user-select:none}

@media(max-width:760px){.garden-topnav{padding-top:1.5rem;padding-bottom:1rem;gap:.85rem 1.1rem}.nav-links{gap:1.05rem}.nav-links a{font-size:.825rem}.garden-search{flex-basis:100%;order:3;margin-left:0}main{padding:2.75rem 1.25rem 5rem}.page-title{margin-bottom:1.75rem}.col-handle{display:none}.newsletter-form__row{align-items:stretch;flex-direction:column}.newsletter-form__button{width:100%}}
@media(prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation-duration:1ms}.col-handle-grip,.listing-arrow,*{transition-duration:0s!important;animation-duration:0s!important}}
`
