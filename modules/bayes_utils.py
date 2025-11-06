from typing import Literal

import pandas as pd
import pickle
import numpy as np

from pgmpy.inference import VariableElimination
from pgmpy.factors.discrete import TabularCPD

def load_bayesian_model(model_path: str) -> VariableElimination:
    """Load the Bayesian network model from a pickle file."""
    with open(model_path, "rb") as file:
        model = pickle.load(file)
    return model

def get_categories_from_file(categories_path: str) -> pd.DataFrame:
    """Load categorical columns categories from a pickle file."""
    with open(categories_path, "rb") as file:
        categories_df = pickle.load(file)
    return categories_df
    
def convert_numeric_to_interval(input_df: pd.Series, categories_df: pd.DataFrame) -> pd.Series:
    """
    Convert numeric columns in the input Series to interval-based categorical columns.

    Args:
        input_df (pd.Series): Series containing the flat's features.
        categories_df (pd.Series): Series containing categories for each categorical column.
        
    Returns:
        pd.Series: Updated Series with numeric columns converted to categorical.
    """
    numeric_columns = ['remaining_lease_years', 'floor_area_sqm']
    for col in numeric_columns:
        if col in input_df.keys() and col in categories_df.columns:
            categories : list[pd.Interval] = categories_df[col].dropna().tolist()
            for c in categories:
                if c.left <= input_df[col] and input_df[col] <= c.right:
                    input_df[col] = c
                    break
            else:
                raise ValueError(f"Value {input_df[col]} for column {col} does not fit in any known category intervals.")
    return input_df


def get_lease_cats(lease_category: pd.Series, setpoint: pd.Interval, 
                   comparison: Literal['gte', 'lte'] = 'gte') -> list[pd.Interval]:
    cats = []
    categories : list[pd.Interval] = lease_category.dropna().tolist()
    for c in categories:
        if comparison == 'gte' and c.right > setpoint.mid:
            cats.append(c)
        elif comparison == 'lte' and c.left < setpoint.mid:
            cats.append(c)

    return cats
