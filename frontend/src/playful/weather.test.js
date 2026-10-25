import { MOODS, moodLabel, WEATHER, weatherForMood } from './weather';
import { MOODS as SheetMoods } from '../DaySheet';
import { setLanguage } from '../i18n';

afterEach(() => setLanguage('en'));

test('weather order, keys and values', () => {
  expect(WEATHER).toEqual([
    { value: 1, key: 'storm' }, { value: 2, key: 'overcast' }, { value: 3, key: 'thinCloud' },
    { value: 4, key: 'starry' }, { value: 5, key: 'fullMoon' },
  ]);
  expect(weatherForMood(3)).toEqual({ value: 3, key: 'thinCloud' });
});

test('weatherForMood rejects out-of-range and non-numbers', () => {
  [0, 6, null, '3'].forEach(v => expect(weatherForMood(v)).toBeNull());
});

test('moodLabel English and Hindi', () => {
  expect(MOODS.map((_, i) => moodLabel(i))).toEqual(['Very low', 'Low', 'Okay', 'Good', 'Great']);
  setLanguage('hi');
  expect(MOODS.map((_, i) => moodLabel(i))).toEqual(['बहुत उदास', 'थोड़ा उदास', 'ठीक', 'अच्छा', 'बहुत बढ़िया']);
});

test('DaySheet still exports MOODS', () => {
  expect(SheetMoods).toBe(MOODS);
});
