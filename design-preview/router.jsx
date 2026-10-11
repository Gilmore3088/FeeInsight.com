import { useSyncExternalStore } from 'react';
const subscribe = fn => { window.addEventListener('popstate',fn);return ()=>window.removeEventListener('popstate',fn); };
export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);
export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
export function navigate(href,replace=false){history[replace?'replaceState':'pushState'](null,'',href);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo(0,0);}
export const useRouter=()=>({push:navigate,replace:href=>navigate(href,true),refresh:()=>window.dispatchEvent(new PopStateEvent('popstate'))});
export const useLinkStatus=()=>({pending:false});
export default function Link({href,children,onClick,...props}){return <a href={href} {...props} onClick={e=>{onClick?.(e);if(!e.defaultPrevented&&!e.metaKey&&!e.ctrlKey&&href.startsWith('/')){e.preventDefault();navigate(href);}}}>{children}</a>;}
