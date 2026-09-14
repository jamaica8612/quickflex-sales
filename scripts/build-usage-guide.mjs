// Keep the approved guide template as the source; ship relative, cacheable assets.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const asset = name => {
  if (!existsSync(new URL(name, root))) throw new Error(`Missing guide asset: ${name}`);
  return `./${name}`;
};
const images = {
  pace: { src: asset('assets/usage-guide/pace.png'), title: '타수 측정 화면', alt: '가상 구역 316C와 316D, 45.2가구/시간 페이스와 구역별 수량 예시' },
  finish: { src: asset('assets/usage-guide/finish.png'), title: '업무 종료 · 수량 검토', alt: '가상 구역 316C 124개, 316D 74개와 부가 항목, 최종 매출 저장 버튼' },
  edit: { src: asset('assets/usage-guide/edit.png'), title: '업무 종료 · 수량 수정', alt: '가상 수량 수정 예시. 구역 합계 192개가 정산 상품 198개보다 6개 부족해 경고가 표시된 상태' },
};
const replacements = {
  __FONT__: asset('assets/fonts/PretendardVariable.woff2'),
  __LOGO__: asset('assets/usage-guide/flexnote-symbol.svg'),
  __PACE__: images.pace.src,
  __FINISH__: images.finish.src,
  __IMAGE_DATA__: JSON.stringify(images).replaceAll('<', '\\u003c'),
};
let html = readFileSync(new URL('docs/usage-guide/guide-template.html', root), 'utf8');
for (const [token, value] of Object.entries(replacements)) {
  if (!html.includes(token)) throw new Error(`Missing template token: ${token}`);
  html = html.replaceAll(token, value);
}
if (/__[A-Z_]+__/.test(html)) throw new Error('Unresolved guide token');
writeFileSync(new URL('guide.html', root), html);
console.log(`Built guide.html: ${Buffer.byteLength(html).toLocaleString()} bytes`);
