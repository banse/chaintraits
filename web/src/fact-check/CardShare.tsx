import { useEffect, useState, type RefObject } from 'react';
import { CARD_IMAGE, cardImageSvg, escapeXml } from './card-image.mjs';
import { oracleRequestLink } from './request-model.mjs';
import type { FactCheckSnapshot } from './types';

// Paint and font properties the card's stylesheet sets on its SVG; an exported SVG has no stylesheet.
const PAINT = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'opacity', 'visibility', 'display', 'color', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline'];

/** Inner markup of a card SVG with its computed paint inlined; each element keeps its own inline style (agent positions). */
function inlined(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [...svg.querySelectorAll('*')], to = [...clone.querySelectorAll('*')];
  from.forEach((element, i) => {
    const computed = getComputedStyle(element);
    const own = element.getAttribute('style') || '';
    to[i].setAttribute('style', `${PAINT.map(name => `${name}:${computed.getPropertyValue(name)}`).join(';')};${own}`);
    to[i].removeAttribute('class');
  });
  return clone.innerHTML;
}

/** What the card shows now: the returned card artwork with its new-fact outline, or the agent hive. */
function artwork(panel: HTMLElement) {
  const card = panel.querySelector<HTMLImageElement>('.fc-returned-art.fc-image-ready img');
  if (card?.src) {
    const outline = panel.querySelector<SVGSVGElement>('.fc-returned-art .fc-new-fact');
    return `<image href="${escapeXml(card.src)}" width="1000" height="1000"/>${outline ? inlined(outline) : ''}`;
  }
  const hive = panel.querySelector<SVGSVGElement>('.fc-artwork svg.fc-hive');
  return hive ? inlined(hive) : '';
}

async function png(svg: string) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_IMAGE.width * 2;
  canvas.height = CARD_IMAGE.height * 2;
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('The image could not be made.')), 'image/png'));
}

/** Download or share the finished card as a PNG, with a link back to this Fact Check. */
export function CardShare({ panel, snapshot, kind, title, saved }: { panel: RefObject<HTMLElement | null>; snapshot: FactCheckSnapshot; kind: 'positive' | 'negative' | 'neutral'; title: string; saved: string[] }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const name = `sworn-${snapshot.factId}-${(snapshot.wallet || 'wallet').slice(0, 10).toLowerCase()}.png`;
  const link = () => `${location.origin}${location.pathname}${snapshot.requestId
    ? oracleRequestLink(snapshot.wallet, { id: snapshot.factId, requestId: snapshot.requestId })
    : `#/explorer?address=${encodeURIComponent(snapshot.wallet)}`}`;
  const image = async () => {
    if (!panel.current) throw Error('The card is not on the page.');
    const muted = panel.current.querySelector('.fc-canvas-title');
    return png(cardImageSvg({
      title, label: snapshot.evidenceKind === 'direct' ? '' : 'FACT', question: snapshot.shortQuestion || snapshot.question,
      factName: snapshot.factName, wallet: snapshot.wallet, ensName: snapshot.ensName, saved, result: kind,
      footer: `${location.host} · Ethereum mainnet`, art: artwork(panel.current),
      colours: muted ? { muted: getComputedStyle(muted).color } : undefined,
    }));
  };
  // Made ahead of the tap: Safari only shares from inside the tap itself, not after waiting for a PNG.
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    const timer = setTimeout(() => {
      image().then(blob => { if (live) setFile(new File([blob], name, { type: 'image/png' })); }).catch(() => {});
    }, 1500);
    return () => { live = false; clearTimeout(timer); };
  }, [snapshot.key, snapshot.ensName, kind]);
  const report = (promise: Promise<string>) => {
    setBusy(true);
    setStatus('');
    promise.then(setStatus, (error: any) => { if (error?.name !== 'AbortError') setStatus(error?.message || 'That did not work.'); }).finally(() => setBusy(false));
  };
  const download = () => report((async () => {
    const url = URL.createObjectURL(file || await image());
    const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'Image saved.';
  })());
  const share = () => {
    const text = `${snapshot.factName}: ${snapshot.shortQuestion || snapshot.question}`;
    const data = { title: `Sworn · ${snapshot.factName}`, text, url: link() };
    if (file && navigator.canShare?.({ files: [file] })) return report(navigator.share({ ...data, files: [file] }).then(() => ''));
    if (navigator.share) return report(navigator.share(data).then(() => ''));
    report(navigator.clipboard.writeText(data.url).then(() => 'Link copied.'));
  };
  return <div className="fc-share">
    <button type="button" onClick={share} disabled={busy}>Share</button>
    <button type="button" onClick={download} disabled={busy}>Download image</button>
    <span role="status">{status}</span>
  </div>;
}
