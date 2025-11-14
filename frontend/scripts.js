// --- App State ---
let currentRecommendations = []; // Holds ALL flats shown so far
let currentPage = 1;
let totalFound = 0;
let isLoadingMore = false;
let currentConstraints = {};
let currentPriority = "";
// --- App State ---

// --- Lookups (Unchanged) ---
const REGION_LOOKUP = {
    "North": ["Woodlands", "Yishun", "Sembawang"],
    "North-East": ["Sengkang", "Punggol", "Hougang", "Serangoon", "Ang Mo Kio"],
    "East": ["Tampines", "Bedok", "Pasir Ris"],
    "West": ["Jurong West", "Jurong East", "Bukit Batok", "Bukit Panjang", "Choa Chu Kang", "Clementi"],
    "Central": ["Bishan", "Toa Payoh", "Kallang/Whampoa", "Bukit Merah", "Queenstown", "Geylang", "Marine Parade", "Central Area", "Bukit Timah"]
};
const STOREY_LOOKUP = {
    "Low": ["01 TO 03", "04 TO 06"],
    "Medium": ["07 TO 09", "10 TO 12", "13 TO 15", "16 TO 18"],
    "High": ["19 TO 21", "22 TO 24", "25 TO 27", "28 TO 30", "31 TO 33", "34 TO 36", "37 TO 39", "40 TO 42", "43 TO 45", "46 TO 48", "49 TO 51"]
};
const FLAT_MODEL_LOOKUP = {
    "Standard/Mainstream": ["Model A", "Improved", "New Generation", "Simplified", "Apartment", "Standard", "Model A2", "Type S1", "Type S2"],
    "Premium & DBSS": ["Premium Apartment", "DBSS", "Premium Apartment Loft", "Premium Maisonette"],
    "Maisonette/Multi-gen/Adj.": ["Maisonette", "Model A-Maisonette", "Improved-Maisonette", "Adjoined flat", "Multi Generation", "3Gen"],
    "Special": ["Terrace", "2-room"]
};

// --- NEW: Security Utility ---
/**
 * A simple, fast HTML escaper to prevent XSS.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[match]);
};

// --- NEW: Robust Parsing Utility ---
/**
 * Safely parses the first number from a storey range string.
 * @param {string} storeyRange (e.g., "10 TO 12", "01 TO 03", "16")
 * @returns {number} The parsed floor number, or 0 if invalid.
 */
