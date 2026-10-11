import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
const root = resolve(import.meta.dirname, '..');
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  css: { postcss: { plugins: [tailwindcss({base:root})] } },
  resolve: { alias: [
    {find:'next/navigation',replacement:resolve(import.meta.dirname,'router.jsx')},
    {find:'next/link',replacement:resolve(import.meta.dirname,'router.jsx')},
    {find:'@ai-sdk/react',replacement:resolve(import.meta.dirname,'chat.jsx')},
    ...['@/app/pro/(hamilton)/analyze/actions','@/app/pro/(hamilton)/reports/board-actions','@/app/pro/(hamilton)/settings/actions','@/app/pro/(hamilton)/view-as-actions','@/lib/hamilton/navigation-institution-action'].map(find=>({find,replacement:resolve(import.meta.dirname,'actions.js')})),
    {find:'@',replacement:resolve(root,'src')}
  ]},
  server:{host:'0.0.0.0',allowedHosts:['terminal.local'],fs:{allow:[root]}},
  plugins:[{name:'preview-only-pdf',configureServer(server){server.middlewares.use('/__preview/pdf',async(req,res)=>{try {
    let body=''; for await (const chunk of req) body+=chunk;
    const report=JSON.parse(body);
    const {PdfDocument}=await server.ssrLoadModule('/@fs/'+root+'/src/components/hamilton/reports/PdfDocument.tsx');
    const {renderToBuffer}=await import('@react-pdf/renderer');
    const {createElement}=await import('react');
    const bytes=await renderToBuffer(createElement(PdfDocument,{report,reportType:'board_brief'}));
    res.setHeader('Content-Type','application/pdf');res.end(bytes);
  }catch(e){res.statusCode=500;res.end(String(e));}})}}]
});
