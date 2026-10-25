import { isNative } from '../platform';
import { getPlayful } from './playfulPrefs';

async function impactLight() {
  const { Haptics } = await import('@capacitor/haptics');
  await Haptics.impact({ style: 'LIGHT' }); // the proxy is used inside this function only, never returned
}

export async function tick() {
  if (!isNative() || getPlayful() !== 'normal') return;
  try { await impactLight(); } catch (e) { /* haptics are a nicety */ }
}
