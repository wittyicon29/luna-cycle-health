from pydantic import BaseModel, Field, validator
from datetime import date
from typing import Optional, List
from enum import Enum
import json

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

# Section A: Basic & Demographic
class BasicDemographic(BaseModel):
    age: int = Field(ge=10, le=100)
    biological_sex: BiologicalSex
    weight_kg: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    
    @property
    def bmi(self) -> float:
        return round(self.weight_kg / ((self.height_cm / 100) ** 2), 1)

# Section C: Cycle Pattern
class CyclePattern(BaseModel):
    last_menstrual_period: date
    typical_cycle_length: int = Field(ge=10, le=120)
    cycle_variability_days: int = Field(ge=0, le=30)
    typical_bleeding_duration: int = Field(ge=1, le=15)
    bleeding_volume: BleedingVolume
    sanitary_products_per_day: int = Field(ge=0, le=50)
    passes_large_clots: bool
    intermenstrual_bleeding: bool
    
    @validator('typical_cycle_length')
    def validate_cycle_length(cls, v):
        if v < 21 or v > 35:
            pass  # Flag as atypical but don't reject
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

# Section L: Optional Data & Consent
class OptionalData(BaseModel):
    additional_notes: Optional[str] = None
    data_consent_given: bool = Field(..., description="Required: explicit consent to analyze data")

# Simplified Questionnaire
class SimplifiedQuestionnaire(BaseModel):
    questionnaire_date: date = Field(default_factory=date.today)
    
    basic_demographic: BasicDemographic
    cycle_pattern: CyclePattern
    pain_symptoms: PainSymptoms
    pms_symptoms: PMSSymptoms
    optional_data: OptionalData
    
    @validator('optional_data')
    def validate_consent(cls, v):
        if not v.data_consent_given:
            raise ValueError("Data consent is required to proceed")
        return v
    
    def to_dict(self):
        return json.loads(self.json(exclude_none=True))
    
    def get_risk_flags(self) -> List[str]:
        flags = []
        
        if self.cycle_pattern.typical_cycle_length < 21 or self.cycle_pattern.typical_cycle_length > 35:
            flags.append("atypical_cycle_length")
        
        if self.cycle_pattern.bleeding_volume == BleedingVolume.heavy or self.cycle_pattern.passes_large_clots:
            flags.append("heavy_bleeding")
        
        if self.pain_symptoms.pain_severity >= 7:
            flags.append("severe_dysmenorrhea")
        
        if self.pain_symptoms.has_fainting or self.pain_symptoms.has_vomiting:
            flags.append("red_flag_symptoms")
        
        if self.cycle_pattern.cycle_variability_days > 7:
            flags.append("irregular_cycles")
        
        return flags
    
    def get_urgency_level(self) -> str:
        flags = self.get_risk_flags()
        
        if "red_flag_symptoms" in flags:
            return "urgent"
        elif "severe_dysmenorrhea" in flags or "heavy_bleeding" in flags:
            return "moderate"
        elif "irregular_cycles" in flags or "atypical_cycle_length" in flags:
            return "routine"
        else:
            return "none"
