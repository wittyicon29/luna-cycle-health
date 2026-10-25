import { t } from "../i18n";

export const MOODS = ["Very low", "Low", "Okay", "Good", "Great"];
// Display name of mood level 1..5 (the stored value is the number).
export function moodLabel(i) {
  switch (i) {
    // i18n-note: the five mood words (बहुत उदास / थोड़ा उदास / ठीक / अच्छा / बहुत बढ़िया) are a plain scale
    case 0: return t("Very low");
    case 1: return t("Low");
    case 2: return t("Okay");
    case 3: return t("Good");
    default: return t("Great");
  }
}

export const WEATHER = [
  { value: 1, key: 'storm' },
  { value: 2, key: 'overcast' },
  { value: 3, key: 'thinCloud' },
  { value: 4, key: 'starry' },
  { value: 5, key: 'fullMoon' },
];

export function weatherForMood(value) {
  return WEATHER.find(w => w.value === value) || null;
}
