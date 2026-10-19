from pydantic import BaseModel, Field, validator
from datetime import date
from typing import Optional, List, Dict, Any
from enum import Enum

class BiologicalSex(str, Enum):
    female = "female"
    male = "male"
    other = "other"

class BleedingVolume(str, Enum):
    light = "light"
    moderate = "moderate"
    heavy = "heavy"

class PainTiming(str, Enum):
    before_menses = "before_menses"
    during_menses = "during_menses"
    after_menses = "after_menses"

class PainReliefLevel(str, Enum):
    none = "none"
    partial = "partial"
    complete = "complete"

class SeverityScale(int, Enum):
    none = 0
    mild = 1
    moderate = 2
    severe = 3

class ContraceptionType(str, Enum):
    pill = "pill"
    patch = "patch"
    ring = "ring"
    hormonal_iud = "hormonal_iud"
    copper_iud = "copper_iud"
    implant = "implant"
    injection = "injection"
    none = "none"

# Section A: Basic & Demographic
class BasicDemographic(BaseModel):
    age: int = Field(ge=10, le=100)
    biological_sex: BiologicalSex
    gender_identity: Optional[str] = None
    weight_kg: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    
    @property
    def bmi(self) -> float:
        return round(self.weight_kg / ((self.height_cm / 100) ** 2), 1)

# Section B: Reproductive & Gynecologic History
class ReproductiveHistory(BaseModel):
    age_at_menarche: int = Field(ge=8, le=20)
    currently_pregnant: bool
    breastfeeding: bool
    num_pregnancies: int = Field(ge=0)
    num_births: int = Field(ge=0)
    num_miscarriages: int = Field(ge=0)
    num_abortions: int = Field(ge=0)
    gynecologic_surgeries: bool
    surgery_details: Optional[str] = None

# Section C: Cycle Pattern
class CyclePattern(BaseModel):
    last_menstrual_period: date
    typical_cycle_length: int = Field(ge=10, le=120)
    cycle_variability_days: int = Field(ge=0, le=30)
    typical_bleeding_duration: int = Field(ge=1, le=15)
    bleeding_volume: BleedingVolume
    sanitary_products_per_day: int = Field(ge=0, le=50)
    passes_large_clots: bool
    change_frequency_heaviest_hour: str
    intermenstrual_bleeding: bool
    recent_amenorrhea: bool
    amenorrhea_duration_months: Optional[int] = None
    
    @validator('typical_cycle_length')
    def validate_cycle_length(cls, v):
        if v < 21 or v > 35:
            # Flag as atypical but don't reject
            pass
        return v

# Section D: Pain & Symptom Timing
class PainSymptoms(BaseModel):
    has_cramping: bool
    pain_severity: int = Field(ge=0, le=10)
    pain_timing: Optional[PainTiming] = None
    painkiller_effectiveness: PainReliefLevel
    has_nausea: bool
    has_vomiting: bool
    has_fainting: bool
    has_diarrhea: bool

# Section E: Systemic & Cyclical Symptoms
class PMSSymptoms(BaseModel):
    mood_swings: SeverityScale
    severe_sadness: SeverityScale
    anger: SeverityScale
    anxiety: SeverityScale
    poor_concentration: SeverityScale
    breast_tenderness: SeverityScale
    bloating: SeverityScale
    headaches: SeverityScale
    interferes_with_daily_activities: bool
    interference_severity: Optional[int] = Field(None, ge=0, le=10)

# Section F: Androgen Excess / Metabolic
class MetabolicSymptoms(BaseModel):
    hirsutism: bool
    fgs_score: Optional[int] = Field(None, ge=0, le=36)
    acne: bool
    hair_loss: bool
    insulin_resistance: bool
    type2_diabetes: bool
    metabolic_syndrome: bool

# Section G: Contraception & Medications
class ContraceptionMedications(BaseModel):
    using_hormonal_contraception: bool
    contraception_type: Optional[ContraceptionType] = None
    contraception_start_date: Optional[date] = None
    on_anticoagulants: bool
    on_ssris: bool
    on_steroids: bool
    on_antipsychotics: bool
    on_hormonal_therapy: bool
    medication_list: Optional[List[str]] = []
    recent_contraceptive_change: bool
    contraceptive_change_details: Optional[str] = None

# Section H: Medical Comorbidities
class MedicalHistory(BaseModel):
    thyroid_disease: bool
    pcos: bool
    hyperprolactinemia: bool
    bleeding_disorder: bool
    easy_bruising: bool
    chronic_illnesses: Optional[List[str]] = []
    recent_weight_change: bool
    weight_change_direction: Optional[str] = None

