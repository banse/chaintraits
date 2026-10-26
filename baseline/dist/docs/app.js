/* Progressive local search. All document navigation also works without JS. */
(() => {
  const form=document.querySelector('.search');
  const input=document.querySelector('#doc-search');
  const results=document.querySelector('#search-results');
  const status=document.querySelector('#search-status');
  const clear=document.querySelector('.search-clear');
  const records=globalThis.SWORN_DOC_SEARCH;
  if(form&&input&&results&&status&&clear&&Array.isArray(records)) {
    form.hidden=false;
    const update=()=>{
      const query=input.value.trim().toLowerCase();
      results.replaceChildren();
      clear.hidden=!query;
      if(query.length<2){results.hidden=true;status.textContent=query?'Type at least two characters.':'';return;}
      const words=query.split(/\s+/).slice(0,8);
      const matches=records.map(record=>{
        const title=(record.page+' '+record.heading).toLowerCase();
        const text=(title+' '+record.text).toLowerCase();
        return {record,score:words.every(word=>text.includes(word))?words.reduce((sum,word)=>sum+(title.includes(word)?3:1),0):0};
      }).filter(match=>match.score).sort((a,b)=>b.score-a.score);
      for(const {record} of matches.slice(0,12)) {
        const item=document.createElement('li');
        const link=document.createElement('a');
        link.href=record.url;link.textContent=record.heading;
        const label=document.createElement('small');label.textContent=record.page;
        const snippet=document.createElement('small');
        const lower=record.text.toLowerCase();
        const position=Math.max(0,lower.indexOf(words[0])-45);
        snippet.textContent=(position?'…':'')+record.text.slice(position,position+180)+(record.text.length>position+180?'…':'');
        item.append(link,label,snippet);results.append(item);
      }
      results.hidden=!matches.length;
      status.textContent=matches.length?`${matches.length} matching sections${matches.length>12?'; showing the first 12':''}.`:'No matching sections. Try a fact ID, template or shorter phrase.';
    };
    input.addEventListener('input',update);
    form.addEventListener('submit',event=>{event.preventDefault();results.querySelector('a')?.focus();});
    clear.addEventListener('click',()=>{input.value='';update();input.focus();});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){input.value='';update();}});
  }
  const toc=document.querySelector('.page-toc');
  if(toc&&matchMedia('(min-width:951px)').matches)toc.open=true;
})();
