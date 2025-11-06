import pandas as pd

from pgmpy.inference import VariableElimination
from pgmpy.factors.discrete import DiscreteFactor

from modules.bayes_utils import get_lease_cats, convert_numeric_to_interval

# Cutoff probability whereby event becomes statistically insignificant
STATISTICAL_CUTOFF = 0.05

class InsightGenerator:
    def __init__(self, model: VariableElimination, categories: pd.DataFrame):
        self.model = model
        self.categories = categories

    def query_top_k_prices(self, evidence: dict, top_k=3) -> list[tuple[float, pd.Interval]]:
        """
        Query the top K most probable resale prices from the Bayesian network query result.

        Args:
            query: The result of the Bayesian network query.
            top_k (int): Number of top probable prices to return.
        """
        # Perform inference
        query: DiscreteFactor = self.model.query(variables=['resale_price'], evidence=evidence)

        topk_indexes = query.values.argsort()[-top_k:]
        topk_probs = [query.values[i] for i in reversed(topk_indexes)]
        topk_prices : list[pd.Interval] = [query.state_names['resale_price'][i] for i in reversed(topk_indexes)]

        return list(zip(topk_probs, topk_prices))

    def get_insights_on_row(self, row: pd.Series) -> str:
        row = convert_numeric_to_interval(row, self.categories)

        evidence = {
            'town': row['town'],
            'flat_type': row['flat_type'],
            'remaining_lease_years': row['remaining_lease_years'],
            'resale_price': row['resale_price']
        }

        return self.insight_over_gte_lease(evidence)
            
        
    def insight_over_gte_lease(self, evidence: dict) -> str:
        baseline_lease = evidence['remaining_lease_years']
        baseline_price = evidence['resale_price']
        sample_evidence = {
            'town': evidence['town'],
            'flat_type': evidence['flat_type'],
            'remaining_lease_years': evidence['remaining_lease_years'],
        }

        max_confidence = 0
        for lease in get_lease_cats(self.categories['remaining_lease_years'], baseline_lease, 'gte'):
            evidence['remaining_lease_years'] = lease
            sample_flat = self.query_top_k_prices(sample_evidence, top_k=1)
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
        # TODO:
        pass

    def insight_lease_length(self, evidence: dict):
        # TODO:
        pass

    def insight_over_buyback(self, evidence: dict):
        # TODO:
        if evidence['remaining_lease_years'] > 50:
            return ""
        elif evidence['remaining_lease_years'] > 30:
            return ""
        else:
            return ""

    def insight_rare_listing(self, evidence: dict):
        # TODO:
        pass