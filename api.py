from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import json
import pandas as pd
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from enum import Enum
import os # For environment variables

# Import your custom modules
from modules.csp_filter import csp_filter_flats
from modules.mcda_wsm import mcda_wsm
from modules.insight_generator import InsightGenerator
from modules.bayes_utils import load_bayesian_model, get_categories_from_file

# ---------------------------
# 1. Pydantic Models for Validation
# ---------------------------

class ConstraintModel(BaseModel):
    # Use Optional for fields that might not be sent
    max_price: Optional[int] = Field(default=None, ge=0)
    min_remaining_lease: Optional[int] = Field(default=None, ge=0)
    max_mrt_distance: Optional[float] = Field(default=None, ge=0)
    towns: Optional[List[str]] = None
    flat_types: Optional[List[str]] = None
    storey_ranges: Optional[List[str]] = None
    flat_models: Optional[List[str]] = None
class PriorityEnum(str, Enum):
    price = "Price"
    floor_area = "Floor Area"
    lease = "Lease"
    mrt = "Nearest MRT"
    none = "None - treat equally"

class RecommendRequest(BaseModel):
    constraints: ConstraintModel
    priority: PriorityEnum = PriorityEnum.none
    page: int = 1

# ---------------------------
# 2. Application Setup
# ---------------------------
app = FastAPI(
    title="FlatWise API",
    description="API for HDB resale flat recommendations and insights."
)

# ---------------------------
# 3. Secure Configuration
# ---------------------------
# Pull allowed origins from an environment variable (e.g., "http://localhost:3000,https://your-prod-domain.com")
# Fallback to "*" for simple development
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS, # Use the configured list
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --------------------------------



# ---------------------------
# 4. Graceful Startup & State Management
# ---------------------------
@app.on_event("startup")
def load_global_state():
    """
    Load all large models and data on startup.
    This fails fast if a file is missing and avoids
    reloading on every request.
    """
    try:
        app.state.df = pd.read_csv("ResaleFlatPricesData_processed.csv")
        
        app.state.insight_generator = InsightGenerator(
            load_bayesian_model("BayesianNetwork.pkl"),
            get_categories_from_file("CategoricalColumnsCategories.pkl")
        )
        
        with open("config/mcda_criteria.json") as f:
            app.state.mcda_criteria = json.load(f)
            
        print("--- Global state loaded successfully. ---")
            
    except FileNotFoundError as e:
        print(f"FATAL ERROR: Missing required file: {e.fileName}")
        # In a real app, you might want to exit or log this to a service
        # For now, we'll let the app start, but endpoints will fail
        app.state.df = None
        # ... other states
    except Exception as e:
        print(f"FATAL ERROR: Failed to load models: {e}")
        app.state.df = None
        # ... other states

# ---------------------------
# Helper
# ---------------------------
def get_weights(priority: PriorityEnum, criteria: dict) -> dict:
    # Use the enum for robust checking
    if priority == PriorityEnum.price:
        # Note: Added dist_mrt_km to all priorities
        return {"resale_price": 0.5, "floor_area_sqm": 0.2, "remaining_lease_years": 0.2, "dist_mrt_km": 0.1}
    elif priority == PriorityEnum.floor_area:
        return {"resale_price": 0.2, "floor_area_sqm": 0.5, "remaining_lease_years": 0.2, "dist_mrt_km": 0.1}
    elif priority == PriorityEnum.lease:
        return {"resale_price": 0.2, "floor_area_sqm": 0.2, "remaining_lease_years": 0.5, "dist_mrt_km": 0.1}
    elif priority.value == PriorityEnum.mrt: # Use .value for Enum comparison here
        return {"resale_price": 0.2, "floor_area_sqm": 0.2, "remaining_lease_years": 0.1, "dist_mrt_km": 0.5}
    else:
        # Equal weights if no priority
        return {key: 1/len(criteria) for key in criteria.keys()}

# ---------------------------
# Routes
# ---------------------------
# ---------------------------
# Routes
# ---------------------------
@app.get("/")
def read_root():
    return {"status": "FlatWise API is running."}


@app.post("/recommend")
async def recommend(request_data: RecommendRequest, request: Request):
    """
    Main recommendation endpoint.
    Uses Pydantic model 'RecommendRequest' for automatic validation.
    """
    
    if not hasattr(app.state, 'df') or app.state.df is None:
        raise HTTPException(
            status_code=503,
            detail="Server is not ready, required data files could not be loaded."
        )

    try:
        df = request.app.state.df
        criteria = request.app.state.mcda_criteria
        insight_generator = request.app.state.insight_generator
        
        # 1. Get validated data
        constraints = request_data.constraints.dict(exclude_unset=True)
        priority = request_data.priority
        page = request_data.page

        # 2. Apply constraints
        filtered_df, _ = csp_filter_flats(df, constraints)    
        if filtered_df.empty:
            return JSONResponse(content={"recommendations": [], "total_found": 0})

        # --- FIX START: Order of operations ---
        
        # 3. Create a clean copy *before* MCDA
        clean_df_for_insights = filtered_df.copy()
        
        # 4. Apply MCDA to get scores and rankings
        weights = get_weights(priority, criteria)
        ranked_df, _ = mcda_wsm(filtered_df, criteria, weights) 

        # 5. Get total number of results *before* slicing
        total_found = len(ranked_df)

        # 6. Calculate page slice
        start_index = (page - 1) * 10
        end_index = page * 10
        
        # 7. Get the Top 10 rows for the *current page*
        page_ranked_rows = ranked_df.iloc[start_index:end_index]
        if page_ranked_rows.empty:
             return JSONResponse(content={"recommendations": [], "total_found": total_found})

        # 8. Get the *original* indices from the "index" column
        page_original_indices = page_ranked_rows['index']
        
        # 9. Use these *original* indices to pull the clean data
        page_df = clean_df_for_insights.loc[page_original_indices].copy()
        
        # 10. Manually add the 'score' column
        page_df['score'] = page_ranked_rows['score'].values
        
        # --- FIX END ---

        # 11. Generate insights (FAST: runs only 10 times)
        page_df["insight_summary"] = [
            insight_generator.get_insights_on_row(row)
            for _, row in page_df.iterrows()
        ]

        # 12. Return the final data
        top = page_df.to_dict(orient="records")
        # Return the 10 results AND the total number found
        return {"recommendations": top, "total_found": total_found}

    except Exception as e:
        print(f"Error during recommendation: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"An internal server error occurred: {str(e)}"
        )

@app.get("/health")
async def health_check():
    # A more robust health check would ping databases, etc.
    return {"status": "ok"}