# Hindi style guide for Luna

## Register and tone
- Formal "आप" throughout. Never "तुम" or "तू".
- Warm and calm, never alarming. Health content is informational, never diagnostic.
- Plain, everyday words. Prefer common Hindi over Sanskritised or purely literal calques; avoid machine-style word-for-word translation.
- Numbers use Latin digits (1, 2, 3), set by `intlLocale()` (`hi-IN-u-nu-latn`).
- Keep the product name "Luna" in Latin script.
- Button labels are imperative ("दर्ज करें"). Full sentences end with the danda `।`; short labels and headings do not.
- "Not a doctor" and similar disclaimers are translated literally, with no softening.

## Gender decision (reviewer to confirm)
- Verbs addressed to the user use the standard generic masculine with आप (भूल गए, चुन चुके हैं, कर सकते हैं), except where a gender-neutral construction is equally natural; prefer those (for example passives or noun forms such as "पुष्टि करें").
- Luna's own verbs are feminine (Luna ... समझाती है, भेजती है), as Luna is a feminine name.
- This is a reviewer decision: change it everywhere at once if the reviewer prefers another convention.

## Glossary (proposed; reviewer to confirm)
| English | Hindi |
| --- | --- |
| period (menstrual) | माहवारी |
| cycle | मासिक चक्र |
| cycle length | चक्र की अवधि |
| predicted | अनुमानित |
| symptoms | लक्षण |
| cramps | ऐंठन |
| bloating | पेट फूलना |
| headache | सिरदर्द |
| fatigue | थकान |
| mood swings | मूड में बदलाव |
| acne | मुँहासे |
| back pain | कमर दर्द |
| nausea | जी मिचलाना |
| tender breasts | स्तनों में दर्द |
| insomnia | नींद न आना |
| flow | रक्तस्राव की मात्रा |
| spotting | स्पॉटिंग (हल्के धब्बे); in aria text "हल्के धब्बे" |
| archive (medication) | संग्रहीत करें (one term in the UI and in server messages; never आर्काइव) |
| light | हल्का |
| medium | मध्यम |
| heavy | भारी |
| mood | मूड |
| sleep | नींद |
| water | पानी |
| medication | दवा |
| supplement | सप्लीमेंट |
| note | नोट |
| reminder | रिमाइंडर |
| calendar | कैलेंडर |
| journey | यात्रा |
| insights | इनसाइट्स |
| profile | प्रोफ़ाइल |
| sign in (button) | साइन इन करें |
| register | रजिस्टर करें |
| log in (button) | लॉग इन करें |
| log out (button) | लॉग आउट करें |
| delete account | खाता हटाएँ |
| privacy | गोपनीयता |
| consent | सहमति |
| terms | शर्तें |
| AI | एआई |

Notes on the glossary:
- Use "sign in" and "log in" exactly as the app's English copy does: whichever English wording a screen uses maps to its own Hindi row above, and the two are not mixed on one screen. "Register" is only for creating an account.
- Spelling: write तारीख, आखिरी and similar words without the nukta dot, consistently (except where the nukta is needed to tell sounds apart, such as ज़रूरत, नज़र, फ़ोल्डर).
- "Try again" is always दोबारा कोशिश करें (never दोबारा प्रयास करें), in buttons and in server messages alike.
- Reviewer note: "period" is written माहवारी in formal copy. The colloquial पीरियड / पीरियड्स is common; use it in short labels only if the reviewer prefers.

## Uncertain translations
Put a comment directly above the `t()` call explaining why a translation is uncertain:

```js
// i18n-note: unsure whether "सहमति" or "अनुमति" reads better here
t('Consent')
```

The review-sheet script collects these notes for the Hindi reviewer.

## Adding a language
1. Copy `catalogs/hi.json` to `catalogs/<code>.json` and translate the values.
2. Register the code in `SUPPORTED` (and `CATALOGS`, plural rule, `intlLocale`, `languageLabel`) in `index.js`.
3. Add a font for the script and `:lang(<code>)` CSS rules.
4. Run `npm run i18n:check` until it passes.
