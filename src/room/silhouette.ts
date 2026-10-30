const figure = (fill: string, stroke: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="512" viewBox="0 0 256 512">
<g fill="${fill}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round">
<path d="M96 470v34h28v-34zM132 470v34h28v-34z"/>
<path d="M128 196c-46 0-74 26-80 70l-14 116c-2 14 8 22 20 20l12-2 4 72h116l4-72 12 2c12 2 22-6 20-20l-14-116c-6-44-34-70-80-70z"/>
<circle cx="128" cy="116" r="66"/>
</g>
</svg>`;
const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
export const residentSilhouette = dataUri(figure('#d9d2c3', '#8f8676'));
/** Stands in the owner's spot until they have a figure of their own; greener than the clerk's grey so the two read as different people. */
export const ownerSilhouette = dataUri(figure('#cfdcbc', '#7d9168'));
