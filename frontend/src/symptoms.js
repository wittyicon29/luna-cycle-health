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
    // i18n-note: "spotting" keeps the commonly used loanword with a gloss, स्पॉटिंग (हल्के धब्बे), so it is distinct from "light" (हल्का)
    case "spotting": return t("spotting");
    case "light": return t("light");
    case "medium": return t("medium");
    case "heavy": return t("heavy");
    default: return flow;
  }
}

// Screen-reader phrase for a day's flow ("flow light"); spotting has its own phrase so Hindi does not read
// "रक्तस्राव: स्पॉटिंग".
export function flowAria(flow) {
  if (flow === "spotting") return t("flow spotting");
  return t("flow {flow}", { flow: flowWord(flow) });
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
