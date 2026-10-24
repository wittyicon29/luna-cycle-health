import numpy as np
from datetime import date, timedelta
from typing import List, Dict, Any

def weighted_average(lengths: List[int], decay: float = 0.85) -> float:
    """Calculate weighted average with recent cycles weighted more heavily."""
    if not lengths:
        return 28.0
    n = len(lengths)
    weights = [decay ** (n - 1 - i) for i in range(n)]
    return sum(l * w for l, w in zip(lengths, weights)) / sum(weights)

def remove_outliers(lengths: List[int]) -> List[int]:
    """Remove outliers using IQR method."""
    if len(lengths) < 4:
        return lengths
    arr = np.array(lengths)
    q1, q3 = np.percentile(arr, [25, 75])
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    return [l for l in lengths if lower <= l <= upper]

def cycle_lengths(cycles: List[Any]) -> List[int]:
    """Cycle lengths (18-60 days) from consecutive start dates, else stored lengths in range."""
    sorted_cycles = sorted(cycles, key=lambda c: c.start_date)
    calculated = []
    for prev, cur in zip(sorted_cycles, sorted_cycles[1:]):
        days_diff = (cur.start_date - prev.start_date).days
        if 18 <= days_diff <= 60:
            calculated.append(days_diff)
    if calculated:
        return calculated
    return [c.cycle_length for c in cycles if c.cycle_length and 18 <= c.cycle_length <= 60]

def calculate_health_score(cycles: List[Any]) -> int:
    """Calculate comprehensive health score (0-100) based on multiple factors."""
    if not cycles:
        return 50
    
    score = 0
    
    # Calculate cycle lengths from start dates if not stored
    calculated_lengths = []
    sorted_cycles = sorted(cycles, key=lambda c: c.start_date)
    
    for i, cycle in enumerate(sorted_cycles):
        if i > 0:
            prev_cycle = sorted_cycles[i-1]
            days_diff = (cycle.start_date - prev_cycle.start_date).days
            if 18 <= days_diff <= 60:  # Valid cycle length range
                calculated_lengths.append(days_diff)
    
    # Also use any stored cycle lengths
    stored_lengths = [c.cycle_length for c in cycles if c.cycle_length and 18 <= c.cycle_length <= 60]
    
    # Use calculated lengths if available, otherwise stored lengths
    lengths = calculated_lengths if calculated_lengths else stored_lengths
    
    if not lengths:
        return 50
    
    # 1. Cycle Regularity (35 points) - Most important factor
    std = np.std(lengths) if len(lengths) > 1 else 0
    if std <= 1:
        score += 35  # Very regular
    elif std <= 2:
        score += 28  # Regular
    elif std <= 4:
        score += 20  # Somewhat regular
    elif std <= 7:
        score += 10  # Irregular
    else:
        score += 3   # Very irregular
    
    # 2. Cycle Length Health (25 points)
    avg_length = np.mean(lengths)
    if 26 <= avg_length <= 32:
        score += 25  # Optimal range
    elif 24 <= avg_length <= 35:
        score += 20  # Healthy range
    elif 21 <= avg_length <= 38:
        score += 15  # Acceptable range
    elif 18 <= avg_length <= 45:
        score += 8   # Concerning range
    else:
        score += 3   # Unhealthy range
    
    # 3. Pain Management (20 points)
    pain_levels = [c.pain_level for c in cycles if c.pain_level is not None]
    if pain_levels:
        avg_pain = np.mean(pain_levels)
        pain_consistency = np.std(pain_levels) if len(pain_levels) > 1 else 0
        
        # Score based on average pain
        if avg_pain <= 2:
            pain_score = 20
        elif avg_pain <= 4:
            pain_score = 15
        elif avg_pain <= 6:
            pain_score = 10
        elif avg_pain <= 8:
            pain_score = 5
        else:
            pain_score = 2
        
        # Bonus for consistent pain levels (predictable)
        if pain_consistency <= 2:
            pain_score += 2
        
        score += min(20, pain_score)
    else:
        score += 10  # Neutral if no data
    
    # 4. Period Duration Health (10 points)
    durations = [(c.end_date - c.start_date).days for c in cycles if c.end_date and c.start_date]
    if durations:
        avg_duration = np.mean(durations)
        duration_std = np.std(durations) if len(durations) > 1 else 0
        
        if 4 <= avg_duration <= 6:
            duration_score = 10
        elif 3 <= avg_duration <= 7:
            duration_score = 8
        elif 2 <= avg_duration <= 8:
            duration_score = 5
        else:
            duration_score = 2
        
        # Bonus for consistent duration
        if duration_std <= 1:
            duration_score += 1
        
        score += min(10, duration_score)
    else:
        score += 5  # Neutral if no data
    
    # 5. Symptom Pattern Analysis (10 points) - Updated for list structure
    symptom_scores = []
    for cycle in cycles:
        if cycle.symptoms and isinstance(cycle.symptoms, list):
            # Score based on number of symptoms (more symptoms = lower score)
            # This is a simplified approach since we don't have severity data in list format
            num_symptoms = len(cycle.symptoms)
            
            if num_symptoms == 0:
                symptom_score = 10  # No symptoms is good
            elif num_symptoms <= 2:
                symptom_score = 8   # Few symptoms
            elif num_symptoms <= 4:
                symptom_score = 6   # Moderate symptoms
            elif num_symptoms <= 6:
                symptom_score = 4   # Many symptoms
            else:
                symptom_score = 2   # Very many symptoms
            
            symptom_scores.append(symptom_score)
    
    if symptom_scores:
        avg_symptom_score = np.mean(symptom_scores)
        score += int(avg_symptom_score)
    else:
        score += 5  # Neutral if no symptom data
    
    return min(100, max(0, int(score)))

