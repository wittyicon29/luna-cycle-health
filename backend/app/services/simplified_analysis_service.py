from typing import Dict, Any, List
from ..schemas.simplified_questionnaire import SimplifiedQuestionnaire, BleedingVolume

class SimplifiedAnalysisService:
    """Service for analyzing simplified questionnaire data and generating recommendations."""
    
    def analyze(self, questionnaire: SimplifiedQuestionnaire) -> Dict[str, Any]:
        """Perform analysis of simplified questionnaire data."""
        
        return {
            "risk_assessment": self._assess_risks(questionnaire),
            "recommended_tests": self._recommend_tests(questionnaire),
            "urgency_level": questionnaire.get_urgency_level(),
            "clinical_summary": self._generate_summary(questionnaire),
            "next_steps": self._generate_next_steps(questionnaire),
        }
    
    def _assess_risks(self, q: SimplifiedQuestionnaire) -> Dict[str, Any]:
        """Assess various health risks based on simplified questionnaire."""
        risks = {}
        
        # PCOS Risk Score (0-100)
        pcos_score = 0
        if q.cycle_pattern.typical_cycle_length > 35:
            pcos_score += 30
        if q.cycle_pattern.cycle_variability_days > 7:
            pcos_score += 20
        if q.basic_demographic.bmi > 30:
            pcos_score += 25
        risks["pcos_risk_score"] = min(pcos_score, 100)
        
        # Anemia Risk Score (0-100)
        anemia_score = 0
        if q.cycle_pattern.bleeding_volume == BleedingVolume.heavy:
            anemia_score += 40
        if q.cycle_pattern.passes_large_clots:
            anemia_score += 20
        if q.cycle_pattern.typical_bleeding_duration > 7:
            anemia_score += 20
        if q.cycle_pattern.sanitary_products_per_day > 6:
            anemia_score += 20
        risks["anemia_risk_score"] = min(anemia_score, 100)
        
        # Endometriosis Risk Score (0-100)
        endo_score = 0
        if q.pain_symptoms.pain_severity >= 7:
            endo_score += 35
        if q.pain_symptoms.painkiller_effectiveness == "none":
            endo_score += 25
        if q.pain_symptoms.has_diarrhea or q.pain_symptoms.has_nausea:
            endo_score += 20
        risks["endometriosis_risk_score"] = min(endo_score, 100)
        
        # PMDD Risk Score (0-100)
        pmdd_score = 0
        severe_symptoms = sum([
            1 for s in [
                q.pms_symptoms.mood_swings,
                q.pms_symptoms.severe_sadness,
                q.pms_symptoms.anger,
                q.pms_symptoms.anxiety
            ] if s >= 2
        ])
        if severe_symptoms >= 3:
            pmdd_score += 50
        if q.pms_symptoms.interferes_with_daily_activities:
            pmdd_score += 30
        if q.pms_symptoms.interference_severity and q.pms_symptoms.interference_severity >= 7:
            pmdd_score += 20
        risks["pmdd_risk_score"] = min(pmdd_score, 100)
        
        return risks
    
    def _recommend_tests(self, q: SimplifiedQuestionnaire) -> List[Dict[str, str]]:
        """Recommend clinical tests based on simplified questionnaire."""
        tests = []
        
        # CBC for anemia
        if q.cycle_pattern.bleeding_volume == BleedingVolume.heavy or q.cycle_pattern.passes_large_clots:
            tests.append({
                "test": "Complete Blood Count (CBC)",
                "reason": "Assess for anemia due to heavy bleeding",
                "urgency": "routine"
            })
        
        # Thyroid function
        if q.cycle_pattern.cycle_variability_days > 7:
            tests.append({
                "test": "Thyroid Function Tests (TSH, Free T4)",
                "reason": "Thyroid disorders can cause irregular cycles",
                "urgency": "routine"
            })
        
        # Hormone panel for PCOS
        if q.cycle_pattern.typical_cycle_length > 35 and q.cycle_pattern.cycle_variability_days > 7:
            tests.append({
                "test": "Hormone Panel (Testosterone, LH, FSH)",
                "reason": "Evaluate for hormonal imbalances",
                "urgency": "routine"
            })
        
        # Pelvic ultrasound
        if q.pain_symptoms.pain_severity >= 7:
            tests.append({
                "test": "Pelvic Ultrasound",
                "reason": "Evaluate for structural causes of pain",
                "urgency": "moderate"
            })
        
        return tests
    
    def _generate_summary(self, q: SimplifiedQuestionnaire) -> str:
        """Generate clinical summary for provider."""
        summary_parts = []
        
        # Demographics
        summary_parts.append(
            f"{q.basic_demographic.age}yo {q.basic_demographic.biological_sex.value}, "
            f"BMI {q.basic_demographic.bmi}"
        )
        
        # Cycle pattern
        summary_parts.append(
            f"Typical cycle: {q.cycle_pattern.typical_cycle_length} days "
            f"(±{q.cycle_pattern.cycle_variability_days} days), "
            f"bleeding {q.cycle_pattern.typical_bleeding_duration} days, "
            f"{q.cycle_pattern.bleeding_volume.value} flow"
        )
        
        # Key symptoms
        if q.pain_symptoms.has_cramping:
            summary_parts.append(f"Dysmenorrhea severity {q.pain_symptoms.pain_severity}/10")
        
        if q.pms_symptoms.interferes_with_daily_activities:
            summary_parts.append("Significant PMS/PMDD symptoms affecting daily function")
        
        # Risk flags
        flags = q.get_risk_flags()
        if flags:
            summary_parts.append(f"Risk flags: {', '.join(flags)}")
        
        return ". ".join(summary_parts) + "."
    
    def _generate_next_steps(self, q: SimplifiedQuestionnaire) -> List[str]:
        """Generate actionable next steps for patient."""
        steps = []
        
        urgency = q.get_urgency_level()
        
        if urgency == "urgent":
            steps.append("⚠️ Contact your healthcare provider within 24-48 hours")
            steps.append("Describe your symptoms, especially any fever, severe pain, or abnormal discharge")
        elif urgency == "moderate":
            steps.append("Schedule an appointment with your healthcare provider within 1-2 weeks")
        else:
            steps.append("Discuss these findings at your next routine appointment")
        
        # Specific recommendations
        if q.cycle_pattern.bleeding_volume == BleedingVolume.heavy:
            steps.append("Track your bleeding with a menstrual cup or count pads/tampons to quantify blood loss")
            steps.append("Consider iron supplementation and iron-rich foods")
        
        if q.pain_symptoms.pain_severity >= 7:
            steps.append("Keep a pain diary noting timing, severity, and what helps")
            steps.append("Try heat therapy and NSAIDs (if not contraindicated)")
        
        if q.pms_symptoms.interferes_with_daily_activities:
            steps.append("Track mood symptoms daily for 2 cycles to establish pattern")
            steps.append("Consider lifestyle modifications: regular exercise, stress management, adequate sleep")
        
        # Lifestyle recommendations
        if q.basic_demographic.bmi > 30:
            steps.append("Discuss weight management and metabolic health with your provider")
        
        return steps

simplified_analysis_service = SimplifiedAnalysisService()
