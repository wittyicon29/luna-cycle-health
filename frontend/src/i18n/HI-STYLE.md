# Hindi style guide for Luna

## Register and tone
- Formal "आप" throughout. Never "तुम" or "तू".
- Warm and calm, never alarming. Health content is informational, never diagnostic.
- Plain, everyday words. Prefer common Hindi over Sanskritised or purely literal calques; avoid machine-style word-for-word translation.
- Numbers use Latin digits (1, 2, 3), set by `intlLocale()` (`hi-IN-u-nu-latn`).
- Keep the product name "Luna" in Latin script.
- Button labels are imperative ("दर्ज करें"). Full sentences end with the danda `।`; short labels and headings do not.
- "Not a doctor" and similar disclaimers are translated literally, with no softening.

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
| acne | मुंहासे |
| back pain | कमर दर्द |
| nausea | जी मिचलाना |
| tender breasts | स्तनों में कोमलता |
| insomnia | नींद न आना |
| flow | रक्तस्राव की मात्रा |
| spotting | हल्का रक्तस्राव |
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
| insights | इनसाइट्स (अंतर्दृष्टि) |
| profile | प्रोफ़ाइल |
| sign in | साइन इन करें |
| register | रजिस्टर करें |
| log in | लॉग इन |
| log out | लॉग आउट |
| delete account | खाता हटाएँ |
| privacy | गोपनीयता |
| consent | सहमति |
| terms | शर्तें |
| AI | एआई |

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
