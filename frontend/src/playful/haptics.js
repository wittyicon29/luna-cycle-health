import { isNative } from '../platform';
import { loadPlayful } from './playfulPrefs';

async function impactLight() {
  const { Haptics } = await import('@capacitor/haptics');
  await Haptics.impact({ style: 'LIGHT' }); // the proxy is used inside this function only, never returned
}

export async function tick() {
  if (!isNative() || loadPlayful() !== 'normal') return;
  try { await impactLight(); } catch (e) { /* haptics are a nicety */ }
}