const parseStorey = (storeyRange) => {
    if (!storeyRange) return 0;
    const match = storeyRange.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

// NEW: Helper function to calculate walking time
// Based on 5 km/h (or 12 minutes per km)
function calculateWalkTime(distanceInKm) {
    if (distanceInKm === null || isNaN(distanceInKm)) {
        return null;
    }
    // (distanceInKm / 5 km/h) * 60 min/h = distanceInKm * 12
    const timeInMinutes = distanceInKm * 12;
    
    // Round to the nearest minute
    const minutes = Math.round(timeInMinutes);

    // Handle 0-minute walks (e.g., 84m is 1.008 min, rounds to 1)
    if (minutes < 1) {
        return "~1 min walk";
    }
    return `~${minutes} min walk`;
}

const MRT_DISTANCE_STEPS = [
    // Step 0
    { value: 0.5, label: "Very Close (within 500m)", walk: "~5-7 min walk" },
    // Step 1
    { value: 1.0, label: "Walkable (within 1km)", walk: "~10-12 min walk" },
    // Step 2
    { value: 1.5, label: "Long Walk (within 1.5km)", walk: "~15-18 min walk" },
    // Step 3
    { value: 2.0, label: "Accessible (within 2km)", walk: "~20-25 min walk" },
    // Step 4
    { value: null, label: "Any Distance", walk: "No MRT filter" }
];

function updateMrtLabel() {
    const slider = document.getElementById('max-mrt-dist-slider');
    const output = document.getElementById('mrt-distance-output');
    
    if (slider && output) {
        const stepIndex = parseInt(slider.value);
        const step = MRT_DISTANCE_STEPS[stepIndex];
        output.textContent = `${step.label} · ${step.walk}`;
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Main functionality
    document.getElementById('find-btn')?.addEventListener('click', fetchRecommendations);
    
    // REFACTORED: The sort function now calls the renderer, passing the global state.
    document.getElementById('sort')?.addEventListener('change', () => {
        // We pass the *global* list to be sorted and rendered
        sortAndRenderResults(currentRecommendations);
    });
    
    document.getElementById('start-search-btn')?.addEventListener('click', () => {
        document.getElementById('search-section')?.scrollIntoView({ behavior: 'smooth' });
    });
    const mrtSlider = document.getElementById('max-mrt-dist-slider');
    if (mrtSlider) {
        mrtSlider.addEventListener('input', updateMrtLabel);
    }
    // Set the initial label text when the page loads
    updateMrtLabel(); 
    // ---------------------------------------------

    // Setup Dropdowns
    populateTownDropdown();

    // Setup Dropdowns
    populateTownDropdown(); setupTownDropdownListeners(); updateTownDisplay();
    populateStoreyDropdown(); setupStoreyDropdownListeners(); updateStoreyDisplay();
    populateFlatModelDropdown(); setupFlatModelDropdownListeners(); updateFlatModelDisplay();

    // Initial results prompt
    document.getElementById('results-container').innerHTML = '<div class="text-center py-10 px-6 bg-gray-50 rounded-lg"><i class="fas fa-search-location fa-2x text-gray-400 mb-3"></i><p class="text-gray-500">Your recommended flats will appear here.</p></div>';
});

// NEW: Helper function to get pill styles based on tier
function getPillStyles(tier) {
    switch (tier) {
        case "Good":
            // Green: #3CBF96
            return "bg-[#3CBF96] text-white border-[#34A853]";
        case "Bad":
            // Red: #f04f52
            return "bg-[#f04f52] text-white border-[#E74639]";
        case "Average":
        default:
            // Yellow: #d5dcdf (using dark text for contrast)
            return "bg-[#d5dcdf] text-[#26332e] border-[#d5dcdf]"; //grey
            
    }
}

// --- Town Dropdown Functions ---

// REFACTORED: Securely builds HTML and uses a single .innerHTML assignment.
function populateTownDropdown() {
    const content = document.getElementById('town-dropdown-content');
    if (!content) return;
    
    // Use map/join to build the string in memory (fast)
    const html = Object.keys(REGION_LOOKUP).map(region => {
        // Escape all data
        const regionId = escapeHTML(region.replace(/\s/g, ''));
        const regionName = escapeHTML(region);

        const townCheckboxes = REGION_LOOKUP[region].map(town => {
            const townId = escapeHTML(town.replace(/\s|\//g, ''));
            const townName = escapeHTML(town);
            return `
                <div class="flex items-center">
                    <input type="checkbox" id="town-${townId}" name="town" value="${townName.toUpperCase()}" class="town-checkbox" data-region="${regionId}">
                    <label for="town-${townId}" class="ml-2 text-sm font-normal text-gray-700 cursor-pointer">${townName}</label>
                </div>
            `;
        }).join('');

        return `
            <div class="mb-4">
                <div class="flex items-center justify-between border-b pb-1 mb-2">
                    <label class="font-semibold text-gray-800">${regionName}</label>
                    <div class="flex items-center cursor-pointer">
                        <input type="checkbox" id="select-all-${regionId}" class="region-select-all" data-region="${regionId}">
                        <label for="select-all-${regionId}" class="text-sm ml-2 cursor-pointer">Select All</label>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                    ${townCheckboxes}
                </div>
            </div>
        `;
    }).join('');

    content.innerHTML = html; // Single DOM write
}

function setupTownDropdownListeners(){const container=document.getElementById('town-dropdown-container'),display=document.getElementById('town-selector-display'),content=document.getElementById('town-dropdown-content');display.addEventListener('click',()=>content.classList.toggle('hidden'));document.addEventListener('click',event=>{if(!container.contains(event.target))content.classList.add('hidden')});content.addEventListener('change',event=>{const target=event.target;if(target.classList.contains('town-checkbox'))updateRegionSelectAllState(target.dataset.region);else if(target.classList.contains('region-select-all'))handleRegionSelectAll(target);updateTownDisplay()})}
function handleRegionSelectAll(selectAllCheckbox){const region=selectAllCheckbox.dataset.region;document.querySelectorAll(`.town-checkbox[data-region="${region}"]`).forEach(checkbox=>checkbox.checked=selectAllCheckbox.checked)}
function updateRegionSelectAllState(region){const regionCheckboxes=document.querySelectorAll(`.town-checkbox[data-region="${region}"]`);document.getElementById(`select-all-${region}`).checked=Array.from(regionCheckboxes).every(cb=>cb.checked)}

// REFACTORED: Uses map/join for efficient and secure pill generation.
function updateTownDisplay() {
    const selected = document.querySelectorAll('.town-checkbox:checked');
    const selectorText = document.getElementById('town-selector-text');
    const previewContainer = document.getElementById('town-preview-pills');

    selectorText.textContent = selected.length === 0 ? 'Select towns...' : `${selected.length} town(s) selected`;
    selectorText.classList.toggle('text-gray-500', selected.length === 0);

    const selectedTowns = Array.from(selected).map(cb => cb.parentElement.querySelector('label').textContent);
    const maxPreview = 3;

    let previewHTML = selectedTowns.slice(0, maxPreview).map(town => 
        // Escape the text content just in case.
        `<span class="bg-gray-200 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full">${escapeHTML(town)}</span>`
    ).join('');

    if (selectedTowns.length > maxPreview) {
        previewHTML += `<span class="bg-gray-200 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full">+${selectedTowns.length - maxPreview} more</span>`;
    }
    
    previewContainer.innerHTML = previewHTML; // Single, fast DOM update
}
function getSelectedTowns(){return Array.from(document.querySelectorAll('.town-checkbox:checked')).map(cb=>cb.value)}


// --- Storey Dropdown Functions ---

// REFACTORED: Securely builds HTML and uses a single .innerHTML assignment.
function populateStoreyDropdown() {
    const content = document.getElementById('storey-dropdown-content');
    if (!content) return;

    const html = Object.keys(STOREY_LOOKUP).map(group => {
        const groupId = escapeHTML(group.replace(/\s/g, ''));
        const groupName = escapeHTML(group);

        const rangeCheckboxes = STOREY_LOOKUP[group].map(range => {
            const rangeId = escapeHTML(range.replace(/\s/g, ''));
            const rangeName = escapeHTML(range);
            return `
                <div class="flex items-center">
                    <input type="checkbox" id="storey-${rangeId}" name="storey" value="${rangeName}" class="storey-checkbox" data-group="${groupId}">
                    <label for="storey-${rangeId}" class="ml-2 text-sm font-normal text-gray-700 cursor-pointer">${rangeName}</label>
                </div>
            `;
        }).join('');

        return `
            <div class="mb-4">
                <div class="flex items-center justify-between border-b pb-1 mb-2">
                    <label class="font-semibold text-gray-800">${groupName}</label>
                    <div class="flex items-center cursor-pointer">
                        <input type="checkbox" id="select-all-${groupId}" class="storey-group-select-all" data-group="${groupId}">
                        <label for="select-all-${groupId}" class="text-sm ml-2 cursor-pointer">Select All</label>
                    </div>
                </div>
                <div class="space-y-2">
                    ${rangeCheckboxes}
                </div>
            </div>
        `;
    }).join('');

    content.innerHTML = html; // Single DOM write
}
function setupStoreyDropdownListeners(){const container=document.getElementById('storey-dropdown-container'),display=document.getElementById('storey-selector-display'),content=document.getElementById('storey-dropdown-content');display.addEventListener('click',()=>content.classList.toggle('hidden'));document.addEventListener('click',event=>{if(!container.contains(event.target))content.classList.add('hidden')});content.addEventListener('change',event=>{const target=event.target;if(target.classList.contains('storey-checkbox'))updateStoreyGroupSelectAllState(target.dataset.group);else if(target.classList.contains('storey-group-select-all'))handleStoreyGroupSelectAll(target);updateStoreyDisplay()})}
function handleStoreyGroupSelectAll(selectAllCheckbox){const group=selectAllCheckbox.dataset.group;document.querySelectorAll(`.storey-checkbox[data-group="${group}"]`).forEach(checkbox=>checkbox.checked=selectAllCheckbox.checked)}
function updateStoreyGroupSelectAllState(group){const groupCheckboxes=document.querySelectorAll(`.storey-checkbox[data-group="${group}"]`);document.getElementById(`select-all-${group}`).checked=Array.from(groupCheckboxes).every(cb=>cb.checked)}
function updateStoreyDisplay(){const selected=document.querySelectorAll('.storey-checkbox:checked'),selectorText=document.getElementById('storey-selector-text');selectorText.textContent=selected.length===0?'Select ranges...':`${selected.length} range(s) selected`;selectorText.classList.toggle('text-gray-500',selected.length===0)}
function getSelectedStoreys(){return Array.from(document.querySelectorAll('.storey-checkbox:checked')).map(cb=>cb.value)}



// --- Flat Model Dropdown Functions ---

// REFACTORED: Securely builds HTML and uses a single .innerHTML assignment.
function populateFlatModelDropdown() {
    const content = document.getElementById('flat-model-dropdown-content');
    if (!content) return;
    
    const html = Object.keys(FLAT_MODEL_LOOKUP).map(category => {
        const categoryId = escapeHTML(category.replace(/[\s/&.]/g, ''));
        const categoryName = escapeHTML(category);

        const modelCheckboxes = FLAT_MODEL_LOOKUP[category].map(model => {
            const modelId = escapeHTML(model.replace(/\s/g, ''));
            const modelName = escapeHTML(model);
            return `
                <div class="flex items-center">
                    <input type="checkbox" id="model-${modelId}" name="model" value="${modelName.toUpperCase()}" class="flat-model-checkbox" data-category="${categoryId}">
                    <label for="model-${modelId}" class="ml-2 text-sm font-normal text-gray-700 cursor-pointer">${modelName}</label>
                </div>
            `;
        }).join('');

        return `
            <div class="mb-4">
                <div class="flex items-center justify-between border-b pb-1 mb-2">
                    <label class="font-semibold text-gray-800">${categoryName}</label>
                    <div class="flex items-center cursor-pointer">
                        <input type="checkbox" id="select-all-${categoryId}" class="flat-model-category-select-all" data-category="${categoryId}">
                        <label for="select-all-${categoryId}" class="text-sm ml-2 cursor-pointer">Select All</label>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                    ${modelCheckboxes}
                </div>
            </div>
        `;
    }).join('');

    content.innerHTML = html; // Single DOM write
}

function setupFlatModelDropdownListeners() {
    const container = document.getElementById('flat-model-dropdown-container');
    const display = document.getElementById('flat-model-selector-display');
    const content = document.getElementById('flat-model-dropdown-content');
    display.addEventListener('click', () => content.classList.toggle('hidden'));
    document.addEventListener('click', (event) => { if (!container.contains(event.target)) content.classList.add('hidden'); });
    content.addEventListener('change', (event) => {
        const target = event.target;
        if (target.classList.contains('flat-model-checkbox')) updateFlatModelCategorySelectAllState(target.dataset.category);
        else if (target.classList.contains('flat-model-category-select-all')) handleFlatModelCategorySelectAll(target);
        updateFlatModelDisplay();
    });
}
function handleFlatModelCategorySelectAll(selectAllCheckbox) {
    const category = selectAllCheckbox.dataset.category;
    document.querySelectorAll(`.flat-model-checkbox[data-category="${category}"]`).forEach(checkbox => checkbox.checked = selectAllCheckbox.checked);
}
function updateFlatModelCategorySelectAllState(category) {
    const categoryCheckboxes = document.querySelectorAll(`.flat-model-checkbox[data-category="${category}"]`);
    document.getElementById(`select-all-${category}`).checked = Array.from(categoryCheckboxes).every(cb => cb.checked);
}
function updateFlatModelDisplay() {
    const selected = document.querySelectorAll('.flat-model-checkbox:checked');
    const selectorText = document.getElementById('flat-model-selector-text');
    selectorText.textContent = selected.length === 0 ? 'Select models...' : `${selected.length} model(s) selected`;
    selectorText.classList.toggle('text-gray-500', selected.length === 0);
}
function getSelectedFlatModels() {
    return Array.from(document.querySelectorAll('.flat-model-checkbox:checked')).map(cb => cb.value);
}
// --- Core App Logic ---
// This function is now just for the "Find My Home" button
async function fetchRecommendations() {
    if (isLoadingMore) return; // Prevent new search while loading
    isLoadingMore = true;

    // Reset state for a new search
    currentPage = 1;
    currentRecommendations = [];
    document.getElementById('results-container').innerHTML = '<div class="text-center py-10"><i class="fas fa-spinner fa-spin fa-2x text-blue-500"></i></div>';
    document.getElementById('loader-container').innerHTML = '';

    const findButton = document.getElementById('find-btn');
    findButton.disabled = true;
    findButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Searching...';

    // Save constraints globally
    currentConstraints = {
        max_price: parseInt(document.getElementById("max-price-input").value) || 10000000,
        min_remaining_lease: parseInt(document.getElementById("min-lease-input").value) || 0,
        towns: getSelectedTowns(),
        flat_types: getSelectedPills("flat-type-pill-list").map(type => type.replace('-', ' ')),
        storey_ranges: getSelectedStoreys(),
        flat_models: getSelectedFlatModels(),
        max_mrt_distance: MRT_DISTANCE_STEPS[parseInt(document.getElementById('max-mrt-dist-slider').value)].value
    };
    currentPriority = document.getElementById("priority-select").value;

    // Fetch the first page
    await fetchPageData(true); // true = overwrite

    // Re-enable button
    findButton.disabled = false;
    findButton.innerHTML = '<i class="fas fa-search mr-2"></i>Find My Home';
    isLoadingMore = false;
}
// NEW function to fetch data for a specific page
async function fetchPageData(overwrite) {
    isLoadingMore = true;
    const loaderContainer = document.getElementById('loader-container');
    
    // Show spinner in loader area if it's a "see more" click
    if (!overwrite) {
        loaderContainer.innerHTML = '<i class="fas fa-spinner fa-spin fa-2x text-blue-500"></i>';
    }

    try {
        const response = await fetch("http://127.0.0.1:8000/recommend", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ 
                constraints: currentConstraints, 
                priority: currentPriority, 
                page: currentPage 
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        const newFlats = data.recommendations || [];
        totalFound = data.total_found || 0;

        if (overwrite) {
            currentRecommendations = newFlats;
        } else {
            currentRecommendations.push(...newFlats);
        }

        // Pass the *new* flats to be rendered
        renderFlats(newFlats, overwrite);

    } catch (error) {
        console.error("Fetch error:", error);
        document.getElementById('results-container').innerHTML = '<div class="text-center py-10 px-6 bg-red-50 rounded-lg"><i class="fas fa-exclamation-triangle fa-2x text-red-400 mb-3"></i><p class="text-red-600">Could not retrieve recommendations. Check logs for errors.</p></div>';
    }
    
    isLoadingMore = false;
    // The "See More" button logic is now handled by renderFlats
}


// --- Other Functions ---

/**
 * REFACTORED:
 * 1. Takes `flats` as a parameter to be a "pure" function, making it testable and decoupled.
 * 2. Uses robust `value` attributes from the sort dropdown (e.g., "price-asc").
 * 3. Uses the safe `parseStorey` utility.
 * 4. Passes the sorted array to `renderFlats`.
 */
function sortAndRenderResults(flats) {
    // IMPORTANT: This requires your HTML <select> element to use `value` attributes:
    // e.g., <option value="price-asc">Price (Low to High)</option>
    //       <option value="price-desc">Price (High to Low)</option>
    //       <option value="recommended">Recommended</option>

    

    const sortBy = document.getElementById('sort').value;
    const sortedFlats = [...currentRecommendations]; // Create a new array to sort, preserving the original

    switch (sortBy) {
        case 'price-asc': // Changed from 'Price (Low to High)'
            sortedFlats.sort((a, b) => a.resale_price - b.resale_price);
            break;
        case 'price-desc': // Changed from 'Price (High to Low)'
            sortedFlats.sort((a, b) => b.resale_price - a.resale_price);
            break;
        case 'area-desc': // Changed from 'Area (Largest First)'
            sortedFlats.sort((a, b) => b.floor_area_sqm - a.floor_area_sqm);
            break;
        case 'storey-desc': // Changed from 'Storey (Highest First)'
            // Uses the new robust parser
            sortedFlats.sort((a, b) => parseStorey(b.storey_range) - parseStorey(a.storey_range));
            break;
        case 'mrt-asc': 
            sortedFlats.sort((a, b) => (a.dist_mrt_km || Infinity) - (b.dist_mrt_km || Infinity));
            break;
        case 'recommended': // Changed from 'Recommended'
        default:
            // No sort needed, use the default 'Recommended' order from the API
            break;
    }
    
    renderFlats(sortedFlats, true);
}

function getSelectedPills(containerId){const container=document.getElementById(containerId);if(!container)return[];return Array.from(container.querySelectorAll('.pill-btn.active')).map(pill=>pill.textContent.trim().replace(/\s*×$/,''))}
function togglePill(element){element.classList.toggle('active')}

/**
 * REFACTORED:
 * 1. Completely new HTML structure based on the React component.
 * 2. Uses helper functions for logic (getScoreColor, getRankingReason).
 * 3. Uses Font Awesome icons (fas) instead of Lucide.
 * 4. Handles new optional data (rank, constraintsMet, mrtDistance) with checks.
 * 5. Secure (escapeHTML) and Performant (map.join).
 */
function renderFlats(flats, overwrite) {
    const resultsContainer = document.getElementById('results-container');
    const countElement = document.querySelector('#search-section main p.text-gray-500');
    const loaderContainer = document.getElementById('loader-container');

    // Clear loader
    loaderContainer.innerHTML = '';

    // Handle no results
    if (!flats || !flats.length) {
        if (overwrite) { // Only show this if it's a new search
            resultsContainer.innerHTML = `
                <div class="text-center py-10 px-6 bg-yellow-50 rounded-lg">
                    <i class="fas fa-ghost fa-2x text-yellow-400 mb-3"></i>
                    <p class="text-yellow-600">No flats found matching your criteria. Try adjusting your filters.</p>
                </div>
            `;
        }
        countElement.textContent = `Found ${totalFound} matching flats.`;
        loaderContainer.innerHTML = '<p class="text-gray-500">No more flats found.</p>';
        return;
    }

    // --- Helper functions ---
    const getScoreColor = (score) => {
        if (score >= 8) return "bg-[#2DD4BF] text-white";
        if (score >= 6) return "bg-[#3B82F6] text-white";
        return "bg-gray-100 text-gray-600";
    };
    const getRankingReason = (score) => {
        if (score >= 9) return "Excellent overall match for all your criteria";
        if (score >= 8) return "Strong match with premium features";
        if (score >= 7) return "Good value proposition with key preferences met";
        if (score >= 6) return "Solid option meeting most requirements";
        return "Meets essential criteria";
    };
    
    const calculateWalkTime = (distanceInKm) => {
        if (distanceInKm === null || isNaN(distanceInKm)) return null;
        const timeInMinutes = distanceInKm * 12; // 5 km/h = 12 min/km
        const minutes = Math.round(timeInMinutes);
        if (minutes < 1) return "~1 min walk";
        return `~${minutes} min walk`;
    };
    // --- End Helpers ---

    // Build HTML for *only the new flats*
    const allCardsHTML = flats.map((flat, index) => {
        const globalIndex = overwrite ? index : currentRecommendations.length - flats.length + index;
        
        // --- All your const variables (street, block, etc.) ---
        const street = escapeHTML(flat.street_name);
        const block = escapeHTML(flat.block);
        const flatType = escapeHTML(flat.flat_type);
        const flatModel = escapeHTML(flat.flat_model);
        const town = escapeHTML(flat.town);
        const score = flat.score ? parseFloat(flat.score) : 0.0;
        const price = escapeHTML(flat.resale_price.toLocaleString());
        const area = escapeHTML(flat.floor_area_sqm);
        const storey = escapeHTML(flat.storey_range);
        const lease = escapeHTML(flat.remaining_lease_years);
        
        // Insight object
        const insightData = flat.insight_summary || { tiers: {}, text: "" };
        const tiers = insightData.tiers || {};
        const insightText = escapeHTML(insightData.text);
        
        // MRT Data
        const distKm = flat.dist_mrt_km; 
        const mrtMeters = (distKm !== null && !isNaN(distKm)) ? Math.round(distKm * 1000) : null;
        const walkTime = calculateWalkTime(distKm);
        
        // Other data
        const rank = flat.rank || (globalIndex + 1);
        const constraintsMet = flat.constraintsMet || {};

        // --- Start Card HTML ---
        return `
        <div class="border border-border bg-white rounded-xl shadow-sm transition-all duration-300 hover:shadow-lg">
            <div class="p-4 pb-3">
                <div class="flex items-start justify-between gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                                #${rank}
                            </span>
                            <h3 class="text-lg font-semibold text-gray-900">
                                ${street}, Block ${block}
                            </h3>
                        </div>
                        <div class="flex items-center gap-2 text-sm text-gray-500 mb-2">
                            <i class="fas fa-home h-4 w-4"></i>
                            <span>${flatType} · ${flatModel}</span>
                        </div>
                        <p class="text-xs text-gray-500 italic mb-2">
                            ${getRankingReason(score)}
                        </p>
                    </div>
                    <div class="px-3 py-1.5 rounded-lg font-bold text-sm shrink-0 ${getScoreColor(score)}">
                        ${score.toFixed(1)}/10
                    </div>
                </div>
            </div>
            
            <div class="p-4 space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                            <i class="fas fa-dollar-sign text-blue-600"></i>
                        </div>
                        <div><p class="text-xs text-gray-500">Price</p><p class="text-sm font-semibold text-gray-900">S$${price}</p></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-[var(--accent-foreground)] flex items-center justify-center">
                            <i class="fas fa-expand text-[var(--accent)]"></i>
                        </div>
                        <div><p class="text-xs text-gray-500">Floor Area</p><p class="text-sm font-semibold text-gray-900">${area} sqm</p></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                            <i class="fas fa-building text-blue-600"></i>
                        </div>
                        <div><p class="text-xs text-gray-500">Storey</p><p class="text-sm font-semibold text-gray-900">${storey}</p></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-[var(--accent-foreground)] flex items-center justify-center">
                            <i class="fas fa-calendar-alt text-[var(--accent)]"></i>
                        </div>
                        <div><p class="text-xs text-gray-500">Lease</p><p class="text-sm font-semibold text-gray-900">${lease} yrs</p></div>
                    </div>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div class="flex items-center gap-2 text-sm text-gray-500">
                        <i class="fas fa-map-marker-alt h-4 w-4"></i>
                        <span>${town}</span>
                    </div>
                    ${mrtMeters !== null ? `
                        <div class="flex items-center gap-2 text-sm text-gray-500">
                            <i class="fas fa-train h-4 w-4"></i>
                            <span class="font-semibold">${mrtMeters}m</span>
                            <span class="text-xs">(${walkTime})</span>
                        </div>
                    ` : ''}
                </div>

                <div class="bg-white border-2 border-teal-200 rounded-lg p-4 space-y-4 shadow-sm">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex items-center gap-2">
                          <div class="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                              <i class="fas fa-lightbulb h-4 w-4 text-[var(--accent)]"></i>
                          </div>
                          <span class="text-sm font-bold text-[var(--accent)] uppercase tracking-wide">AI Insight Summary</span>
                      </div>
                      <div class="flex flex-wrap gap-2">
                          <span class="flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${getPillStyles(tiers.lease_value)}">
                              <i class="fas fa-tags mr-1.5"></i>
                              Value vs. Lease: ${escapeHTML(tiers.lease_value)}
                          </span>
                          <span class="flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${getPillStyles(tiers.resale_risk)}">
                              <i class="fas fa-chart-line mr-1.5"></i>
                              Resale Risk: ${escapeHTML(tiers.resale_risk)}
                          </span>
                          <span class="flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${getPillStyles(tiers.size_value)}">
                              <i class="fas fa-ruler-combined mr-1.5"></i>
                              Value vs. Size: ${escapeHTML(tiers.size_value)}
                          </span>
                      </div>
                  </div>
                  <p class="text-sm text-gray-800 leading-relaxed font-medium pt-3 border-t border-teal-200/50">
                      ${insightText}
                  </p>
                </div>
            </div>
        </div>
        `;
        // --- End Card HTML ---
    }).join('');

    // --- NEW RENDER LOGIC ---
    if (overwrite) {
        resultsContainer.innerHTML = allCardsHTML; // Replace content
    } else {
        resultsContainer.insertAdjacentHTML('beforeend', allCardsHTML); // Append content
    }

    // Update count
    countElement.textContent = `Found ${totalFound} matching flats. Showing ${currentRecommendations.length}.`;

    // Add "See More" button or "No more" text
    if (currentRecommendations.length < totalFound) {
        loaderContainer.innerHTML = `
            <button onclick="seeMore()" class="bg-[#3B82F6] text-white font-semibold py-2 px-5 rounded-lg hover:opacity-90 transition">
                See More
            </button>
        `;
    } else if (totalFound > 0) {
        loaderContainer.innerHTML = '<p class="text-gray-500">No more flats found.</p>';
    }
}

// NEW: Function to be called by the "See More" button
async function seeMore() {
    if (isLoadingMore) return;
    currentPage++;
    await fetchPageData(false); // false = append
}