def predict_next_period(cycles: List[Any], default_length: int = 28) -> Dict[str, Any]:
    """Predict next period using robust statistical analysis with probabilistic messaging."""
    if not cycles:
        return {"error": "No cycle data available"}
    
    # Calculate cycle lengths from start dates if not stored
    calculated_lengths = []
    sorted_cycles = sorted(cycles, key=lambda c: c.start_date)
    
    for i, cycle in enumerate(sorted_cycles):
        if i > 0:
            prev_cycle = sorted_cycles[i-1]
            days_diff = (cycle.start_date - prev_cycle.start_date).days
            if 18 <= days_diff <= 60:  # Valid cycle length range
                calculated_lengths.append(days_diff)
    
    # Also use any stored cycle lengths
    stored_lengths = [c.cycle_length for c in cycles if c.cycle_length and 18 <= c.cycle_length <= 60]
    
    # Use calculated lengths if available, otherwise stored lengths
    all_lengths = calculated_lengths if calculated_lengths else stored_lengths
    
    if not all_lengths:
        return {
            "error": "Insufficient cycle data",
            "message": "We need at least 2 completed cycles to make predictions. Continue tracking to build your pattern.",
            "data_quality": "insufficient"
        }
    
    # Clean data by removing outliers
    cleaned_lengths = remove_outliers(all_lengths) if len(all_lengths) >= 4 else all_lengths
    
    # Calculate statistics
    avg_cycle = weighted_average(cleaned_lengths)
    std = np.std(cleaned_lengths) if len(cleaned_lengths) > 1 else 0
    median_cycle = np.median(cleaned_lengths)
    
    # Get last period start date
    last_cycle = max(cycles, key=lambda c: c.start_date)
    last_start = last_cycle.start_date
    
    # Calculate predictions with confidence intervals
    next_period_mean = last_start + timedelta(days=round(avg_cycle))
    next_period_early = last_start + timedelta(days=max(21, round(avg_cycle - std)))
    next_period_late = last_start + timedelta(days=min(45, round(avg_cycle + std)))
    
    # Ovulation prediction (typically 14 days before next period)
    ovulation_mean = next_period_mean - timedelta(days=14)
    ovulation_early = next_period_early - timedelta(days=14)
    ovulation_late = next_period_late - timedelta(days=14)
    
    # Fertile window (5 days before ovulation to 1 day after)
    fertile_start_mean = ovulation_mean - timedelta(days=5)
    fertile_end_mean = ovulation_mean + timedelta(days=1)
    fertile_start_early = ovulation_early - timedelta(days=5)
    fertile_end_late = ovulation_late + timedelta(days=1)
    
    # Calculate confidence levels
    data_points = len(cleaned_lengths)
    if std <= 2 and data_points >= 6:
        confidence = "high"
        confidence_percentage = 85
        confidence_days = 3
    elif std <= 4 and data_points >= 4:
        confidence = "medium"
        confidence_percentage = 70
        confidence_days = 5
    else:
        confidence = "low"
        confidence_percentage = 50
        confidence_days = 7
    
    # Data quality assessment
    if data_points >= 12:
        data_quality = "excellent"
    elif data_points >= 6:
        data_quality = "good"
    elif data_points >= 3:
        data_quality = "fair"
    else:
        data_quality = "limited"
    
    return {
        "predicted_next_period": next_period_mean.isoformat(),
        "prediction_range": {
            "earliest": next_period_early.isoformat(),
            "latest": next_period_late.isoformat(),
            "most_likely": next_period_mean.isoformat()
        },
        "ovulation_date": ovulation_mean.isoformat(),
        "ovulation_range": {
            "earliest": ovulation_early.isoformat(),
            "latest": ovulation_late.isoformat(),
            "most_likely": ovulation_mean.isoformat()
        },
        "fertile_window": {
            "start": fertile_start_mean.isoformat(),
            "end": fertile_end_mean.isoformat(),
            "full_range": {
                "start": fertile_start_early.isoformat(),
                "end": fertile_end_late.isoformat()
            }
        },
        "statistics": {
            "average_cycle_length": round(avg_cycle, 1),
            "median_cycle_length": round(median_cycle, 1),
            "cycle_std_deviation": round(std, 2),
            "data_points": data_points,
            "data_quality": data_quality
        },
        "confidence": {
            "level": confidence,
            "percentage": confidence_percentage,
            "range_days": confidence_days,
            "message": get_confidence_message(confidence, std, data_points)
        },
        "probabilistic_info": {
            "disclaimer": "These predictions are based on statistical patterns and are not guaranteed. Individual cycles vary naturally.",
            "accuracy_note": f"Based on your {data_points} tracked cycles, there's a {confidence_percentage}% chance your next period will arrive within the predicted range.",
            "natural_variation": f"Normal cycle variation is ±{round(std, 1)} days from your average."
        }
    }

