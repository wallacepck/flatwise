from typing import Any

import math
import pandas as pd
import random

from pgmpy.inference import VariableElimination
from pgmpy.factors.discrete import DiscreteFactor

from modules.bayes_utils import get_lease_cats, convert_numeric_to_interval

# Cutoff probability whereby event becomes statistically insignificant
STATISTICAL_CUTOFF = 0.05

class InsufficentDataError(Exception):
    pass

class InsightGenerator:
    def __init__(self, model: VariableElimination, categories: pd.DataFrame):
        self.model = model
        self.categories = categories

    def query_top_k_var(self, evidence: dict, top_k=3, variable='resale_price') -> list[tuple[float, Any]]:
        """
        Query the top K most probable value of variable from the Bayesian network query result.

        Args:
            query: The result of the Bayesian network query.
            top_k (int): Number of top probable value to return.
        """
        # Perform inference
        query: DiscreteFactor = self.model.query(variables=[variable], evidence=evidence)

        topk_indexes = query.values.argsort()[-top_k:]
        topk_probs = [query.values[i] for i in reversed(topk_indexes)]
        topk_values : list[pd.Interval] = [query.state_names[variable][i] for i in reversed(topk_indexes)]

        return list(zip(topk_probs, topk_values))

    def get_insights_on_row(self, row: pd.Series) -> str:
        row = convert_numeric_to_interval(row, self.categories)

        evidence = {
            'town': row['town'],
            'flat_model': row['flat_model'],
            'flat_type': row['flat_type'],
            'remaining_lease_years': row['remaining_lease_years'],
            'floor_area_sqm': row['floor_area_sqm'],
            'resale_price': row['resale_price']
        }

        insights = [
            self.insight_over_gte_lease, 
            self.insight_price_due_lease_depreciation,
            self.insight_floor_area
        ]
        random.shuffle(insights)
        for insight in insights:
            try:
                return insight(evidence)
            except InsufficentDataError:
                continue
        return "No insights for this flat."

        
    def insight_over_gte_lease(self, evidence: dict) -> str:
        baseline_lease = evidence['remaining_lease_years']
        baseline_price = evidence['resale_price'].mid
        sample_evidence = {
            'town': evidence['town'],
            'flat_model': evidence['flat_model'],
            'flat_type': evidence['flat_type'],
            'remaining_lease_years': evidence['remaining_lease_years'],
        }

        max_confidence = 0
        for lease in get_lease_cats(self.categories['remaining_lease_years'], baseline_lease, 'gte'):
            evidence['remaining_lease_years'] = lease
            sample_flat = self.query_top_k_var(sample_evidence, top_k=1)
            if sample_flat[0][0] < STATISTICAL_CUTOFF:
                continue
            if sample_flat[0][1].mid < baseline_price and sample_flat[0][0] > max_confidence:
                max_confidence = sample_flat[0][0]

        evidence['remaining_lease_years'] = baseline_lease
        evidence['resale_price'] = baseline_price
        given_data = f" among {evidence['flat_type']} flats in {evidence['town']} with >{int(evidence['remaining_lease_years'].left)} years lease"
        if max_confidence > 0.3:
            # yikes
            return "Not competitive value" + given_data
        elif max_confidence >= STATISTICAL_CUTOFF:
            return "Competitive value" + given_data
        else:
            return "Best value" + given_data
            
    def insight_price_due_lease_depreciation(self, evidence: dict):
        sample_evidence = {
            'town': evidence['town'],
            'flat_model': evidence['flat_model'],
            'flat_type': evidence['flat_type'],
            'remaining_lease_years': evidence['remaining_lease_years'],
        }
        topk_prob_prices = self.query_top_k_var(sample_evidence, top_k=0)
        base_volatility = math.sqrt(sum([prob * ((price.mid) ** 2) for prob, price in topk_prob_prices]) - \
                    (sum([prob * price.mid for prob, price in topk_prob_prices]) ** 2))

        depreciated_years = get_lease_cats(self.categories['remaining_lease_years'], evidence['remaining_lease_years'], 'lte')

        max_volatility = base_volatility
        years_to_dep = 0
        for year in depreciated_years:
            if (evidence['remaining_lease_years'].mid - year.mid) > 20:
                # Too Uncertain
                continue

            sample_evidence = {
                'town': evidence['town'],
                'flat_model': evidence['flat_model'],
                'flat_type': evidence['flat_type'],
                'remaining_lease_years': year,
            }
            topk_prob_prices = self.query_top_k_var(sample_evidence, top_k=0)

            if topk_prob_prices[0][0] < STATISTICAL_CUTOFF:
                continue

            sample_volatility = math.sqrt(sum([prob * ((price.mid) ** 2) for prob, price in topk_prob_prices]) - \
                        (sum([prob * price.mid for prob, price in topk_prob_prices]) ** 2))
            if sample_volatility > max_volatility:
                max_volatility = sample_volatility
                years_to_dep = evidence['remaining_lease_years'].mid - year.mid
        
        if max_volatility > base_volatility:
            delta = max_volatility - base_volatility
            if delta > 50_000:
                # yikes
                return f"Large impact on resale potential due to lease decay - High change in volatility (+{int(delta)}) in ~{int(years_to_dep)} years"
            else:
                return "Minimal impact on resale potential due to lease decay for next 20 years"
        else:
            return "No impact on resale potential due to lease decay for next 20 years"


    def insight_floor_area(self, evidence: dict):
        sample_evidence = {
            'town': evidence['town'],
            'flat_model': evidence['flat_model'],
            'flat_type': evidence['flat_type'],
            'remaining_lease_years': evidence['remaining_lease_years'],
            'resale_price': evidence['resale_price']
        }
        topk_prob_sqm = self.query_top_k_var(sample_evidence, top_k=3, variable='floor_area_sqm')

        avg_sqm = topk_prob_sqm[0][1]
        if topk_prob_sqm[0][0] < STATISTICAL_CUTOFF:
            raise InsufficentDataError()
        for prob, sqm in topk_prob_sqm:
            if prob < STATISTICAL_CUTOFF:
                continue
            
            if evidence['floor_area_sqm'].mid >= sqm.left and evidence['floor_area_sqm'].mid < sqm.right:
                return f"Average floor area (~{int(avg_sqm.mid)} sqm) in this price range"
        
        if avg_sqm.right > evidence['floor_area_sqm'].mid:
            return f"Lower than average floor area ({int(avg_sqm.mid)} sqm) in this price range"
        else:
            return f"Higher than average floor area ({int(avg_sqm.mid)} sqm) in this price range"