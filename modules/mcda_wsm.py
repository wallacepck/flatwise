import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple

def normalize_column(series: pd.Series, direction: str) -> pd.Series:
    """
    Normalize a column using min-max scaling.
    direction: 'benefit' means higher = better, 'cost' means lower = better
    Returns normalized values in [0,1]
    """
    series = series.astype(float)
    valid_mask = series.notna()
    min_val = series[valid_mask].min()
    max_val = series[valid_mask].max()
    if min_val == max_val:
        # Avoid division by zero; assign all as 1 if possible
        return pd.Series(np.where(valid_mask, 1.0, np.nan), index=series.index)
    if direction == 'benefit':
        # Higher is better
        norm = (series - min_val) / (max_val - min_val)
    elif direction == 'cost':
        # Lower is better
        norm = (max_val - series) / (max_val - min_val)
    else:
        raise ValueError(f"Invalid direction '{direction}' for normalization")
    norm[~valid_mask] = np.nan  # Preserve NaNs
    return norm

def mcda_wsm(
    df: pd.DataFrame,
    criteria: Dict[str, Dict],
    weights: Optional[Dict[str, float]] = None,
    rank_col: str = "score"
) -> pd.DataFrame:
    """
    Perform Weighted Sum Model ranking (MCDA) on filtered flats.
    criteria: dict mapping column name to {'direction': 'benefit'/'cost', 'label': <str>}
              e.g., {"resale_price": {"direction": "cost", ...}, "floor_area_sqm": {"direction": "benefit", ...}}
    weights: dict mapping column to float (should sum to 1; if None, equal weights used)
    Returns: ranked DataFrame with normalized criteria columns and final score
    """
    df = df.copy()  # don't mutate original
    criteria_cols = list(criteria.keys())
    
    # Validate weights
    if weights is None:
        weights = {col: 1 / len(criteria_cols) for col in criteria_cols}
    else:
        # Ensure all criteria have weights; fill missing as 0
        weights = {col: weights.get(col, 0.0) for col in criteria_cols}
        # Normalize to sum == 1
        total = sum(weights.values())
        if total == 0:
            raise ValueError("All weights for MCDA are zero!")
        weights = {col: w / total for col, w in weights.items()}

    # Normalize each criterion
    norm_cols = []
    for col in criteria_cols:
        direction = criteria[col]['direction']
        norm_col = col + "_norm"
        df[norm_col] = normalize_column(df[col], direction)
        norm_cols.append(norm_col)

    # Compute weighted sum score
    df[rank_col] = 0.0
    for col in criteria_cols:
        norm_col = col + "_norm"
        weight = weights[col]
        df[rank_col] += df[norm_col].fillna(0) * weight

    # Rescale to 0–10
    df[rank_col] = (df[rank_col] * 10).round(2)

    # Sort descending by score
    df = df.sort_values(rank_col, ascending=False)
    df['rank'] = np.arange(1, len(df)+1)
    df = df.reset_index()

    
    # For transparency, bundle weights/labels for each criterion
    meta = {
        "criteria": criteria,
        "weights": weights,
        "norm_cols": norm_cols,
        "rank_col": rank_col
    }
    return df, meta

def get_mcda_insight(row: pd.Series, criteria: Dict[str, Dict], weights: Dict[str, float]) -> str:
    """
    Generate a human-readable market insight for a flat based on scores/features.
    """
    lines = []
    for col, spec in criteria.items():
        val = row[col]
        norm = row[col + "_norm"]
        label = spec.get("label", col)
        weight_percent = f"{weights[col]*100:.0f}%"
        direction = spec['direction']
        desc = f"{label}: {val} ({'high' if norm > 0.7 else 'low' if norm < 0.3 else 'average'}) – Weight: {weight_percent} ({direction})"
        lines.append(desc)
    score = row.get("score", 0)# In your result/output/HTML:

    summary = f"Overall Score: {score:.2f} | {', '.join(lines)}"
    return summary
