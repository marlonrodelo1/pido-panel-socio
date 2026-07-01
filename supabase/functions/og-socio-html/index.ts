// og-socio-html v1 — server-side rewriting de meta tags Open Graph / Twitter
// Card para la tienda publica del socio en https://pidoo.es/s/<slug>
//
// Crawlers (facebookexternalhit, twitterbot, applebot, whatsapp, telegram, etc.)
// no ejecutan JS y no leen los meta tags inyectados por React. Esta edge
// descarga el index.html actual de pidoo.es (con los hashes Vite frescos) y
// reemplaza los meta tags por los del socio para que el preview muestre el
// logo y descripcion correctos.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const DEFAULT_LOGO = 'https://pidoo.es/favicon-512.png'
const DEFAULT_TITLE = 'Pidoo · Tu comida favorita, a un clic'
const DEFAULT_DESC = 'Pide comida a domicilio o recógela tú mismo en Tenerife. Más de 100 restaurantes en Pidoo, tu marketplace canario.'

function escapeHtmlAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function fetchBaseHtml(): Promise<string | null> {
  try {
    const res = await fetch('https://pidoo.es/index.html', {
      headers: { 'User-Agent': 'og-socio-html-edge/1.0', 'Cache-Control': 'no-cache' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch (_e) {
    return null
  }
}

function buildFallbackHtml(meta: { title: string; description: string; image: string; url: string }): string {
  const t = escapeHtmlAttr(meta.title)
  const d = escapeHtmlAttr(meta.description)
  const i = escapeHtmlAttr(meta.image)
  const u = escapeHtmlAttr(meta.url)
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${t}</title>
<meta name="description" content="${d}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Pidoo" />
<meta property="og:locale" content="es_ES" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:image" content="${i}" />
<meta property="og:url" content="${u}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${i}" />
<link rel="canonical" href="${u}" />
</head>
<body><div id="root"></div></body>
</html>`
}

function rewriteMetaTags(html: string, meta: { title: string; description: string; image: string; url: string }): string {
  const t = escapeHtmlAttr(meta.title)
  const d = escapeHtmlAttr(meta.description)
  const i = escapeHtmlAttr(meta.image)
  const u = escapeHtmlAttr(meta.url)

  let out = html

  // <title>
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`)

  // description
  out = out.replace(
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${d}" />`,
  )

  // og:title / og:description / og:image / og:url
  out = out.replace(
    /<meta\s+property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${t}" />`,
  )
  out = out.replace(
    /<meta\s+property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${d}" />`,
  )
  out = out.replace(
    /<meta\s+property="og:image"[^>]*>/i,
    `<meta property="og:image" content="${i}" />`,
  )
  out = out.replace(
    /<meta\s+property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${u}" />`,
  )

  // twitter card title/description/image (asegurar que existan)
  if (/<meta\s+name="twitter:title"/i.test(out)) {
    out = out.replace(/<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${t}" />`)
  } else {
    out = out.replace('</head>', `  <meta name="twitter:title" content="${t}" />\n  </head>`)
  }
  if (/<meta\s+name="twitter:description"/i.test(out)) {
    out = out.replace(/<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${d}" />`)
  } else {
    out = out.replace('</head>', `  <meta name="twitter:description" content="${d}" />\n  </head>`)
  }
  if (/<meta\s+name="twitter:image"/i.test(out)) {
    out = out.replace(/<meta\s+name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${i}" />`)
  } else {
    out = out.replace('</head>', `  <meta name="twitter:image" content="${i}" />\n  </head>`)
  }

  // canonical
  if (/<link\s+rel="canonical"/i.test(out)) {
    out = out.replace(/<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${u}" />`)
  }

  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url = new URL(req.url)
    const slug = (url.searchParams.get('slug') || '').trim().toLowerCase()

    let meta = {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESC,
      image: DEFAULT_LOGO,
      url: 'https://pidoo.es/',
    }

    if (slug && /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
      const { data: socio } = await supabase
        .from('socios')
        .select('slug, nombre_comercial, descripcion, logo_url, banner_url, marketplace_activo, activo')
        .eq('slug', slug)
        .maybeSingle()

      if (socio && socio.marketplace_activo !== false && socio.activo !== false) {
        const titulo = socio.nombre_comercial || `Tienda ${socio.slug}`
        const descripcion = (socio.descripcion && socio.descripcion.trim().length > 0)
          ? socio.descripcion.trim().slice(0, 280)
          : `Descubre los restaurantes de ${titulo} en Pidoo. Pide a domicilio en Tenerife.`
        const imagen = socio.logo_url || socio.banner_url || DEFAULT_LOGO
        meta = {
          title: `${titulo} · Pidoo`,
          description: descripcion,
          image: imagen,
          url: `https://pidoo.es/s/${socio.slug}`,
        }
      }
    }

    const baseHtml = await fetchBaseHtml()
    const finalHtml = baseHtml
      ? rewriteMetaTags(baseHtml, meta)
      : buildFallbackHtml(meta)

    return new Response(finalHtml, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'X-OG-Source': baseHtml ? 'rewrite' : 'fallback',
      },
    })
  } catch (err) {
    console.error('[og-socio-html]', err)
    const fallback = buildFallbackHtml({
      title: DEFAULT_TITLE,
      description: DEFAULT_DESC,
      image: DEFAULT_LOGO,
      url: 'https://pidoo.es/',
    })
    return new Response(fallback, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
})