# Section I: Sexual History
class SexualHistory(BaseModel):
    sexually_active: bool
    last_intercourse_date: Optional[date] = None
    abnormal_discharge: bool
    pelvic_pain: bool
    fever: bool
    recent_sti: bool
    sti_details: Optional[str] = None

# Section J: Labs & Imaging
class LabsImaging(BaseModel):
    last_cbc_date: Optional[date] = None
    hemoglobin_level: Optional[float] = Field(None, ge=0, le=20)
    had_pelvic_ultrasound: bool
    ultrasound_date: Optional[date] = None
    ultrasound_findings: Optional[str] = None
    had_hormone_tests: bool
    hormone_test_results: Optional[Dict[str, Any]] = None

# Section K: Goals & Preferences
class GoalsPreferences(BaseModel):
    trying_to_conceive: bool
    prefers_non_pharmacologic: bool
    data_consent_given: bool = Field(..., description="Required: explicit consent to analyze data")
    share_with_provider_consent: bool

# Section L: Optional Data
class OptionalData(BaseModel):
    cycle_history_csv: Optional[str] = None
    additional_notes: Optional[str] = None

# Complete Questionnaire
class ComprehensiveQuestionnaire(BaseModel):
    questionnaire_date: date = Field(default_factory=date.today)
    
    # All sections
    basic_demographic: BasicDemographic
    reproductive_history: ReproductiveHistory
    cycle_pattern: CyclePattern
    pain_symptoms: PainSymptoms
    pms_symptoms: PMSSymptoms
    metabolic_symptoms: MetabolicSymptoms
    contraception_medications: ContraceptionMedications
    medical_history: MedicalHistory
    sexual_history: SexualHistory
    labs_imaging: LabsImaging
    goals_preferences: GoalsPreferences
    optional_data: Optional[OptionalData] = None
    
    @validator('goals_preferences')
    def validate_consent(cls, v):
        if not v.data_consent_given:
            raise ValueError("Data consent is required to proceed")
        return v
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage."""
        return self.dict(exclude_none=True)
    
    def get_risk_flags(self) -> List[str]:
        """Identify risk flags from questionnaire data."""
        flags = []
        
        # Cycle irregularity
        if self.cycle_pattern.typical_cycle_length < 21 or self.cycle_pattern.typical_cycle_length > 35:
            flags.append("atypical_cycle_length")
        
        # Heavy bleeding
        if self.cycle_pattern.bleeding_volume == BleedingVolume.heavy or self.cycle_pattern.passes_large_clots:
            flags.append("heavy_bleeding")
        
        # Amenorrhea
        if self.cycle_pattern.recent_amenorrhea and self.cycle_pattern.amenorrhea_duration_months and self.cycle_pattern.amenorrhea_duration_months > 3:
            flags.append("prolonged_amenorrhea")
        
        # Severe pain
        if self.pain_symptoms.pain_severity >= 7:
            flags.append("severe_dysmenorrhea")
        
        # Red flag symptoms
        if self.pain_symptoms.has_fainting or self.pain_symptoms.has_vomiting:
            flags.append("red_flag_symptoms")
        
        # PCOS indicators
        pcos_indicators = 0
        if self.cycle_pattern.cycle_variability_days > 7:
            pcos_indicators += 1
        if self.metabolic_symptoms.hirsutism or self.metabolic_symptoms.acne:
            pcos_indicators += 1
        if self.medical_history.pcos or self.metabolic_symptoms.insulin_resistance:
            pcos_indicators += 1
        if pcos_indicators >= 2:
            flags.append("possible_pcos")
        
        # Anemia risk
        if self.cycle_pattern.bleeding_volume == BleedingVolume.heavy and self.cycle_pattern.typical_bleeding_duration > 7:
            flags.append("anemia_risk")
        
        # Infection risk
        if self.sexual_history.abnormal_discharge or self.sexual_history.fever or self.sexual_history.pelvic_pain:
            flags.append("possible_infection")
        
        return flags
    
    def get_urgency_level(self) -> str:
        """Determine urgency level based on symptoms."""
        flags = self.get_risk_flags()
        
        if "red_flag_symptoms" in flags or "possible_infection" in flags:
            return "urgent"
        elif "severe_dysmenorrhea" in flags or "heavy_bleeding" in flags:
            return "moderate"
        elif "prolonged_amenorrhea" in flags or "possible_pcos" in flags:
            return "routine"
        else:
            return "none"