def get_confidence_message(confidence: str, std: float, data_points: int) -> str:
    """Generate appropriate confidence message."""
    if confidence == "high":
        return f"High confidence: Your cycles are quite regular (±{round(std, 1)} days) based on {data_points} tracked cycles."
    elif confidence == "medium":
        return f"Medium confidence: Your cycles show moderate variation (±{round(std, 1)} days) with {data_points} data points."
    else:
        return f"Low confidence: Limited data or high variation (±{round(std, 1)} days). Track more cycles for better predictions."

def get_cycle_summary(cycles: List[Any]) -> Dict[str, Any]:
    """Get comprehensive cycle statistics with health score breakdown."""
    if not cycles:
        return {}
    
    lengths = cycle_lengths(cycles)
    
    # Calculate detailed health score components
    health_score = calculate_health_score(cycles)
    
    # Get individual components for detailed analysis
    score_breakdown = get_health_score_breakdown(cycles)
    
    return {
        "total_cycles": len(cycles),
        "avg_cycle_length": round(np.mean(lengths), 1) if lengths else None,
        "std_deviation": round(np.std(lengths), 2) if len(lengths) > 1 else 0,
        "min_cycle": min(lengths) if lengths else None,
        "max_cycle": max(lengths) if lengths else None,
        "health_score": health_score,
        "health_breakdown": score_breakdown,
        "health_grade": get_health_grade(health_score),
        "trend": analyze_health_trend(cycles),
    }

