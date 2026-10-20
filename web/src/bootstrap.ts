import { loadRuntime } from './config';

try {
 await loadRuntime();
 await import('./main');
} catch(error) {
 const root=document.getElementById('root')!;
 const main=document.createElement('main');
 const title=document.createElement('h1');title.textContent='Sworn deployment unavailable';
 const message=document.createElement('p');message.textContent=error instanceof Error?error.message:'Reload to retry loading the deployment.';
 const retry=document.createElement('button');retry.textContent='Reload site';retry.onclick=()=>location.reload();
 main.append(title,message,retry);root.replaceChildren(main);
}
