/** Neutral clerks drawn in code, like the silhouette: no brand, no mascot. Each look changes colours, hair and apron only. */
interface Look { skin: string; hair: string; shirt: string; apron: string; trim: string; hairStyle: 'bob' | 'bun'; hat?: string }

const standeeBox = '0 0 256 512';
/** The same drawing cropped to the head and shoulders, for the picker's thumbnail. */
const portraitBox = '40 6 176 176';

function figure(look: Look, box: string, size: [number, number]) {
  const { skin, hair, shirt, apron, trim, hairStyle, hat } = look;
  const back = hairStyle === 'bob'
    ? `<path d="M64 124c-6-52 22-84 64-84s70 32 64 84c-2 22 0 44-10 56H74c-10-12-8-34-10-56z" fill="${hair}"/>`
    : `<circle cx="128" cy="36" r="30" fill="${hair}"/>`;
  const fringe = hairStyle === 'bob'
    ? `<path d="M68 110c0-44 24-62 60-62s60 18 60 62c-18-6-28-22-34-34-14 18-52 30-86 34z" fill="${hair}"/>`
    : `<path d="M66 108c0-42 26-60 62-60s62 18 62 60c-22-4-36-18-42-34-12 16-48 30-82 34z" fill="${hair}"/>`;
  const cap = hat ? `<path d="M62 92c6-44 32-62 66-62s60 18 66 62c-30-10-102-10-132 0z" fill="${hat}"/><rect x="58" y="86" width="140" height="14" rx="7" fill="${hat}" stroke="${trim}" stroke-width="3"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="${box}">
<g stroke="#5a4636" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
${back}
<path d="M96 428v42h28v-42zM132 428v42h28v-42z" fill="#6b5a4a"/>
<path d="M90 462h36l-2 18H90zM130 462h36v18h-34z" fill="#4a3d32"/>
<path d="M50 232c-10 28-14 62-12 96 2 14 24 14 26 0l6-84z" fill="${shirt}"/>
<path d="M206 232c10 28 14 62 12 96-2 14-24 14-26 0l-6-84z" fill="${shirt}"/>
<circle cx="52" cy="338" r="13" fill="${skin}"/><circle cx="204" cy="338" r="13" fill="${skin}"/>
<path d="M128 196c-46 0-76 24-80 66l-6 146c-1 14 6 22 18 22h136c12 0 19-8 18-22l-6-146c-4-42-34-66-80-66z" fill="${shirt}"/>
<path d="M82 240c0-8 14-14 46-14s46 6 46 14l8 164c0 10-6 16-16 16H90c-10 0-16-6-16-16z" fill="${apron}"/>
<path d="M92 236l6-34M164 236l-6-34" fill="none" stroke="${apron}" stroke-width="9"/>
<rect x="104" y="344" width="48" height="34" rx="8" fill="${trim}" stroke-width="3"/>
<rect x="112" y="186" width="32" height="26" rx="10" fill="${skin}"/>
<circle cx="128" cy="116" r="64" fill="${skin}"/>
${fringe}
${cap}
</g>
<g fill="#3a2e26"><ellipse cx="104" cy="122" rx="6" ry="9"/><ellipse cx="152" cy="122" rx="6" ry="9"/></g>
<ellipse cx="90" cy="142" rx="10" ry="6" fill="#f2a6a0" opacity=".55"/><ellipse cx="166" cy="142" rx="10" ry="6" fill="#f2a6a0" opacity=".55"/>
<path d="M116 146q12 10 24 0" fill="none" stroke="#5a4636" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
/** The standee is drawn at twice its logical size so the room's minification filtering has pixels to work with. */
const art = (look: Look) => ({ standee: dataUri(figure(look, standeeBox, [512, 1024])), portrait: dataUri(figure(look, portraitBox, [256, 256])) });

export const apronClerkArt = art({ skin: '#f2cfb0', hair: '#6a4430', shirt: '#f7f1e2', apron: '#4d7a58', trim: '#3d6247', hairStyle: 'bob' });
export const capClerkArt = art({ skin: '#e8bd98', hair: '#d9804a', shirt: '#cfe0ec', apron: '#3f5f82', trim: '#c7a17a', hairStyle: 'bun', hat: '#d8c4a0' });
