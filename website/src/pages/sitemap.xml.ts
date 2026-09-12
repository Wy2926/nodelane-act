import { pages } from '../data/pages';
export function GET() {
  const routes = ['', 'download', ...Object.keys(pages.zh)];
  const urls=['','en/'].flatMap(prefix=>routes.map(page=>`https://act.nodelane.net/${prefix}${page?page+'/':''}`));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url=>`<url><loc>${url}</loc></url>`).join('')}</urlset>`,{headers:{'Content-Type':'application/xml'}});
}