def get_health_score_breakdown(cycles: List[Any]) -> Dict[str, int]:
    """Get detailed breakdown of health score components."""
    if not cycles:
        return {}
    
    breakdown = {
        "regularity_score": 0,
        "length_score": 0,
        "pain_score": 0,
        "duration_score": 0,
        "symptom_score": 0,
    }
    
    # Calculate cycle lengths from start dates if not stored
    calculated_lengths = []
    sorted_cycles = sorted(cycles, key=lambda c: c.start_date)
    
    for i, cycle in enumerate(sorted_cycles):
        if i > 0:
            prev_cycle = sorted_cycles[i-1]
            days_diff = (cycle.start_date - prev_cycle.start_date).days
            if 18 <= days_diff <= 60:  # Valid cycle length range
                calculated_lengths.append(days_diff)
    
    # Also use any stored cycle lengths
    stored_lengths = [c.cycle_length for c in cycles if c.cycle_length and 18 <= c.cycle_length <= 60]
    
    # Use calculated lengths if available, otherwise stored lengths
    lengths = calculated_lengths if calculated_lengths else stored_lengths
    
    # Regularity breakdown
    if lengths:
        std = np.std(lengths) if len(lengths) > 1 else 0
        if std <= 1:
            breakdown["regularity_score"] = 35
        elif std <= 2:
            breakdown["regularity_score"] = 28
        elif std <= 4:
            breakdown["regularity_score"] = 20
        elif std <= 7:
            breakdown["regularity_score"] = 10
        else:
            breakdown["regularity_score"] = 3
    
    # Length breakdown
    if lengths:
        avg_length = np.mean(lengths)
        if 26 <= avg_length <= 32:
            breakdown["length_score"] = 25
        elif 24 <= avg_length <= 35:
            breakdown["length_score"] = 20
        elif 21 <= avg_length <= 38:
            breakdown["length_score"] = 15
        elif 18 <= avg_length <= 45:
            breakdown["length_score"] = 8
        else:
            breakdown["length_score"] = 3
    
    # Pain breakdown
    pain_levels = [c.pain_level for c in cycles if c.pain_level is not None]
    if pain_levels:
        avg_pain = np.mean(pain_levels)
        pain_consistency = np.std(pain_levels) if len(pain_levels) > 1 else 0
        
        if avg_pain <= 2:
            breakdown["pain_score"] = 20
        elif avg_pain <= 4:
            breakdown["pain_score"] = 15
        elif avg_pain <= 6:
            breakdown["pain_score"] = 10
        elif avg_pain <= 8:
            breakdown["pain_score"] = 5
        else:
            breakdown["pain_score"] = 2
        
        if pain_consistency <= 2:
            breakdown["pain_score"] = min(20, breakdown["pain_score"] + 2)
    
    # Duration breakdown
    durations = [(c.end_date - c.start_date).days for c in cycles if c.end_date and c.start_date]
    if durations:
        avg_duration = np.mean(durations)
        duration_std = np.std(durations) if len(durations) > 1 else 0
        
        if 4 <= avg_duration <= 6:
            breakdown["duration_score"] = 10
        elif 3 <= avg_duration <= 7:
            breakdown["duration_score"] = 8
        elif 2 <= avg_duration <= 8:
            breakdown["duration_score"] = 5
        else:
            breakdown["duration_score"] = 2
        
        if duration_std <= 1:
            breakdown["duration_score"] = min(10, breakdown["duration_score"] + 1)
    
    # Symptom breakdown - Updated for list structure
    symptom_scores = []
    for cycle in cycles:
        if cycle.symptoms and isinstance(cycle.symptoms, list):
            num_symptoms = len(cycle.symptoms)
            
            if num_symptoms == 0:
                symptom_score = 10  # No symptoms is good
            elif num_symptoms <= 2:
                symptom_score = 8   # Few symptoms
            elif num_symptoms <= 4:
                symptom_score = 6   # Moderate symptoms
            elif num_symptoms <= 6:
                symptom_score = 4   # Many symptoms
            else:
                symptom_score = 2   # Very many symptoms
            
            symptom_scores.append(symptom_score)
    
    if symptom_scores:
        breakdown["symptom_score"] = int(np.mean(symptom_scores))
    
    return breakdown

def get_health_grade(score: int) -> str:
    """Convert health score to grade."""
    if score >= 90:
        return "Excellent"
    elif score >= 80:
        return "Very Good"
    elif score >= 70:
        return "Good"
    elif score >= 60:
        return "Fair"
    elif score >= 50:
        return "Poor"
    else:
        return "Very Poor"

def analyze_health_trend(cycles: List[Any]) -> str:
    """Analyze health trend over recent cycles."""
    if len(cycles) < 3:
        return "insufficient_data"
    
    # Get health scores for last 3 cycles
    recent_scores = []
    for cycle in cycles[-3:]:
        score = calculate_health_score([cycle])
        recent_scores.append(score)
    
    if len(recent_scores) < 2:
        return "stable"
    
    # Simple trend analysis
    if recent_scores[-1] > recent_scores[0] + 5:
        return "improving"
    elif recent_scores[-1] < recent_scores[0] - 5:
        return "declining"
    else:
        return "stable"
