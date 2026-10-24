import httpx
import json
import re
from typing import Dict, Any, List
from ..core.config import settings
from .prediction_service import tracked_cycles_phrase, format_friendly_date, variation_clause

LUNA_PERSONALITY = """You are Luna, a knowledgeable health guide specializing in menstrual health.

Your personality:
- Supportive and non-judgmental
- Calm and reassuring
- Evidence-based and clear
- Use simple language, avoid medical jargon
- Privacy-respecting

Your role is a mix of:
- Health educator (explain patterns)
- Supportive coach (encourage tracking)
- Data analyst (interpret trends)

Guidelines:
- Never diagnose or imply something is "wrong"
- Always explain WHY you reached conclusions
- Use phrases like "Your cycle pattern shows..." not "You have..."
- For concerning symptoms, say "These symptoms can sometimes require medical attention"
- Reassure when appropriate: "Many people experience this"
- Be specific with data: "Your last 6 cycles ranged between X-Y days"
- End with actionable next steps

Never sound like:
- A chatbot
- A robot
- A doctor diagnosing
- Overly cheerful

You are: knowledgeable, friendly, empathetic, calm, science-based, non-alarmist."""

class LLMService:
    def __init__(self):
        self.medgemma_model = settings.MEDGEMMA_MODEL
        self.qwen_model = settings.QWEN_MODEL
        self.hf_api_key = settings.HUGGINGFACE_API_KEY
        self.groq_api_key = settings.GROQ_API_KEY
        self.hf_endpoint = f"https://api-inference.huggingface.co/models/{self.medgemma_model}"
        self.groq_endpoint = "https://api.groq.com/openai/v1/chat/completions"
    
    async def call_medgemma(self, prompt: str) -> str:
        headers = {"Authorization": f"Bearer {self.hf_api_key}"}
        payload = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": 1024,
                "temperature": 0.3,
                "return_full_text": False,
            }
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(self.hf_endpoint, json=payload, headers=headers)
            response.raise_for_status()
            result = response.json()
            return result[0]["generated_text"] if isinstance(result, list) else result.get("generated_text", "")
    
    async def call_qwen(self, prompt: str, system_prompt: str = None) -> str:
        headers = {
            "Authorization": f"Bearer {self.groq_api_key}",
            "Content-Type": "application/json"
        }
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        payload = {
            "model": self.qwen_model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 2048,
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(self.groq_endpoint, json=payload, headers=headers)
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"]
    
    def parse_llm_json(self, raw: str) -> Dict[str, Any]:
        raw = raw.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            if len(parts) >= 2:
                raw = parts[1].lstrip("json").strip()
        
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except:
                    pass
            return self.fallback_response()
    
    def fallback_response(self) -> Dict[str, Any]:
        return {
            "simple_summary": "Your cycle data has been analyzed.",
            "key_insights": ["Unable to generate detailed analysis at this time."],
            "recommendations": ["Please consult with a healthcare provider."]
        }
    
    async def analyze_cycle_health(self, period_data: List[Dict], questionnaire: Dict, stats: Dict, prediction: Dict) -> Dict[str, Any]:
        # Step 1: MedGemma
        health_breakdown = stats.get('health_breakdown', {})
        health_grade = stats.get('health_grade', 'Unknown')
        trend = stats.get('trend', 'stable')
        
        # Extract probabilistic information
        confidence_info = prediction.get('confidence', {})
        probabilistic_info = prediction.get('probabilistic_info', {})
        prediction_range = prediction.get('prediction_range', {})
        statistics = prediction.get('statistics', {})
        
        # Create detailed health context for LLM
        health_context = f"""
Health Score: {(str(stats.get('health_score')) + '/100 (' + health_grade + ')') if stats.get('health_score') is not None else 'not enough data yet'}
Trend: {trend}
Breakdown:
- Regularity: {health_breakdown.get('regularity_score', 0)}/35
- Cycle Length: {health_breakdown.get('length_score', 0)}/25  
- Pain Management: {health_breakdown.get('pain_score', 0)}/20
- Duration: {health_breakdown.get('duration_score', 0)}/10
- Symptoms: {health_breakdown.get('symptom_score', 0)}/10

Prediction Confidence: {confidence_info.get('percentage', 0)}% ({confidence_info.get('level', 'unknown')})
Data Quality: {statistics.get('data_quality', 'unknown')} based on {statistics.get('data_points', 0)} cycles
Natural Variation: ±{statistics.get('cycle_std_deviation', 0)} days
"""
        
        medgemma_prompt = f"""Analyze menstrual cycle data with detailed health scoring and probabilistic predictions. Provide clinical assessment in JSON.

STATS: Avg {statistics.get('average_cycle_length')} days, SD {statistics.get('cycle_std_deviation')}, Total cycles {statistics.get('data_points')}
HEALTH ANALYSIS: {health_context}
PREDICTION RANGE: {prediction_range.get('earliest')} to {prediction_range.get('latest')} (most likely: {prediction_range.get('most_likely')})
CONFIDENCE: {confidence_info.get('percentage')}% {confidence_info.get('level')}
CYCLES: {json.dumps(period_data[:6])}
QUESTIONNAIRE: {json.dumps(questionnaire)}
PROBABILISTIC NOTE: {probabilistic_info.get('disclaimer', '')}

Focus on:
1. Regularity patterns and consistency with confidence levels
2. Pain levels and management effectiveness
3. Cycle length optimization considering natural variation
4. Symptom severity patterns
5. Overall health implications with uncertainty acknowledgment

IMPORTANT: Include uncertainty and probabilistic nature in your assessment. These are statistical predictions, not guarantees.

JSON format:
{{"clinical_findings": ["..."], "risk_factors": ["..."], "medical_recommendations": ["..."], "urgency": "none|low|medium|high", "key_concerns": ["..."], "positive_indicators": ["..."], "prediction_confidence": "high|medium|low", "uncertainty_note": "..."}}"""
        
        try:
            medgemma_response = await self.call_medgemma(medgemma_prompt)
            medical_analysis = self.parse_llm_json(medgemma_response)
        except Exception as e:
            print(f"MedGemma Error: {e}")
            medical_analysis = {"clinical_findings": [], "risk_factors": [], "medical_recommendations": [], "urgency": "none", "key_concerns": [], "positive_indicators": [], "prediction_confidence": confidence_info.get('level', 'low'), "uncertainty_note": probabilistic_info.get('disclaimer', '')}
        
        # Step 2: Qwen with personality and probabilistic insights
        qwen_prompt = f"""Convert medical analysis to supportive, personalized report with probabilistic messaging.

Medical: {json.dumps(medical_analysis)}
Health Analysis: {health_context}
Prediction Range: {prediction_range.get('earliest')} to {prediction_range.get('latest')} (most likely: {prediction_range.get('most_likely')})
Confidence: {confidence_info.get('percentage')}% {confidence_info.get('level')}
Statistics: Avg {statistics.get('average_cycle_length')} days, Variation {statistics.get('cycle_std_deviation')} days, Tracked {statistics.get('data_points')} cycles
Probabilistic Info: {json.dumps(probabilistic_info)}

Create personalized insights with clear probabilistic messaging:
- Emphasize that predictions are statistical estimates, not guarantees
- Include confidence levels and natural variation in explanations
- Focus on health score breakdown with uncertainty context
- Acknowledge data quality and its impact on predictions
- Provide recommendations that account for natural variability

CRITICAL: Always include probabilistic disclaimers and uncertainty messaging. Help users understand that:
1. Predictions are based on patterns, not certainties
2. Natural variation is normal and expected
3. Confidence depends on data quality and consistency
4. Individual cycles can vary significantly from averages

JSON format:
{{
  "simple_summary": "One sentence overview with probabilistic context (e.g., 'Based on your patterns, there's a 70% chance your next period will arrive around [date], with natural variation of ±X days')",
  "key_insights": ["3-4 insights with data and confidence levels", "Include uncertainty and natural variation", "Reference specific score components"],
  "why_this_result": ["Explain reasoning with uncertainty", "Connect to actual data patterns and limitations"],
  "recommendations": ["3-4 suggestions accounting for natural variability", "Include tracking recommendations for better predictions"],
  "what_to_expect": "Probabilistic next cycle description with ranges and confidence",
  "when_to_see_doctor": "Clear guidance with uncertainty context",
  "next_steps": ["2-3 specific actions considering natural variation"],
  "prediction_disclaimer": "Clear probabilistic disclaimer about prediction uncertainty"
}}

Use supportive language. Explain uncertainty clearly. Be reassuring about natural variation. Avoid definitive statements. Make it feel personalized while acknowledging statistical limitations."""
        
        try:
            qwen_response = await self.call_qwen(qwen_prompt, LUNA_PERSONALITY)
            user_friendly = self.parse_llm_json(qwen_response)
        except Exception as e:
            print(f"Qwen Error: {e}")
            user_friendly = {
                "simple_summary": f"Based on your {tracked_cycles_phrase(statistics.get('data_points') or 0)}, there's a {confidence_info.get('percentage')}% chance your next period will arrive around {format_friendly_date(prediction_range.get('most_likely'))}{variation_clause(statistics.get('cycle_std_deviation'))}.",
                "key_insights": medical_analysis.get("clinical_findings", []) + medical_analysis.get("positive_indicators", []),
                "why_this_result": ["Based on your tracked patterns with statistical uncertainty"],
                "recommendations": medical_analysis.get("medical_recommendations", []),
                "what_to_expect": f"Your next period is predicted for {format_friendly_date(prediction_range.get('most_likely'))} with a {confidence_info.get('percentage')}% confidence level.",
                "when_to_see_doctor": "Consult a healthcare provider if patterns change significantly.",
                "next_steps": ["Continue tracking to improve prediction accuracy"],
                "prediction_disclaimer": probabilistic_info.get('disclaimer', 'These predictions are based on statistical patterns and individual results may vary.')
            }
        
        return {
            "medical_analysis": medical_analysis,
            "user_report": user_friendly,
            "simple_summary": user_friendly.get("simple_summary", ""),
            "key_insights": user_friendly.get("key_insights", []),
            "why_this_result": user_friendly.get("why_this_result", []),
            "recommendations": user_friendly.get("recommendations", []),
            "what_to_expect": user_friendly.get("what_to_expect", ""),
            "when_to_see_doctor": user_friendly.get("when_to_see_doctor", ""),
            "next_steps": user_friendly.get("next_steps", []),
            "risk_flags": medical_analysis.get("risk_factors", []),
            "urgency": medical_analysis.get("urgency", "none"),
            "health_insights": medical_analysis.get("positive_indicators", []),
            "health_score_breakdown": health_breakdown,
            "health_grade": health_grade,
            "trend": trend,
            "prediction_confidence": confidence_info.get('level', 'low'),
            "probabilistic_disclaimer": probabilistic_info.get('disclaimer', ''),
            "prediction_range": prediction_range,
            "confidence_percentage": confidence_info.get('percentage', 0)
        }

llm_service = LLMService()
