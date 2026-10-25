"""Language support for AI prompts.

v1 scope: the Hindi instruction is appended to the user-facing prompts only (chat, and the Qwen
report in analysis). The clinical MedGemma analysis (medical_analysis / risk_flags / health_insights)
stays English, and fallback texts are English.
"""
SUPPORTED_LANGUAGES = ("en", "hi")

# Devanagari uses several times more tokens than English.
HINDI_MAX_TOKENS = 4096

_HINDI = (
    "LANGUAGE: The user has chosen Hindi. Reply in Hindi written in Devanagari script, using simple everyday words "
    "and a warm, respectful tone (use 'आप'). If the user's own message is written in Hinglish (Hindi in Latin "
    "script), reply in Hinglish instead. Keep numbers, dates and medicine names exactly as written; do not invent "
    "Hindi names for medicines."
)

_HINDI_JSON = (
    " When you must return JSON, keep the JSON structure and every key in English exactly as specified, and write "
    "only the human-readable string values in Hindi."
)


def language_instruction(language: str, structured: bool = False) -> str:
    if language == "hi":
        return _HINDI + (_HINDI_JSON if structured else "")
    return ""
