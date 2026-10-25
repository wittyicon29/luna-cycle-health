const MAP = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };

export function pseudo(text) {
  const parts = String(text).split(/(\{\w+\})/);
  const mapped = parts.map(p => (/^\{\w+\}$/.test(p) ? p : p.replace(/[aeiouAEIOU]/g, c => MAP[c])));
  const out = mapped.join('');
  return out + '~'.repeat(Math.ceil(out.length * 0.3));
}
