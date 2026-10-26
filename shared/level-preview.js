const COLORS = { r: '#626d72', f: '#353e45', h: '#aa916c', X: '#20262a', S: '#d65a4c', E: '#4dbed7' };
/** 从地形生成可随 JSON 分享的安全简图；不采用导入文件提供的 SVG 内容。 */
export function levelThumbnail(stage) {
  const R = stage.rect, rows = stage.rows.length, cols = stage.rows[0].length, size = 24;
  let tiles = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = stage.rows[r][c]; if (!COLORS[ch]) continue;
    const x = c * size, y = (rows - r - 1) * size;
    tiles += `<rect x="${x + 1}" y="${y + 1}" width="22" height="22" fill="${COLORS[ch]}"/>`;
    if (ch === 'S' || ch === 'E') tiles += `<text x="${x + 12}" y="${y + 17}" fill="white" text-anchor="middle" font-size="14">${ch === 'S' ? '▼' : '▲'}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * size} ${rows * size}"><rect width="100%" height="100%" fill="#10161b"/>${tiles}<rect x="${R.c0 * size}" y="${(rows - R.r1 - 1) * size}" width="${(R.c1 - R.c0 + 1) * size}" height="${(R.r1 - R.r0 + 1) * size}" fill="none" stroke="#e7be74" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export function levelWithPreview(level) {
  const { squad, thumbnail, ...rest } = level;
  return { ...rest, thumbnail: levelThumbnail(level.stage) };
}
