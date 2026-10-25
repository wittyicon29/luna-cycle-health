import { t } from "./i18n";

export const SYMPTOMS_LIST = ["cramps", "bloating", "headache", "fatigue", "mood swings", "acne", "back pain", "nausea", "tender breasts", "insomnia"];

// Stored symptom keys stay English; this is the display label. The literals are listed so
// `npm run i18n:check` and the review sheet see them (the lookup itself is dynamic).
export function symptomLabel(key) {
  switch (key) {
    case "cramps": return t("cramps");
    case "bloating": return t("bloating");
    case "headache": return t("headache");
    case "fatigue": return t("fatigue");
    case "mood swings": return t("mood swings");
    case "acne": return t("acne");
    case "back pain": return t("back pain");
    case "nausea": return t("nausea");
    case "tender breasts": return t("tender breasts");
    case "insomnia": return t("insomnia");
    default: return key;
  }
}

// Bare flow word for a stored flow value (chips, calendar labels). The stored value stays English.
export function flowWord(flow) {
  switch (flow) {
    // i18n-note: "spotting" is हल्का रक्तस्राव and "light" is just हल्का, so the two chips sit next to each other as "हल्का रक्तस्राव" / "हल्का"; unsure they are distinct enough
    case "spotting": return t("spotting");
    case "light": return t("light");
    case "medium": return t("medium");
    case "heavy": return t("heavy");
    default: return flow;
  }
}

// "{flow} flow" badge text for a stored flow_intensity value (light | medium | heavy).
export function flowLabel(flow) {
  switch (flow) {
    case "light": return t("light flow");
    case "medium": return t("medium flow");
    case "heavy": return t("heavy flow");
    default: return t("{flow} flow", { flow });
  }
}
